# DECISIONS — journal des choix techniques

Format : décision → raison → alternative écartée. (BMAD-lite : pas de cérémonie, mais tout est tracé.)

## D1 — CORS : POST "simple request" au lieu de `no-cors`
**Choix** : `fetch(url, { method: 'POST', body: JSON.stringify(...) })` sans aucun header custom. Le body string donne un `Content-Type: text/plain;charset=UTF-8` automatique → requête "simple" sans preflight OPTIONS (que Apps Script ne gère pas). Apps Script renvoie `Access-Control-Allow-Origin: *` sur la réponse finale (après le redirect 302 vers googleusercontent) → **la réponse est lisible**.
**Gain** : le toast affiche la vraie catégorie calculée par le backend (`✓ 40,00 € → nourriture`), pas un parsing dupliqué côté client. Le brief envisageait `mode: 'no-cors'` + feedback optimiste : abandonné car la réponse opaque empêche même de savoir si le token était bon.
**Écarté** : `no-cors` (réponse opaque), JSONP (moche), duplication du parsing côté client (deux sources de vérité).

## D2 — "401" logique, pas HTTP
**Choix** : token invalide → HTTP 200 avec `{"ok":false,"error":"unauthorized"}`.
**Raison** : `ContentService` d'Apps Script ne permet pas de définir le code de statut HTTP. Le critère "POST sans token → rejeté" est respecté fonctionnellement : rien n'est loggé, le client affiche l'erreur.

## D3 — Matching par sous-chaîne, mots-clés triés par longueur décroissante
**Choix** : `libellé_normalisé.includes(keyword_normalisé)`, règles triées par longueur de keyword décroissante, premier match gagne.
**Raison** : le tri résout les collisions de sous-chaînes du dict fourni : sans lui, `25 cadeau anniv` matcherait `eau` (→ logement) avant `cadeau`, et `uber eats` ne gagnerait jamais sur `uber`.
**Limite assumée** : des faux positifs restent possibles (`bar` matche `barbecue`, `abo` matche `rabot`). Correctif : éditer l'onglet `categories`, effet immédiat. Le matching par mot entier a été écarté car le brief demande explicitement "par mot-clé contenu" (et `frit` doit matcher `friterie`).
**Normalisation** : minuscules + NFD + suppression des diacritiques combinants (U+0300–U+036F), identique côté keyword et libellé.

## D4 — `client_date` : la date par défaut vient du téléphone, pas du serveur
**Choix** : la PWA envoie `client_date` (date du jour Europe/Brussels au moment de la **saisie**) ; le serveur l'utilise comme date par défaut au lieu de "aujourd'hui côté serveur".
**Raison** : une dépense saisie hors-ligne lundi soir et synchronisée mardi matin doit être datée de lundi. Sans ce champ, la file offline corromprait les dates.
**Garde-fou** : le serveur valide le format `yyyy-mm-dd` et retombe sur sa propre date sinon.

## D5 — File offline : préférer un doublon à une perte
**Choix** : si le `fetch` rejette (réseau KO **ou** réponse illisible), la saisie part en file `localStorage` et sera renvoyée. Cas limite : le POST a atteint le serveur mais la réponse s'est perdue → doublon possible dans le Sheet.
**Raison** : critère "ne jamais perdre une saisie" prioritaire. Un doublon se repère (timestamps proches, même `raw_input`) et se supprime à la main ; une ligne perdue est invisible.
**Détail** : une erreur de **parsing** renvoyée par le serveur lors du flush retire l'item de la file (le renvoyer ne le réparera pas) ; un `unauthorized` stoppe le flush sans vider la file.

## D6 — `setup()` programmatique au lieu d'instructions manuelles
**Choix** : une fonction `setup()` idempotente crée les onglets, seed les ~55 mots-clés, pose les formules du dashboard et insère les 2 graphiques.
**Raison** : (a) élimine 10 minutes de copier-coller sujet aux erreurs ; (b) surtout, `setFormula()` utilise la syntaxe en-US (séparateur `,`) quelle que soit la locale du Sheet — le copier-coller manuel de formules casse sur une locale FR (séparateur `;`).
**Idempotence** : ré-exécutable ; `log` et `categories` ne sont jamais réécrits s'ils contiennent des données, seul `dashboard` est reconstruit.

## D7 — Token généré par `printNewToken()` et visible dans index.html
**Choix** : helper qui génère un token (2 UUID concaténés), le stocke dans `ScriptProperties` et l'affiche dans le log ; côté client, constante en clair dans `index.html`.
**Menace couverte** : POST anonymes qui pollueraient le Sheet si l'URL `/exec` fuitait.
**Menace non couverte (assumée, cf. brief)** : quiconque lit le source de la page GitHub Pages a le token. Données non sensibles (montants + libellés), risque accepté. Mitigation possible plus tard : servir la PWA depuis Apps Script (HtmlService) pour tout garder privé.

## D8 — Dates relatives : `hier`, `avant-hier`, `avant hier`, `JJ/MM[/AAAA]`
**Choix** : token de date détecté **uniquement en fin de saisie** (dernier token). `JJ/MM` sans année : année courante, ou année précédente si la date serait dans le futur (saisir `40 resto 28/12` un 3 janvier → 28/12 de l'an passé).
**Raison** : détection en fin de chaîne uniquement = zéro ambiguïté avec le libellé (`25 cadeau anniv marie` ne déclenche rien). Une date invalide (`31/02`) → erreur claire, rien n'est loggé.
**Limite** : un libellé qui se termine par un motif date (`10 loto 12/07`… voulu comme libellé) sera interprété comme date. Jugé rarissime.

## D9 — Montant : premier token, virgule ou point, `€` toléré
**Choix** : regex `^\d+([.,]\d{1,2})?€?$` sur le premier token, arrondi à 2 décimales, doit être > 0.
**Écarté** : montants négatifs (remboursements) — hors scope v1, à logger comme catégorie dédiée si besoin plus tard.

## D10 — Icônes PNG générées, pas de dépendance design
**Choix** : PNG 192/512 générés par script (fond `#0f1115`, "€" vert `#4ade80`), `purpose: any maskable` sur la 512.
**Raison** : Chrome Android exige des icônes PNG déclarées dans le manifest pour l'installabilité ; pas envie d'une dépendance à un outil de design pour deux carrés.

## D11 — Service worker cache-first, POST jamais interceptés
**Choix** : cache-first sur les assets same-origin GET uniquement ; les requêtes vers `script.google.com` ne passent pas par le SW.
**Raison** : l'app doit s'ouvrir instantanément hors-ligne (la file offline gère la synchro) ; intercepter les POST n'apporterait que des bugs. Versionnage par nom de cache (`expenses-v1`) : incrémenter à chaque évolution des assets.

## D12 — Historique de session en mémoire, pas persisté
**Choix** : les 5 dernières saisies affichées viennent d'un tableau JS en mémoire (perdu à la fermeture) ; seule la file offline est dans `localStorage`.
**Raison** : le brief dit "de la session". La source de vérité de l'historique complet est le Sheet ; dupliquer dans `localStorage` créerait une divergence sans valeur.

## D13 — Colonne `date` écrite comme objet `Date`, pas comme texte
**Choix** : le backend convertit `'yyyy-MM-dd'` en objet `Date` à minuit Europe/Brussels (`dateForSheet()`) avant l'append.
**Raison** : une chaîne `"2026-07-22"` peut rester du **texte** selon la locale du Sheet — et tout le dashboard (SUMIFS, QUERY sur dates) échouerait silencieusement (totaux à 0 €). Minuit pile est aussi nécessaire pour que la borne `<= EOMONTH(...)` inclue le dernier jour du mois. `setup()` force le fuseau du Sheet à Europe/Brussels pour que la conversion instant→cellule tombe juste.
