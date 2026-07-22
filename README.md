# Expenses — tracker de dépenses zéro-friction

Taper `40 picard` sur le téléphone → 40,00 €, "picard", catégorie `nourriture` dans un Google Sheet. Coût : 0 €, aucun serveur.

- **PWA** : [index.html](index.html) (+ [manifest.json](manifest.json), [sw.js](sw.js), [icons/](icons/)) — hébergée sur GitHub Pages, installable sur Android, file offline.
- **Backend** : [apps-script/Code.gs](apps-script/Code.gs) — Web App Google Apps Script (parsing, catégorisation par règles, append, dashboard).
- **Installation** : suivre [SETUP.md](SETUP.md) (~15 min).
- **Choix techniques** : tracés dans [DECISIONS.md](DECISIONS.md).
- **Seed catégories** : [seed/categories.csv](seed/categories.csv) (inséré automatiquement par `setup()`).

Format de saisie : `<montant> <libellé> [hier | avant-hier | JJ/MM]` — ex. `12,5 resto midi`, `8 stib hier`, `40 picard 15/07`.

Raccourcis : `picard` tout seul reprend le dernier montant connu de ce libellé ; `annule` supprime la dernière saisie (file locale d'abord, sinon dernière ligne du Sheet).
