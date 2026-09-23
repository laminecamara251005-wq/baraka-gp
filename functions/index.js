const {onCall, onRequest, HttpsError} = require('firebase-functions/v2/https');
const {onDocumentUpdated} = require('firebase-functions/v2/firestore');
const {defineSecret} = require('firebase-functions/params');
const admin = require('firebase-admin');
const Stripe = require('stripe');

admin.initializeApp();
const db = admin.firestore();

const REGION = 'europe-west1';
const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY');
const stripeWebhookSecret = defineSecret('STRIPE_WEBHOOK_SECRET');

function getStripe() {
  return new Stripe(stripeSecretKey.value(), { apiVersion: '2024-06-20' });
}

function cleanPhone(p) {
  return (p || '').replace(/[^0-9]/g, '');
}

// Crée (si besoin) un compte Stripe Express pour un voyageur, et renvoie un
// lien d'inscription Stripe à ouvrir dans son navigateur pour qu'il
// complète sa fiche (identité, IBAN) — nécessaire pour pouvoir le reverser
// plus tard.
exports.createConnectOnboardingLink = onCall({ secrets: [stripeSecretKey], region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Connexion requise');
  const phone = cleanPhone(request.data && request.data.phone);
  if (!phone) throw new HttpsError('invalid-argument', 'Numéro manquant');

  const stripe = getStripe();
  const profileRef = db.collection('profiles').doc(phone);
  const profileSnap = await profileRef.get();
  let accountId = profileSnap.exists ? profileSnap.data().stripeAccountId : null;

  if (!accountId) {
    const account = await stripe.accounts.create({
      type: 'express',
      country: 'FR',
      capabilities: { transfers: { requested: true } },
      business_type: 'individual',
    });
    accountId = account.id;
    await profileRef.set({ stripeAccountId: accountId }, { merge: true });
  }

  const origin = (request.data && request.data.origin) || 'https://laminecamara251005-wq.github.io/baraka-gp';
  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${origin}/index.html?stripe=refresh`,
    return_url: `${origin}/index.html?stripe=return`,
    type: 'account_onboarding',
  });

  return { url: accountLink.url };
});

// Crée un PaymentIntent pour une commande : l'argent est prélevé et retenu
// sur le solde de la plateforme (aucune destination définie ici), il ne
// sera reversé au voyageur qu'à la confirmation de la livraison —
// voir transferToTraveler ci-dessous.
exports.createPaymentIntent = onCall({ secrets: [stripeSecretKey], region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Connexion requise');
  const orderId = request.data && request.data.orderId;
  if (!orderId) throw new HttpsError('invalid-argument', 'Commande manquante');

  const orderRef = db.collection('orders').doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) throw new HttpsError('not-found', 'Commande introuvable');
  const order = orderSnap.data();
  if (order.status !== 'accepted') {
    throw new HttpsError('failed-precondition', "Cette commande ne peut pas être payée dans son état actuel");
  }

  const amountCents = Math.round((order.priceTotal || 0) * 100);
  if (amountCents <= 0) throw new HttpsError('failed-precondition', 'Montant invalide');

  const stripe = getStripe();
  let paymentIntent;
  if (order.stripePaymentIntentId) {
    paymentIntent = await stripe.paymentIntents.update(order.stripePaymentIntentId, { amount: amountCents });
  } else {
    paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'eur',
      metadata: { orderId },
      automatic_payment_methods: { enabled: true },
    });
    await orderRef.set({ stripePaymentIntentId: paymentIntent.id }, { merge: true });
  }

  return { clientSecret: paymentIntent.client_secret };
});

// Webhook Stripe : seule source de vérité pour confirmer qu'un paiement a
// réellement eu lieu (jamais le client, qui pourrait mentir).
exports.stripeWebhook = onRequest({ secrets: [stripeSecretKey, stripeWebhookSecret], region: REGION }, async (req, res) => {
  const stripe = getStripe();
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, req.headers['stripe-signature'], stripeWebhookSecret.value());
  } catch (err) {
    res.status(400).send(`Signature invalide: ${err.message}`);
    return;
  }

  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object;
    const orderId = pi.metadata && pi.metadata.orderId;
    if (orderId) {
      const orderRef = db.collection('orders').doc(orderId);
      const snap = await orderRef.get();
      if (snap.exists && snap.data().status === 'accepted') {
        const pickupCode = String(Math.floor(1000 + Math.random() * 9000));
        await orderRef.set({ status: 'paid', pickupCode, paidAt: Date.now() }, { merge: true });
      }
    }
  }

  if (event.type === 'account.updated') {
    const account = event.data.object;
    const matches = await db.collection('profiles').where('stripeAccountId', '==', account.id).limit(1).get();
    if (!matches.empty) {
      const onboarded = !!(account.details_submitted && account.charges_enabled);
      await matches.docs[0].ref.set({ stripeOnboarded: onboarded }, { merge: true });
    }
  }

  res.json({ received: true });
});

// Dès qu'une commande passe à "completed" (réception confirmée par le
// destinataire ou le voyageur), on reverse au voyageur sa part (priceNet),
// une seule fois — jamais avant, c'est tout l'intérêt de la retenue.
exports.transferToTraveler = onDocumentUpdated({ document: 'orders/{orderId}', secrets: [stripeSecretKey], region: REGION }, async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  if (before.status === 'completed' || after.status !== 'completed') return;
  if (after.transferred) return;
  if (!after.gpPhone || !after.priceNet) return;

  const orderRef = event.data.after.ref;
  const gpPhone = cleanPhone(after.gpPhone);
  const profileSnap = await db.collection('profiles').doc(gpPhone).get();
  const stripeAccountId = profileSnap.exists ? profileSnap.data().stripeAccountId : null;
  if (!stripeAccountId) {
    await orderRef.set({ transferError: "Le voyageur n'a pas de compte Stripe configuré" }, { merge: true });
    return;
  }

  const stripe = getStripe();
  const amountCents = Math.round(after.priceNet * 100);
  try {
    const transfer = await stripe.transfers.create({
      amount: amountCents,
      currency: 'eur',
      destination: stripeAccountId,
      transfer_group: event.params.orderId,
      metadata: { orderId: event.params.orderId },
    });
    await orderRef.set({ transferred: true, transferId: transfer.id, transferredAt: Date.now(), transferError: admin.firestore.FieldValue.delete() }, { merge: true });
  } catch (err) {
    await orderRef.set({ transferError: err.message }, { merge: true });
  }
});
