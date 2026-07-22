/**
 * Expense Tracker — backend Google Apps Script.
 *
 * Script container-bound au Google Sheet. Déployé en Web App :
 *   - Exécuter en tant que : moi
 *   - Accès : tout le monde
 *
 * Onglets attendus (créés par setup()) :
 *   log        : timestamp | date | montant | libelle | categorie | raw_input
 *   categories : keyword | categorie
 *   dashboard  : formules + graphs (générés par setup())
 */

var TZ = 'Europe/Brussels';
var SHEET_LOG = 'log';
var SHEET_CAT = 'categories';
var SHEET_DASH = 'dashboard';

/* ------------------------------------------------------------------ */
/* Web App                                                             */
/* ------------------------------------------------------------------ */

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonOut({ ok: false, error: 'empty_body' });
    }
    var body;
    try {
      body = JSON.parse(e.postData.contents);
    } catch (err) {
      return jsonOut({ ok: false, error: 'invalid_json' });
    }

    if (!isAuthorized(body.token)) {
      // Apps Script ne permet pas de renvoyer un vrai 401 : rejet logique.
      return jsonOut({ ok: false, error: 'unauthorized' });
    }

    if (body.action === 'undo') {
      return jsonOut(undoLast());
    }
    if (body.action === 'add_mapping') {
      return jsonOut(addMapping(body.keyword, body.categorie));
    }
    if (body.action === 'recategorize') {
      return jsonOut(recategorizeUnmapped());
    }

    var text = String(body.text || '');
    var defaultDate = validIsoDate(body.client_date) || todayStr();
    var parsed = parseExpense(text, defaultDate);
    if (parsed.error && parsed.code === 'no_amount') {
      // Répétition : "picard" tout seul reprend le dernier montant de ce libellé.
      var lastAmount = lastAmountFor(text.trim());
      if (lastAmount !== null) {
        parsed = { amount: lastAmount, label: text.trim(), date: defaultDate, repeated: true };
      }
    }
    if (parsed.error) {
      return jsonOut({ ok: false, error: parsed.error });
    }

    var category = categorize(parsed.label);
    appendExpense(parsed, category, text);

    return jsonOut({
      ok: true,
      amount: parsed.amount,
      label: parsed.label,
      category: category,
      date: parsed.date,
      repeated: Boolean(parsed.repeated)
    });
  } catch (err) {
    return jsonOut({ ok: false, error: 'server_error: ' + err.message });
  }
}

/** GET : .../exec?token=XXX (statut) ou &action=today (récap du jour) */
function doGet(e) {
  var token = e && e.parameter ? e.parameter.token : null;
  if (!isAuthorized(token)) {
    return jsonOut({ ok: false, error: 'unauthorized' });
  }
  if (e.parameter.action === 'today') {
    return jsonOut(todayRecap());
  }
  if (e.parameter.action === 'rebuild_dashboard') {
    buildDashboard(SpreadsheetApp.getActive());
    return jsonOut({ ok: true, rebuilt: true });
  }
  if (e.parameter.action === 'unmapped') {
    return jsonOut(listUnmapped());
  }
  var sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_LOG);
  var lastRow = sheet.getLastRow();
  var last = null;
  if (lastRow > 1) {
    var v = sheet.getRange(lastRow, 1, 1, 6).getValues()[0];
    var d =
      v[1] instanceof Date ? Utilities.formatDate(v[1], TZ, 'yyyy-MM-dd') : String(v[1]);
    last = { date: d, montant: v[2], libelle: v[3], categorie: v[4] };
  }
  return jsonOut({ ok: true, rows: Math.max(0, lastRow - 1), last: last });
}

/** Dépenses du jour (date = aujourd'hui Europe/Brussels) : total + liste,
 *  plus le total du mois en cours. */
function todayRecap() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_LOG);
  var today = todayStr();
  var monthPrefix = today.slice(0, 7); // 'yyyy-MM'
  var items = [];
  var total = 0;
  var monthTotal = 0;
  var catTotals = {};
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    // B..E : date | montant | libelle | categorie
    var vals = sheet.getRange(2, 2, lastRow - 1, 4).getValues();
    for (var i = 0; i < vals.length; i++) {
      var d =
        vals[i][0] instanceof Date
          ? Utilities.formatDate(vals[i][0], TZ, 'yyyy-MM-dd')
          : String(vals[i][0]);
      var amount = Number(vals[i][1]) || 0;
      if (d.slice(0, 7) === monthPrefix) {
        monthTotal += amount;
        var cat = String(vals[i][3]) || 'autre';
        catTotals[cat] = (catTotals[cat] || 0) + amount;
      }
      if (d === today) {
        items.push({
          montant: vals[i][1],
          libelle: String(vals[i][2]),
          categorie: String(vals[i][3])
        });
        total += amount;
      }
    }
  }
  var byCategory = Object.keys(catTotals)
    .map(function (c) {
      return { categorie: c, total: Math.round(catTotals[c] * 100) / 100 };
    })
    .sort(function (a, b) {
      return b.total - a.total;
    });
  return {
    ok: true,
    date: today,
    total: Math.round(total * 100) / 100,
    count: items.length,
    month_total: Math.round(monthTotal * 100) / 100,
    by_category: byCategory,
    items: items
  };
}

/** Supprime la dernière ligne du log (et uniquement elle). */
function undoLast() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_LOG);
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return { ok: false, error: 'Rien à annuler.' };
  }
  var v = sheet.getRange(lastRow, 1, 1, 6).getValues()[0];
  sheet.deleteRow(lastRow);
  return {
    ok: true,
    undone: {
      montant: v[2],
      libelle: String(v[3]),
      categorie: String(v[4])
    }
  };
}

/** Dépenses restées en 'autre', agrégées par libellé (pour le re-mapping). */
function listUnmapped() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_LOG);
  var lastRow = sheet.getLastRow();
  var agg = {};
  if (lastRow > 1) {
    // B..E : date | montant | libelle | categorie
    var vals = sheet.getRange(2, 2, lastRow - 1, 4).getValues();
    for (var i = 0; i < vals.length; i++) {
      if (String(vals[i][3]) !== 'autre') continue;
      var lib = String(vals[i][2]);
      if (!agg[lib]) agg[lib] = { libelle: lib, count: 0, total: 0 };
      agg[lib].count++;
      agg[lib].total += Number(vals[i][1]) || 0;
    }
  }
  var items = Object.keys(agg).map(function (k) {
    agg[k].total = Math.round(agg[k].total * 100) / 100;
    return agg[k];
  });
  items.sort(function (a, b) {
    return b.total - a.total;
  });
  return { ok: true, count: items.length, items: items };
}

/** Ajoute un mot-clé → catégorie dans l'onglet categories (sans doublon). */
function addMapping(keyword, categorie) {
  var kw = normalizeStr(String(keyword || ''));
  var cat = String(categorie || '').trim();
  if (!kw || !cat) {
    return { ok: false, error: 'keyword et categorie requis.' };
  }
  var rules = loadCategoryRules();
  for (var i = 0; i < rules.length; i++) {
    if (rules[i].keyword === kw) {
      return { ok: false, error: 'Mot-clé déjà mappé → ' + rules[i].category };
    }
  }
  SpreadsheetApp.getActive().getSheetByName(SHEET_CAT).appendRow([kw, cat]);
  return { ok: true, added: { keyword: kw, categorie: cat } };
}

/** Repasse la catégorisation sur toutes les lignes restées en 'autre'. */
function recategorizeUnmapped() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_LOG);
  var lastRow = sheet.getLastRow();
  var changed = [];
  if (lastRow > 1) {
    // D..E : libelle | categorie
    var range = sheet.getRange(2, 4, lastRow - 1, 2);
    var vals = range.getValues();
    for (var i = 0; i < vals.length; i++) {
      if (String(vals[i][1]) !== 'autre') continue;
      var cat = categorize(String(vals[i][0]));
      if (cat !== 'autre') {
        vals[i][1] = cat;
        changed.push({ libelle: String(vals[i][0]), categorie: cat });
      }
    }
    if (changed.length) range.setValues(vals);
  }
  return { ok: true, changed: changed.length, details: changed };
}

/** Dernier montant loggé pour ce libellé exact (normalisé), sinon null. */
function lastAmountFor(label) {
  var norm = normalizeStr(label);
  if (!norm) return null;
  var sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_LOG);
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;
  // C..D : montant | libelle
  var vals = sheet.getRange(2, 3, lastRow - 1, 2).getValues();
  for (var i = vals.length - 1; i >= 0; i--) {
    if (normalizeStr(String(vals[i][1])) === norm) {
      return Number(vals[i][0]);
    }
  }
  return null;
}

function isAuthorized(token) {
  var expected = PropertiesService.getScriptProperties().getProperty('TOKEN');
  return Boolean(expected) && token === expected;
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

/* ------------------------------------------------------------------ */
/* Parsing : "<montant> <libellé libre> [hier | avant-hier | JJ/MM]"   */
/* ------------------------------------------------------------------ */

function parseExpense(text, defaultDate) {
  var tokens = text.trim().split(/\s+/).filter(String);
  if (tokens.length === 0) {
    return { error: 'Saisie vide.' };
  }

  // Montant = premier token. Virgule acceptée, "€" toléré en suffixe.
  var amountToken = tokens[0].replace(/€$/, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(amountToken)) {
    return {
      error: 'Montant introuvable — format attendu : "40 picard".',
      code: 'no_amount'
    };
  }
  var amount = Math.round(parseFloat(amountToken) * 100) / 100;
  if (amount <= 0) {
    return { error: 'Le montant doit être positif.' };
  }

  var labelTokens = tokens.slice(1);

  // Date optionnelle, détectée uniquement en fin de saisie.
  var date = defaultDate;
  if (labelTokens.length > 1) {
    var lastTok = normalizeStr(labelTokens[labelTokens.length - 1]);
    var prevTok =
      labelTokens.length > 2
        ? normalizeStr(labelTokens[labelTokens.length - 2])
        : '';
    if (lastTok === 'hier') {
      if (prevTok === 'avant') {
        date = shiftDays(defaultDate, -2);
        labelTokens = labelTokens.slice(0, -2);
      } else {
        date = shiftDays(defaultDate, -1);
        labelTokens = labelTokens.slice(0, -1);
      }
    } else if (lastTok === 'avant-hier') {
      date = shiftDays(defaultDate, -2);
      labelTokens = labelTokens.slice(0, -1);
    } else {
      var m = lastTok.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
      if (m) {
        var explicit = resolveDayMonth(
          parseInt(m[1], 10),
          parseInt(m[2], 10),
          m[3] ? parseInt(m[3], 10) : null,
          defaultDate
        );
        if (!explicit) {
          return { error: 'Date invalide : "' + labelTokens[labelTokens.length - 1] + '".' };
        }
        date = explicit;
        labelTokens = labelTokens.slice(0, -1);
      }
    }
  }

  var label = labelTokens.join(' ').trim();
  if (!label) {
    return { error: 'Libellé manquant — format attendu : "40 picard".' };
  }

  return { amount: amount, label: label, date: date };
}

/** JJ/MM[/AAAA] → 'yyyy-MM-dd'. Sans année : année courante, ou précédente si la date serait dans le futur. */
function resolveDayMonth(day, month, year, defaultDate) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year !== null && year < 100) year += 2000;
  var refYear = parseInt(defaultDate.slice(0, 4), 10);
  var y = year !== null ? year : refYear;
  var iso = pad4(y) + '-' + pad2(month) + '-' + pad2(day);
  if (year === null && iso > defaultDate) {
    iso = pad4(y - 1) + '-' + pad2(month) + '-' + pad2(day);
  }
  // Validation réelle (rejette 31/02 & co).
  var d = new Date(iso + 'T12:00:00Z');
  if (isNaN(d.getTime()) || d.getUTCDate() !== day || d.getUTCMonth() + 1 !== month) {
    return null;
  }
  return iso;
}

function todayStr() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

function shiftDays(isoDate, delta) {
  var d = new Date(isoDate + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
}

function validIsoDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

function pad4(n) {
  return ('000' + n).slice(-4);
}

/* ------------------------------------------------------------------ */
/* Catégorisation : mot-clé contenu dans le libellé                    */
/* ------------------------------------------------------------------ */

function categorize(label) {
  var normalized = normalizeStr(label);
  var rules = loadCategoryRules();
  for (var i = 0; i < rules.length; i++) {
    if (normalized.indexOf(rules[i].keyword) !== -1) {
      return rules[i].category;
    }
  }
  return 'autre';
}

/** Lit l'onglet categories. Tri par longueur de mot-clé décroissante :
 *  "uber eats" doit gagner sur "uber", "cadeau" sur "eau". */
function loadCategoryRules() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_CAT);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  var rules = [];
  for (var i = 0; i < values.length; i++) {
    var kw = normalizeStr(String(values[i][0]));
    var cat = String(values[i][1]).trim();
    if (kw && cat) rules.push({ keyword: kw, category: cat });
  }
  rules.sort(function (a, b) {
    return b.keyword.length - a.keyword.length;
  });
  return rules;
}

/** minuscules + accents retirés (NFD puis suppression des diacritiques combinants) */
function normalizeStr(s) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

/* ------------------------------------------------------------------ */
/* Écriture                                                            */
/* ------------------------------------------------------------------ */

function appendExpense(parsed, category, rawInput) {
  var sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_LOG);
  var timestamp = Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ss");
  sheet.appendRow([
    timestamp,
    dateForSheet(parsed.date),
    parsed.amount,
    parsed.label,
    category,
    rawInput
  ]);
  var row = sheet.getLastRow();
  sheet.getRange(row, 2).setNumberFormat('dd/mm/yyyy');
  sheet.getRange(row, 3).setNumberFormat('#,##0.00 "€"');
}

/** 'yyyy-MM-dd' → Date à minuit Europe/Brussels, pour que la cellule soit une
 *  vraie date (pas du texte) et que SUMIFS/QUERY du dashboard fonctionnent. */
function dateForSheet(iso) {
  var utcMidnight = new Date(iso + 'T00:00:00Z');
  var z = Utilities.formatDate(utcMidnight, TZ, 'Z'); // ex. "+0200"
  var sign = z.charAt(0) === '-' ? -1 : 1;
  var offsetMin =
    sign * (parseInt(z.substr(1, 2), 10) * 60 + parseInt(z.substr(3, 2), 10));
  return new Date(utcMidnight.getTime() - offsetMin * 60000);
}

/* ------------------------------------------------------------------ */
/* setup() : à exécuter UNE FOIS depuis l'éditeur Apps Script          */
/* Crée les onglets, seed les catégories, construit le dashboard.      */
/* Idempotent : ré-exécutable sans casser les données existantes.      */
/* ------------------------------------------------------------------ */

var SEED_CATEGORIES = [
  ['picard', 'nourriture'], ['delhaize', 'nourriture'], ['colruyt', 'nourriture'],
  ['carrefour', 'nourriture'], ['lidl', 'nourriture'], ['aldi', 'nourriture'],
  ['proxy', 'nourriture'],
  ['resto', 'restaurant'], ['restaurant', 'restaurant'], ['uber eats', 'restaurant'],
  ['deliveroo', 'restaurant'], ['takeaway', 'restaurant'], ['frit', 'restaurant'],
  ['kebab', 'restaurant'], ['sushi', 'restaurant'],
  ['cafe', 'sorties'], ['bar', 'sorties'], ['biere', 'sorties'], ['apero', 'sorties'],
  ['stib', 'transport'], ['sncb', 'transport'], ['de lijn', 'transport'],
  ['tec', 'transport'], ['villo', 'transport'], ['uber', 'transport'],
  ['taxi', 'transport'], ['bolt', 'transport'],
  ['zalando', 'shopping'], ['decathlon', 'shopping'], ['vetement', 'shopping'],
  ['fnac', 'shopping'], ['mediamarkt', 'shopping'], ['amazon', 'shopping'],
  ['pharmacie', 'sante'], ['medecin', 'sante'], ['dentiste', 'sante'], ['kine', 'sante'],
  ['netflix', 'abonnements'], ['spotify', 'abonnements'], ['abo', 'abonnements'],
  ['telenet', 'abonnements'], ['proximus', 'abonnements'], ['orange', 'abonnements'],
  ['base', 'abonnements'],
  ['loyer', 'logement'], ['charges', 'logement'], ['electricite', 'logement'],
  ['gaz', 'logement'], ['eau', 'logement'], ['assurance', 'logement'],
  ['cadeau', 'cadeaux'],
  ['sport', 'sport'], ['salle', 'sport'], ['padel', 'sport'], ['foot', 'sport']
];

function setup() {
  var ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone(TZ);

  // --- log ---
  var log = ss.getSheetByName(SHEET_LOG) || ss.insertSheet(SHEET_LOG);
  if (log.getLastRow() === 0) {
    log.appendRow(['timestamp', 'date', 'montant', 'libelle', 'categorie', 'raw_input']);
  }
  log.setFrozenRows(1);
  log.getRange('A1:F1').setFontWeight('bold');

  // --- categories ---
  var cat = ss.getSheetByName(SHEET_CAT) || ss.insertSheet(SHEET_CAT);
  if (cat.getLastRow() === 0) {
    cat.appendRow(['keyword', 'categorie']);
    cat.getRange(2, 1, SEED_CATEGORIES.length, 2).setValues(SEED_CATEGORIES);
  }
  cat.setFrozenRows(1);
  cat.getRange('A1:B1').setFontWeight('bold');

  // --- dashboard ---
  buildDashboard(ss);

  Logger.log('Setup terminé. Pense à définir le TOKEN (voir printNewToken).');
}

/** Génère un token aléatoire, le stocke dans les Script Properties et l'affiche. */
function printNewToken() {
  var bytes = Utilities.getUuid() + '-' + Utilities.getUuid();
  var token = bytes.replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('TOKEN', token);
  Logger.log('TOKEN (à coller dans index.html) : ' + token);
}

/** setFormula interprète la formule dans la LOCALE du Sheet (fr_FR → ';').
 *  Les formules ci-dessous sont écrites avec ';' et converties si besoin
 *  après détection empirique du séparateur (cf. detectFormulaSeparator). */
function buildDashboard(ss) {
  var dash = ss.getSheetByName(SHEET_DASH) || ss.insertSheet(SHEET_DASH);
  dash.clear();
  dash.getCharts().forEach(function (c) {
    dash.removeChart(c);
  });

  var sep = detectFormulaSeparator(dash);
  // tf : traduit une formule écrite avec ';' vers le séparateur détecté.
  // Aucune de nos formules ne contient de ';' littéral dans une chaîne.
  var tf = function (f) {
    return sep === ';' ? f : f.replace(/;/g, sep);
  };

  // Totaux
  dash.getRange('A1').setValue('Total mois en cours');
  dash
    .getRange('B1')
    .setFormula(
      tf('=SUMIFS(log!C:C;log!B:B;">="&(EOMONTH(TODAY();-1)+1);log!B:B;"<="&EOMONTH(TODAY();0))')
    );
  dash.getRange('A2').setValue('Total mois précédent');
  dash
    .getRange('B2')
    .setFormula(
      tf('=SUMIFS(log!C:C;log!B:B;">="&(EOMONTH(TODAY();-2)+1);log!B:B;"<="&EOMONTH(TODAY();-1))')
    );
  dash.getRange('A3').setValue('Écart vs mois précédent');
  dash.getRange('B3').setFormula('=B1-B2');
  dash.getRange('B1:B3').setNumberFormat('#,##0.00 "€"');
  dash.getRange('A1:A3').setFontWeight('bold');

  // Répartition par catégorie (mois en cours)
  dash.getRange('A5').setValue('Par catégorie (mois en cours)');
  dash.getRange('A5').setFontWeight('bold');
  dash
    .getRange('A6')
    .setFormula(
      tf('=IFERROR(QUERY(log!B:E;"select E, sum(C) where B >= date \'"&TEXT(EOMONTH(TODAY();-1)+1;"yyyy-mm-dd")&"\' group by E order by sum(C) desc label E \'Catégorie\', sum(C) \'Total\'";1);"—")')
    );

  // Top 10 libellés (mois en cours)
  dash.getRange('D5').setValue('Top 10 libellés (mois en cours)');
  dash.getRange('D5').setFontWeight('bold');
  dash
    .getRange('D6')
    .setFormula(
      tf('=IFERROR(QUERY(log!B:E;"select D, sum(C) where B >= date \'"&TEXT(EOMONTH(TODAY();-1)+1;"yyyy-mm-dd")&"\' group by D order by sum(C) desc limit 10 label D \'Libellé\', sum(C) \'Total\'";1);"—")')
    );

  // Évolution sur 12 mois : lignes 7..18 (offsets -11 → 0)
  dash.getRange('G5').setValue('Évolution 12 mois');
  dash.getRange('G5').setFontWeight('bold');
  dash.getRange('G6').setValue('Mois');
  dash.getRange('H6').setValue('Total');
  for (var r = 7; r <= 18; r++) {
    var offset = r - 18; // -11 .. 0
    dash
      .getRange('G' + r)
      .setFormula(tf('=TEXT(EOMONTH(TODAY();' + (offset - 1) + ')+1;"mm/yyyy")'));
    dash
      .getRange('H' + r)
      .setFormula(
        tf(
          '=SUMIFS(log!C:C;log!B:B;">="&(EOMONTH(TODAY();' +
            (offset - 1) +
            ')+1);log!B:B;"<="&EOMONTH(TODAY();' +
            offset +
            '))'
        )
      );
  }
  dash.getRange('H7:H18').setNumberFormat('#,##0.00 "€"');

  // Matrice mois × catégorie : J5.., libellés mois en J, une colonne par catégorie
  var cats = uniqueCategories(ss);
  dash.getRange('J5').setValue('Par mois et catégorie');
  dash.getRange('J5').setFontWeight('bold');
  dash.getRange('J6').setValue('Mois');
  var c;
  for (c = 0; c < cats.length; c++) {
    dash.getRange(6, 11 + c).setValue(cats[c]);
  }
  dash.getRange(6, 10, 1, 1 + cats.length).setFontWeight('bold');
  for (r = 7; r <= 18; r++) {
    var off = r - 18; // -11 .. 0
    dash
      .getRange(r, 10)
      .setFormula(tf('=TEXT(EOMONTH(TODAY();' + (off - 1) + ')+1;"mm/yyyy")'));
    for (c = 0; c < cats.length; c++) {
      dash
        .getRange(r, 11 + c)
        .setFormula(
          tf(
            '=SUMIFS(log!$C:$C;log!$B:$B;">="&(EOMONTH(TODAY();' +
              (off - 1) +
              ')+1);log!$B:$B;"<="&EOMONTH(TODAY();' +
              off +
              ');log!$E:$E;' +
              colLetter(11 + c) +
              '$6)'
          )
        );
    }
  }
  dash.getRange(7, 11, 12, cats.length).setNumberFormat('#,##0 "€"');

  // Cumul journalier : mois en cours vs mois précédent (lignes 21..52)
  dash.getRange('A20').setValue('Cumul journalier');
  dash.getRange('A20').setFontWeight('bold');
  dash.getRange('A21').setValue('Jour');
  dash.getRange('B21').setValue('Mois en cours');
  dash.getRange('C21').setValue('Mois précédent');
  dash.getRange('A21:C21').setFontWeight('bold');
  for (r = 22; r <= 52; r++) {
    var day = r - 21; // 1 .. 31
    dash.getRange(r, 1).setValue(day);
    dash
      .getRange(r, 2)
      .setFormula(
        tf(
          '=IF($A' +
            r +
            '>DAY(TODAY());"";SUMIFS(log!$C:$C;log!$B:$B;">="&(EOMONTH(TODAY();-1)+1);log!$B:$B;"<="&(EOMONTH(TODAY();-1)+$A' +
            r +
            ')))'
        )
      );
    dash
      .getRange(r, 3)
      .setFormula(
        tf(
          '=IF($A' +
            r +
            '>DAY(EOMONTH(TODAY();-1));"";SUMIFS(log!$C:$C;log!$B:$B;">="&(EOMONTH(TODAY();-2)+1);log!$B:$B;"<="&(EOMONTH(TODAY();-2)+$A' +
            r +
            ')))'
        )
      );
  }
  dash.getRange('B22:C52').setNumberFormat('#,##0 "€"');

  // Graphs
  dash.insertChart(
    dash
      .newChart()
      .asPieChart()
      .addRange(dash.getRange('A6:B16'))
      .setNumHeaders(1)
      .setOption('title', 'Répartition du mois par catégorie')
      .setPosition(20, 4, 0, 0)
      .build()
  );

  dash.insertChart(
    dash
      .newChart()
      .asColumnChart()
      .addRange(dash.getRange('G6:H18'))
      .setNumHeaders(1)
      .setOption('title', 'Dépenses par mois (12 derniers mois)')
      .setOption('trendlines', { 0: { type: 'linear' } })
      .setPosition(20, 10, 0, 0)
      .build()
  );

  dash.insertChart(
    dash
      .newChart()
      .asColumnChart()
      .addRange(dash.getRange(6, 10, 13, 1 + cats.length))
      .setNumHeaders(1)
      .setOption('isStacked', true)
      .setOption('title', 'Par mois et catégorie (empilé)')
      .setPosition(40, 1, 0, 0)
      .build()
  );

  dash.insertChart(
    dash
      .newChart()
      .asLineChart()
      .addRange(dash.getRange('A21:C52'))
      .setNumHeaders(1)
      .setOption('title', 'Cumul journalier : mois en cours vs précédent')
      .setPosition(40, 7, 0, 0)
      .build()
  );
}

/** Détection empirique du séparateur d'arguments selon la locale du Sheet :
 *  pose =SUM(1;2) dans une cellule brouillon — si ça vaut 3, c'est ';'. */
function detectFormulaSeparator(sheet) {
  var cell = sheet.getRange('Z100');
  var sep;
  try {
    cell.setFormula('=SUM(1;2)');
    SpreadsheetApp.flush();
    sep = cell.getValue() === 3 ? ';' : ',';
  } catch (err) {
    sep = ','; // locale en-US : '=SUM(1;2)' peut être rejeté d'emblée
  }
  cell.clear();
  return sep;
}

/** Catégories distinctes de l'onglet categories (ordre d'apparition) + 'autre'. */
function uniqueCategories(ss) {
  var sheet = ss.getSheetByName(SHEET_CAT);
  var cats = [];
  var seen = {};
  if (sheet && sheet.getLastRow() > 1) {
    var vals = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < vals.length; i++) {
      var cat = String(vals[i][0]).trim();
      if (cat && !seen[cat]) {
        seen[cat] = true;
        cats.push(cat);
      }
    }
  }
  if (!seen['autre']) cats.push('autre');
  return cats;
}

/** 1 → A, 11 → K, 27 → AA. */
function colLetter(n) {
  var s = '';
  while (n > 0) {
    var m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/* ------------------------------------------------------------------ */
/* Tests rapides (exécutables depuis l'éditeur)                        */
/* ------------------------------------------------------------------ */

function testParsing() {
  var today = todayStr();
  var cases = [
    '40 picard',
    '12.5 resto midi',
    '12,5 resto',
    '8 stib',
    '25 cadeau anniv marie',
    '60 zalando',
    'inconnu 15',
    '40 picard hier',
    '40 picard 15/07',
    '40€ picard'
  ];
  cases.forEach(function (c) {
    var p = parseExpense(c, today);
    var cat = p.error ? '—' : categorize(p.label);
    Logger.log(c + '  →  ' + JSON.stringify(p) + '  cat=' + cat);
  });
}
