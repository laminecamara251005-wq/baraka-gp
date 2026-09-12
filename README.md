# baraka-gp

Application de mise en relation entre particuliers pour l'envoi de colis via des
voyageurs (`index.html`, application statique en une page).

## Configuration Firebase

Les données (annonces, commandes, profils, points, messages) sont stockées dans
Firebase Firestore et partagées entre tous les utilisateurs.

1. Créez un projet sur https://console.firebase.google.com.
2. **Build → Firestore Database → Créer une base de données.**
3. **Paramètres du projet (⚙️) → Vos applications → Ajouter une application Web**,
   copiez l'objet `firebaseConfig` et collez-le dans `index.html` (variable
   `firebaseConfig`, en haut du `<script>` principal) à la place des valeurs
   `REMPLACER...`.
4. **Build → Authentication → Sign-in method → activez « Email/Mot de passe »**,
   puis dans l'onglet **Users**, ajoutez un compte (email + mot de passe) pour
   chaque personne qui doit avoir accès à l'espace admin. L'app n'a pas de page
   d'inscription : seuls les comptes que vous créez ici peuvent se connecter.
5. Déployez les règles de sécurité (`firestore.rules`) avec la
   [CLI Firebase](https://firebase.google.com/docs/cli) :
   ```
   npm install -g firebase-tools
   firebase login
   firebase use --add        # sélectionnez votre projet
   firebase deploy --only firestore:rules
   ```

L'espace admin s'ouvre en cliquant 5 fois rapidement sur l'étoile du logo, en
haut de l'application.

### Limite connue

L'application identifie les utilisateurs par un numéro de téléphone qu'ils
saisissent eux-mêmes, sans vérification (pas de compte, pas de code SMS). Les
règles Firestore protègent donc uniquement les actions réservées à l'admin
(vérifier/supprimer une identité ou une annonce) ; le reste des écritures
(commandes, messages, points) reste ouvert, comme l'app elle-même le suppose.
Une sécurisation complète nécessiterait une authentification par téléphone
(ex. Firebase Phone Auth), non incluse ici.