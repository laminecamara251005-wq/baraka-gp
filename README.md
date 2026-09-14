# baraka-gp

Application de mise en relation entre particuliers pour l'envoi de colis via des
voyageurs.

- `index.html` — l'application publique (recherche, envoi de colis, publier un
  trajet, commandes, points, support).
- `admin.html` — la console d'administration (vérifier les identités et les
  annonces, gérer les litiges, répondre au support). Page séparée, non liée
  depuis `index.html` : seule une personne connaissant son URL peut la trouver,
  et il faut ensuite un compte admin pour y entrer.

## Configuration Firebase

Les données (annonces, commandes, profils, points, messages) sont stockées dans
Firebase Firestore et partagées entre tous les utilisateurs. `index.html` et
`admin.html` doivent pointer vers le **même** projet Firebase.

1. Créez un projet sur https://console.firebase.google.com.
2. **Build → Firestore Database → Créer une base de données.**
3. **Paramètres du projet (⚙️) → Vos applications → Ajouter une application Web**,
   copiez l'objet `firebaseConfig` et collez-le à la fois dans `index.html` et
   dans `admin.html` (variable `firebaseConfig`, en haut du `<script>`
   principal de chaque fichier) à la place des valeurs `REMPLACER...`.
4. **Build → Authentication → Sign-in method → activez « Email/Mot de passe »**.
   C'est le même système de connexion que les utilisateurs normaux de
   `index.html` (inscription libre, prénom + numéro + email + mot de passe) —
   il faut donc explicitement marquer certains comptes comme admin (étape 6).
   Activez aussi **« Anonyme »** dans la même page : c'est ce qui permet au
   destinataire d'un colis (qui n'a pas de compte Baraka GP) de confirmer sa
   réception via le lien reçu du voyageur, sans avoir à s'inscrire. Sans ça,
   le lien de confirmation de réception (`?receive=...`) reste bloqué.
5. Déployez les règles de sécurité (`firestore.rules`) avec la
   [CLI Firebase](https://firebase.google.com/docs/cli), ou collez le contenu
   du fichier dans **Firestore Database → Règles → Publier** :
   ```
   npm install -g firebase-tools
   firebase login
   firebase use --add        # sélectionnez votre projet
   firebase deploy --only firestore:rules
   ```
6. **Déclarer un compte admin** : dans **Authentication → Users**, créez votre
   compte (email + mot de passe) — ou utilisez un compte déjà créé en vous
   inscrivant normalement sur `index.html` — puis copiez son **User UID**.
   Allez dans **Firestore Database → Données → Commencer une collection**,
   nommez-la `admins`, et créez un document dont l'**ID est exactement cet
   UID** (le contenu du document importe peu, un champ `role: "admin"` suffit).
   Sans ce document, le compte peut se connecter à `admin.html` mais aucune
   action (vérifier, supprimer) ne fonctionnera : les règles Firestore les
   refuseront silencieusement.

Si vous hébergez le site (Firebase Hosting ou autre), pensez à ne pas mettre de
lien vers `admin.html` nulle part dans le site public ni dans vos moteurs de
recherche (le fichier envoie déjà `<meta name="robots" content="noindex">`) —
son URL doit rester connue de vous seul.

### Limite connue

Un compte (email + mot de passe) est obligatoire pour utiliser `index.html`,
mais le numéro de téléphone qu'il contient n'est pas vérifié par SMS — rien
n'empêche quelqu'un de créer un compte avec le numéro de quelqu'un d'autre.
Les règles Firestore exigent qu'on soit connecté pour lire ou écrire quoi que
ce soit, mais ne vérifient pas encore qu'une commande, un message ou un profil
n'est modifié que par son propriétaire (ça nécessiterait de lier chaque
enregistrement au compte de son auteur, plus large que ce qui est fait ici).
Une vérification réelle du numéro nécessiterait Firebase Phone Auth (SMS),
qui demande la formule payante Blaze.

Le lien de confirmation de réception (`?receive=...`) est protégé par le code
à 4 chiffres à saisir, pas par le lien lui-même : toute personne qui devine ou
intercepte le lien ET le code pourrait valider une réception à la place du
vrai destinataire. C'est le même niveau de sécurité que le code de remise
utilisé plus tôt dans le parcours, pas un vrai contrôle d'identité.