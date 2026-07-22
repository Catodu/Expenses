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
**Choix** : une fonction `setup()` idempotente crée les onglets, seed les ~55 mots-clés, pose les formules du dashboard et insère les graphiques.
**Raison** : élimine 10 minutes de copier-coller sujet aux erreurs.
**Idempotence** : ré-exécutable ; `log` et `categories` ne sont jamais réécrits s'ils contiennent des données, seul `dashboard` est reconstruit.
**⚠️ Corrigé par [D23]** : la justification initiale « `setFormula()` utilise la syntaxe en-US quelle que soit la locale » était **fausse** — voir D23.

## D7 — Token généré par `printNewToken()`, stocké dans ScriptProperties
**Choix** : helper qui génère un token (2 UUID concaténés) et le stocke dans `ScriptProperties` côté serveur.
**Menace couverte** : POST anonymes qui pollueraient le Sheet si l'URL `/exec` fuitait.
**Révisé par [D14]** : le brief prévoyait le token en constante dans `index.html` ; abandonné au profit du `localStorage`.

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

## D14 — Token hors du code : `localStorage` + lien `#token=...`
**Choix** : aucune trace du token dans le repo ni dans la page servie. Il est fourni une fois par appareil — via le fragment d'URL `#token=XXX` (jamais envoyé au serveur, stocké en `localStorage` puis retiré de la barre d'adresse par `history.replaceState`) ou via un champ de config affiché tant qu'aucun token n'est enregistré. Un rejet `unauthorized` raffiche le champ sans perdre la saisie.
**Raison** : demande utilisateur ("pas en dur, comme une var d'env"). Une vraie var d'env n'existe pas pour une page statique (le navigateur doit recevoir le secret d'une façon ou d'une autre) ; le `localStorage` est l'équivalent le plus proche : le secret ne vit que sur les appareils autorisés. Permet un repo **public** (GitHub Pages gratuit) sans exposer le token.
**Conséquence** : l'ancien token, présent dans l'historique git (commit 9668518), a été **révoqué** (rotation côté ScriptProperties) avant le passage en public.
**Écarté** : injection au build via GitHub Actions + secret (sort le token du repo mais pas du source de la page déployée) ; HtmlService (perd le service worker donc le hors-ligne, et l'installation standalone — cf. critères de done).

## D15 — Récap du jour : calculé par le backend (`GET ?action=today`)
**Choix** : le backend renvoie total + liste des dépenses du jour (date Europe/Brussels) ; l'app l'affiche sous le champ et le rafraîchit au chargement, au retour au premier plan, après chaque saisie confirmée et après chaque resynchronisation. La liste du jour remplace l'historique de session, qui ne montre plus que les saisies **non confirmées** (en attente/hors-ligne/erreur) — sinon chaque dépense apparaissait deux fois.
**Raison** : le Sheet est la source de vérité — un récap calculé côté client (session ou localStorage) raterait les saisies faites depuis un autre appareil ou une session précédente.
**Limite assumée** : lecture de tout l'onglet `log` à chaque appel — négligeable à échelle perso (des années ≈ quelques milliers de lignes) ; optimisable plus tard en lisant depuis le bas.
**Rappel opérationnel** : toute évolution des assets de la PWA exige d'incrémenter le nom du cache dans `sw.js` (`expenses-vN`), sinon les téléphones gardent l'ancienne version en cache-first (cf. [D11]).

## D16 — Total du mois dans le récap
**Choix** : `?action=today` renvoie aussi `month_total` (mois civil en cours, Europe/Brussels), calculé dans la même passe de lecture que le jour. Affiché sur la même ligne que le total du jour.
**Écarté** : un appel séparé (une lecture du Sheet de plus pour rien) ; le mois glissant sur 30 jours (le dashboard raisonne déjà en mois civil, cohérence).

## D17 — `annule` : suppression de la dernière saisie, en cascade
**Choix** : taper `annule` (ou `undo`) dans le champ de saisie. Ordre : (1) s'il reste des saisies en file locale non envoyées, la dernière est retirée de la file (elle n'a jamais atteint le Sheet) ; (2) sinon, le backend supprime la **dernière ligne** de `log` et renvoie ce qu'il a supprimé (affiché dans le toast).
**Raison** : garder le principe "une seule zone de saisie" — pas de bouton, pas d'écran de gestion. Le mot-clé est intercepté côté client, donc impossible de logger une dépense libellée "annule" : cas jugé négligeable.
**Limite assumée** : "dernière ligne du Sheet" = la plus récente **chronologiquement insérée**, quel que soit l'appareil. Usage mono-utilisateur : le risque de supprimer la ligne d'un "autre" est nul. Pour corriger plus vieux que la dernière ligne → édition directe du Sheet.

## D18 — Répétition : libellé seul = dernier montant connu
**Choix** : si la saisie n'a pas de montant (`code: 'no_amount'`), le backend cherche la ligne la plus récente dont le **libellé normalisé est identique** au texte saisi, et reprend son montant. Réponse marquée `repeated: true` → toast `✓ 30,00 € → nourriture · montant repris`.
**Raison** : les dépenses récurrentes à montant fixe (abo, sandwich habituel) tombent à un seul mot tapé.
**Écarté** : correspondance floue ou par mot-clé (trop de reprises accidentelles — un montant erroné silencieux est pire qu'une erreur explicite) ; date optionnelle avec la répétition (`picard hier` ne matche pas un libellé "picard hier" et renverra l'erreur standard — combinaison jugée rare).

## D19 — Champ de config token supprimé : le lien `#token=...` est la seule voie
**Choix** : plus de champ "colle le token ici". Sans token (ou token rejeté), la PWA affiche un message renvoyant vers le lien d'installation `#token=...` — mécanisme de [D14] inchangé.
**Raison** : demande utilisateur ; une seule voie d'entrée = moins de surface UI et moins de risques de manipulation (token tapé à la main, tronqué, collé avec espaces). Le lien réenregistre le token à l'identique sur tout appareil.
**Conséquence** : le lien d'installation devient le seul "sésame" — à conserver (gestionnaire de mots de passe). Perdu → `printNewToken()` dans l'éditeur et nouveau lien.

## D20 — Mini-graph des catégories du mois dans l'app
**Choix** : `?action=today` renvoie aussi `by_category` (totaux du mois par catégorie, triés décroissants, calculés dans la même passe que le reste du récap). L'app les rend en barres horizontales CSS pures (largeur relative au max), sous la ligne de récap.
**Écarté** : lib de charts (contraire au "un seul fichier, pas de framework") ; camembert SVG (illisible en petit, les barres se comparent mieux) ; périmètre "jour" (trop peu de catégories un jour donné pour être parlant — le mois montre le "style de dépense").

## D21 — Dashboard v2 : matrice mois × catégorie, cumul journalier, tendance
**Choix** : `buildDashboard()` construit en plus (a) une matrice 12 mois × catégories (SUMIFS par cellule, colonnes = catégories distinctes de l'onglet `categories` + `autre`) alimentant un graph **colonnes empilées** ; (b) un tableau cumul journalier jour 1→31 du mois en cours vs précédent alimentant un graph **lignes** (la comparaison "suis-je en avance sur mes dépenses ?" en un coup d'œil) ; (c) une **courbe de tendance** linéaire sur l'évolution 12 mois.
**Rebuild à distance** : action `?action=rebuild_dashboard` (token requis) — permanente car nécessaire après ajout d'une catégorie (matrice figée à la construction) et sans danger (idempotent, ne touche ni `log` ni `categories`).
**Limite assumée** : jours 29–31 absents des mois courts → cellules vides, les courbes s'arrêtent proprement.

## D22 — Refonte layout : tuiles de stats, toast en overlay, couleurs par catégorie
**Choix** : (a) le récap texte devient deux **tuiles** côte à côte (Aujourd'hui / Ce mois) avec gros chiffres tabulaires ; (b) le **toast** passe en overlay fixe bas d'écran — il ne réserve plus d'espace dans le flux (c'était la cause du grand vide sous le champ, ×3 en pixels physiques sur mobile) ; (c) chaque catégorie reçoit une **couleur stable** dérivée d'un hash de son nom (`hsl(h 45% 55%)`), utilisée dans les barres et en pastille dans la liste du jour ; (d) compteur hors-ligne masqué quand la file est vide.
**Raison** : hiérarchie visuelle (les deux chiffres qui comptent d'abord), densité verticale (le contenu remonte sous le champ), lisibilité de la liste (pastille couleur + catégorie en petit).
**Écarté** : palette fixe par catégorie (à maintenir à la main à chaque nouvelle catégorie — le hash est automatique et cohérent entre sessions).

## D23 — Post-mortem : `setFormula` dépend de la locale du Sheet (D6 était faux)
**Constat** (signalé par l'utilisateur : « les formules du gsheet sont erronées ») : sur un Sheet en locale `fr_FR`, **tout** le dashboard était en `#ERROR!`. Contrairement à l'hypothèse de [D6], `Range.setFormula()` interprète la chaîne **dans la locale du Sheet** : en fr_FR, `=EOMONTH(TODAY(),-1)` est une erreur de syntaxe, et plus vicieux, `=SUM(1,2)` vaut **1,2** (la virgule devient décimale — résultat silencieusement faux, pas d'erreur visible).
**Preuve** (test empirique dans le Sheet réel) : `=SUM(1,2)` → `1,2` ; `=SUM(1;2)` → `3` ; `=EOMONTH(TODAY(),-1)` → `#ERROR!` ; `=EOMONTH(TODAY();-1)` → `30/06/2026`.
**Correctif** : `buildDashboard()` détecte le séparateur **empiriquement** à chaque construction (pose `=SUM(1;2)` dans une cellule brouillon : 3 → `;`, sinon `,`) et traduit toutes les formules, écrites en interne avec `;`. Robuste pour toute locale, y compris si elle change plus tard (il suffit d'un rebuild).
**Leçon** : vérifier les valeurs calculées après construction (les formules étaient posées sans erreur d'exécution Apps Script — l'erreur n'était visible que dans les cellules).
