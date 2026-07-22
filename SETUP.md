# SETUP — Expense Tracker (PWA + Google Apps Script)

Durée totale : ~15 minutes. Aucun coût.

## 1. Créer le Google Sheet

1. Va sur [sheets.new](https://sheets.new), nomme le fichier `Dépenses` (nom libre).
2. C'est tout — les onglets `log`, `categories` et `dashboard` seront créés automatiquement à l'étape 3.

## 2. Coller le script

1. Dans le Sheet : **Extensions → Apps Script**.
2. Supprime le contenu de `Code.gs` et colle l'intégralité de [apps-script/Code.gs](apps-script/Code.gs).
3. 💾 Enregistre (Ctrl+S).
4. (Optionnel) **Paramètres du projet ⚙️ → Fuseau horaire → Europe/Brussels.**

## 3. Initialiser le Sheet

1. Dans l'éditeur Apps Script, sélectionne la fonction **`setup`** dans le menu déroulant, puis **Exécuter**.
2. Google demande des autorisations la première fois : **Examiner les autorisations → ton compte → Paramètres avancés → Accéder à Dépenses (non sécurisé) → Autoriser**. (C'est ton propre script, l'avertissement est normal.)
3. Vérifie dans le Sheet : les onglets `log`, `categories` (pré-rempli avec ~55 mots-clés) et `dashboard` (formules + 2 graphiques) existent.

> Alternative pour les catégories : le fichier [seed/categories.csv](seed/categories.csv) contient le même dict, importable via **Fichier → Importer** si tu préfères.

## 4. Générer le token secret

1. Toujours dans l'éditeur, sélectionne la fonction **`printNewToken`**, puis **Exécuter**.
2. Ouvre le **journal d'exécution** : le token s'affiche (`TOKEN (à coller dans index.html) : abc123...`).
3. **Copie-le** — il est déjà stocké dans les Script Properties, tu en auras besoin à l'étape 6.

## 5. Déployer en Web App

1. **Déployer → Nouveau déploiement → ⚙️ Type : Application Web.**
2. Description : libre. **Exécuter en tant que : Moi. Qui a accès : Tout le monde.**
3. **Déployer**, puis copie l'**URL de l'application Web** (elle se termine par `/exec`).

> ⚠️ **À chaque modification future de Code.gs** : **Déployer → Gérer les déploiements → ✏️ → Version : Nouvelle version → Déployer.** Sinon l'URL continue de servir l'ancienne version.

## 6. Configurer la PWA

Dans [index.html](index.html), tout en haut du `<script>` :

```js
const API_URL = 'https://script.google.com/macros/s/XXXXX/exec'; // URL de l'étape 5
```

**Le token n'est jamais dans le code** (ni dans le repo, ni dans la page servie). Il est fourni une fois par appareil en ouvrant la PWA via le **lien d'installation** `https://<ton-url>/#token=abc123...` : le fragment `#` ne quitte pas le navigateur, il est stocké en `localStorage` puis retiré de la barre d'adresse. Garde ce lien pour toi (gestionnaire de mots de passe, par exemple).

Token manquant ou invalide → la PWA affiche un message demandant de rouvrir le lien d'installation ; les saisies en cours ne sont pas perdues.

## 7. Héberger sur GitHub Pages

1. Commit + push le repo sur GitHub (`index.html`, `manifest.json`, `sw.js`, `icons/` doivent être à la racine).
2. Sur GitHub : **Settings → Pages → Source : Deploy from a branch → Branch : `main` / `/ (root)` → Save.**
3. Après ~1 minute, la PWA est disponible sur `https://<ton-user>.github.io/Expenses/`.

> Note : avec un compte GitHub gratuit, Pages n'est disponible que sur un repo **public**. C'est sans risque ici : le token n'apparaît ni dans le repo ni dans la page servie (voir étape 6 et DECISIONS.md D14).

## 8. Installer sur Android

1. Ouvre l'URL GitHub Pages dans **Chrome** sur le téléphone.
2. Menu ⋮ → **"Ajouter à l'écran d'accueil"** (ou bannière "Installer l'application").
3. L'icône € apparaît sur l'écran d'accueil, s'ouvre en plein écran, champ prêt à la saisie.

## 9. Vérifier

- Tape `40 picard` → toast `✓ 40,00 € → nourriture` + ligne dans l'onglet `log` en < 5 s.
- Tape `3 blabla` → loggé en catégorie `autre`.
- Tape `inconnu 15` → message d'erreur, rien n'est loggé.
- Mode avion → saisie → `⏳ mis en file` → réactive le réseau, rouvre l'app → synchronisé.
- Test santé backend (navigateur) : `https://script.google.com/macros/s/XXXXX/exec?token=TON_TOKEN` → `{"ok":true,"rows":N,...}`.
- Test rejet : la même URL avec un mauvais token → `{"ok":false,"error":"unauthorized"}`.

## Maintenance

> Le projet est aussi relié via **clasp** ([apps-script/.clasp.json](apps-script/.clasp.json)) : après une modif de `Code.gs`, `clasp push -f` depuis `apps-script/`, puis `clasp redeploy <deploymentId>` (id visible via `clasp deployments`) pour mettre à jour la Web App sans changer d'URL.

- **Ajouter un mot-clé** : ajoute une ligne dans l'onglet `categories` (keyword | categorie). Effet immédiat, rien à redéployer.
- **Re-catégoriser d'anciennes lignes** : édite la colonne `categorie` de `log` à la main (la colonne `raw_input` garde la saisie d'origine).
- **Régénérer le dashboard** : `curl "https://.../exec?token=TON_TOKEN&action=rebuild_dashboard"` (ou ré-exécute `setup()` dans l'éditeur). Idempotent, les données de `log` et `categories` ne sont jamais touchées. À faire après avoir ajouté une **nouvelle catégorie** (la matrice mois × catégorie est figée à la construction).
- **Changer le token** : ré-exécute `printNewToken()` dans l'éditeur Apps Script, puis rouvre la PWA via le nouveau lien `#token=...` sur chaque appareil. Rien à pousser sur GitHub.
