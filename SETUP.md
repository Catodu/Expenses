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
const TOKEN   = 'abc123...';                                     // token de l'étape 4
```

## 7. Héberger sur GitHub Pages

1. Commit + push le repo sur GitHub (`index.html`, `manifest.json`, `sw.js`, `icons/` doivent être à la racine).
2. Sur GitHub : **Settings → Pages → Source : Deploy from a branch → Branch : `main` / `/ (root)` → Save.**
3. Après ~1 minute, la PWA est disponible sur `https://<ton-user>.github.io/Expenses/`.

> Note : le token est visible dans le source de la page. C'est assumé (voir DECISIONS.md) : il ne protège que des POST anonymes, et le Sheet ne contient rien de sensible. Attention : avec un compte GitHub gratuit, Pages n'est disponible que sur un repo **public** — ne mets donc rien d'autre de sensible dans ce repo. Alternative 100% privée et gratuite : servir la PWA via Apps Script lui-même (`doGet` + HtmlService) — non couvert ici.

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
- **Régénérer le dashboard** (après modification) : ré-exécute `setup()` — il est idempotent, les données de `log` et `categories` ne sont jamais touchées.
- **Changer le token** : ré-exécute `printNewToken()`, recolle le nouveau token dans `index.html`, push.
