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

## D24 — Actions d'administration du dict : `unmapped`, `add_mapping`, `recategorize`
**Choix** : trois actions token-protégées pour gérer le dict de catégories **à distance** (sans ouvrir le Sheet ni l'éditeur) : `GET ?action=unmapped` (dépenses restées en `autre`, agrégées par libellé), `POST action=add_mapping {keyword, categorie}` (ajout avec normalisation + refus des doublons), `POST action=recategorize` (repasse la catégorisation sur toutes les lignes `autre` avec le dict courant — ne touche jamais une ligne déjà catégorisée, y compris re-catégorisée à la main).
**Raison** : (a) permet d'administrer le dict depuis n'importe quel client HTTP — dont un **agent Claude planifié** qui ferait le tri des `autre` périodiquement ; (b) a servi immédiatement à ajouter la catégorie `chat` sans manipulation manuelle.
**Rappel** : après `add_mapping` d'une **nouvelle** catégorie, faire un `rebuild_dashboard` (colonne de la matrice, cf. [D21]).
**Cas d'école** : le mot-clé `chat` n'a PAS été ajouté — en matching par sous-chaîne ([D3]) il capturerait `achat`/`achats`. La catégorie vit via `charloe`, `veto`, `veterinaire`, `croquette`, `litiere`.

## D25 — Review FE : shadowing de `window.history`, courses, SW stale-while-revalidate
**Constat** (review du front) : trois défauts.
(a) `const history = []` masquait `window.history` → `history.replaceState()` dans `captureTokenFromHash()` ne s'exécutait jamais (ReferenceError TDZ au chargement, TypeError sur `hashchange`, tous deux avalés par le try/catch) ; c'était le fallback `location.hash = ''` qui nettoyait l'URL, en laissant un `#` résiduel. **Correctif** : tableau renommé `session`.
(b) `flushQueue()` travaillait sur un snapshot de la file : une saisie mise en file pendant un `await apiSend()` (fetch qui échoue pendant la synchro) était **écrasée** par le `setQueue(snapshot)` suivant — violation du critère "ne jamais perdre une saisie" ([D5]). **Correctif** : la file est relue depuis `localStorage` à chaque tour de boucle.
(c) Deux `fetchRecap()` concurrents (saisie confirmée + retour au premier plan) pouvaient se résoudre dans le désordre → récap périmé affiché. **Correctif** : compteur de séquence, seule la réponse du dernier appel est rendue.
**En plus** : `aria-label` sur le champ de saisie et `role="status"` sur le compteur hors-ligne (accessibilité).

## D26 — SW : stale-while-revalidate au lieu de cache-first pur
**Choix** : le SW sert le cache immédiatement puis rafraîchit l'asset en arrière-plan (`cache.put` si réponse ok) — la prochaine ouverture a la nouvelle version.
**Raison** : le cache-first pur ([D11]) exigeait de penser à bumper `expenses-vN` à chaque évolution des assets ("rappel opérationnel" de [D15]) — un oubli et les téléphones restaient figés sur l'ancienne version. Le SWR garde l'ouverture instantanée hors-ligne (critère de done) tout en supprimant ce piège humain.
**Conséquence** : le bump de `CACHE` n'est plus nécessaire pour diffuser une mise à jour (une ouverture en ligne suffit, la suivante l'affiche) ; il reste utile pour purger des assets supprimés. Bump ponctuel `v6 → v7` pour migrer les clients existants.
**Écarté** : network-first sur `index.html` (ouverture ralentie par le timeout réseau en zone blanche — contraire au "zéro-friction").

## D27 — Couleurs par catégorie : palette fixe validée au lieu du hash HSL
**Constat** : le hash `hsl(h 45% 55%)` de [D22] produisait des teintes trop proches entre catégories (tout à la même saturation/luminosité, teintes au hasard) — demande utilisateur : « couleurs différentes pour les catégories ».
**Choix** : carte fixe catégorie → couleur, en dur dans `index.html`. 8 slots issus d'une palette catégorielle validée pour fond sombre + 3 teintes complémentaires (cyan, lime, brun) + **gris neutre pour `autre`** (sémantique du fourre-tout). Vérifiée par script (validateur de palette) contre la surface réelle `#1a1d24` : bande de luminosité OKLCH 0.48–0.67, chroma ≥ 0.1, contraste ≥ 3:1 — tout passe. Assignation sémantique quand ça tombe bien (nourriture=vert, santé=rouge, chat=brun…).
**Limite mesurée** : au-delà de ~4 couleurs, aucune palette ne peut garantir la séparation daltonisme sur *toutes* les paires (mathématiquement impossible — la pire paire ici : rouge/orange ΔE 7.1 en vision normale). Parade standard : l'identité n'est jamais portée par la couleur seule — chaque barre et chaque ligne affiche le nom de la catégorie en texte. C'était déjà le cas.
**Fallback** : catégorie inconnue (ajoutée via `add_mapping` sans mise à jour de la carte) → hash stable vers un slot de la même palette (même couleur sur tous les appareils) ; le gris reste réservé à `autre`. Ajouter la nouvelle catégorie à `CAT_COLORS` à l'occasion.
**Écarté** : hash amélioré (ne résout pas la proximité des teintes) ; assignation par rang du mois (la couleur doit suivre l'entité, pas son rang — sinon les couleurs changent chaque mois).

## D28 — `form[hidden]` neutralisé par `display:flex` (bug pré-existant, vu en vérifiant D27)
**Constat** (capture d'écran de l'état sans token) : le formulaire restait **visible** en même temps que le message « Token manquant » — `form.hidden = true` dans `showNoToken()` était sans effet car la règle auteur `form { display: flex }` écrase le `display: none` que le navigateur applique à `[hidden]`.
**Correctif** : règle `form[hidden] { display: none; }` — le même pattern existait déjà pour `#pending` et `#listTitle`, seul `form` avait été oublié.
**Leçon** : tout élément qui reçoit un `display` explicite en CSS **et** est masqué via l'attribut `hidden` doit avoir sa règle `[hidden]` dédiée.

## D29 — Cache local du dernier récap + états de chargement distincts
**Constat** (vécu au déploiement de D27 : « j'ai l'impression de n'avoir aucune data ») : tant que `fetchRecap()` n'a pas répondu — hors-ligne, réseau lent, cold start Apps Script (~7 s mesurées) — l'app affichait « — » et zéro barre : indistinguable d'une app vide ou cassée.
**Choix** : (a) le dernier récap confirmé est conservé en `localStorage` (`expense_recap_v1`, avec sa date et son horodatage) et affiché **immédiatement** au chargement, estompé (`main.stale`, opacité 0.55) avec la mention « il y a X » dans la tuile du jour ; remplacé dès que le réseau répond. (b) Pendant un premier chargement sans cache, les tuiles affichent « … » (chargement) ; « — » est réservé à « pas de données » (réponse arrivée, vide ou refusée).
**Cohérence avec [D15]** : le Sheet reste la seule source de vérité — le cache est un affichage d'attente, jamais une source de calcul, et il est réécrit intégralement à chaque réponse fraîche.
**Bascule de jour** : un cache daté d'un autre jour du même mois affiche le jour à 0,00 € (liste vide) et garde le mois à titre indicatif ; un cache d'un autre mois est ignoré.
**Écarté** : recalculer le récap côté client depuis un historique local (divergence avec le Sheet, cf. [D12]/[D15]) ; masquer complètement les données périmées (c'est précisément le symptôme qu'on corrige).

## D30 — Détail par catégorie : clic sur une barre → dépenses du mois dépliées
**Choix** : `?action=today` renvoie aussi, dans chaque entrée `by_category`, les dépenses du mois de la catégorie (`items` : date, montant, libellé — plus récent d'abord), collectées **dans la même passe de lecture** que les totaux (zéro lecture supplémentaire du Sheet). Côté PWA, chaque barre devient dépliable (chevron ▸/▾, clic ou Entrée/Espace, `role="button"` + `aria-expanded`) ; plusieurs catégories peuvent être ouvertes à la fois, l'état déplié survit aux rafraîchissements du récap.
**Synergie [D29]** : le détail voyage dans le récap mis en cache → consultable hors-ligne. Poids : ~10-20 Ko pour un mois chargé, négligeable.
**Dégradation** : tant que le backend déployé ne renvoie pas `items` (ou avec un vieux cache), les barres restent non cliquables, sans chevron — la PWA peut se déployer avant le backend.
**Écarté** : action dédiée `?action=cat_items` à la demande (un aller-retour Apps Script par clic — jusqu'à ~7 s de cold start mesurées, inacceptable pour un simple dépli) ; accordéon à ouverture unique (comparer deux catégories est un usage naturel).
**Rappel déploiement backend** : `clasp push -f` puis `clasp redeploy <deploymentId>` depuis `apps-script/` (cf. SETUP.md Maintenance), ou l'éditeur Apps Script (Déployer → Gérer les déploiements → Nouvelle version).
