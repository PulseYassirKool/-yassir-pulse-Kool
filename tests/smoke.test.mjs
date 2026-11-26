// Test d'intégration : vrai HTML + vrai code de l'application (jsdom) + vraie API (worker) branchée en mémoire.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { handle, hashPassword } from '../worker/src/index.js';

const seed = existsSync('private/seed.json') ? JSON.parse(readFileSync('private/seed.json', 'utf8')) : { live: { PORTFOLIOS_SHEET_ID: 'SHEET_TEST_ID_000000000000000000000000000' }, kool: {}, commissions: { 'test resto': 20 }, portfolios: {} };
// IDs Kool simulés : le test ne doit pas dépendre de private/seed.json (gitignoré, absent en CI).
// Sans eux, la config Kool du bootstrap est vide et le mock ne répond à aucune feuille.
const koolTestIds = {
  DATA_SHEET_ID: 'KOOL_DATA_TEST_ID_000000000001', ORDER_ITEMS_SHEET_ID: 'KOOL_ITEMS_TEST_ID_000000000002',
  COMMISSION_SHEET_ID: 'KOOL_COMM_TEST_ID_000000000003', PORTFOLIOS_SHEET_ID: 'KOOL_PORT_TEST_ID_000000000004',
  OFFRE_PARTICIPATION_SHEET_ID: 'KOOL_OFFRE_TEST_ID_000000000005',
  BUDGET_SHEET_ID: 'KOOL_BUDGET_TEST_ID_000000000007', HISTORICAL_2025_SHEET_ID: 'KOOL_2025_TEST_ID_000000000006',
  DATA_GID: '0', ORDER_ITEMS_GID: '0', COMMISSION_GID: '0', PORTFOLIOS_GID: '0', OFFRE_PARTICIPATION_GID: '0',
  BUDGET_GID: '11', HISTORICAL_2025_GID: '14',
};
const koolCfg = { ...koolTestIds, ...(seed.kool || {}) };
// En-têtes cibles (111 colonnes) lus depuis le code source : le test Yassir
// construit un vrai fichier Data exp avec ces en-têtes exacts (eval du littéral
// du dépôt, jamais de private/seed.json).
const TARGET_HEADERS_TEST = eval(readFileSync('src/js/03-constants.js', 'utf8').match(/var TARGET_HEADERS = (\[[\s\S]*?\n      \]);/)[1]);
// Une ligne Data exp Yassir (seules les colonnes utilisées par la participation
// sont remplies ; le moteur aligne le reste sur TARGET_HEADERS).
const yassirRow = (date, oid, resto, itemTot, dAmt, dType, fCat) => {
  const r = new Array(TARGET_HEADERS_TEST.length).fill('');
  r[TARGET_HEADERS_TEST.indexOf('order day')] = date;
  r[TARGET_HEADERS_TEST.indexOf('order id')] = oid;
  r[TARGET_HEADERS_TEST.indexOf('restaurant name')] = resto;
  r[TARGET_HEADERS_TEST.indexOf('services')] = 'Food';
  r[TARGET_HEADERS_TEST.indexOf('status')] = 'Delivered';
  r[TARGET_HEADERS_TEST.indexOf('item total')] = itemTot;
  r[TARGET_HEADERS_TEST.indexOf('Total Food')] = itemTot;
  r[TARGET_HEADERS_TEST.indexOf('Discount Amount')] = dAmt;
  r[TARGET_HEADERS_TEST.indexOf('Discount Type')] = dType;
  r[TARGET_HEADERS_TEST.indexOf('Food Category')] = fCat;
  return r;
};
const store = new Map();
const kv = { get: async (k, t) => (store.has(k) ? (t === 'json' ? JSON.parse(store.get(k)) : store.get(k)) : null), put: async (k, v) => void store.set(k, v), delete: async (k) => void store.delete(k) };
const env = { PULSE_KV: kv, JWT_SECRET: 'j'.repeat(48), LEGACY_SALT: 's', ALLOWED_ORIGIN: 'http://localhost' };
store.set('accounts', JSON.stringify([
  { username: 'proprio', hash: await hashPassword('Proprio-Test-123'), role: 'owner', displayName: 'Propriétaire Admin', amName: null, protected: true },
  { username: 'omar.beldi', hash: await hashPassword('Omar-Test-12345'), role: 'am', displayName: 'Omar Beldi', amName: 'Omar Beldi', protected: true }
]));
store.set('config', JSON.stringify({ live: seed.live, kool: koolCfg }));
store.set('defaults', JSON.stringify({ commissions: seed.commissions, portfolios: seed.portfolios }));

const html = readFileSync('index.html', 'utf8').replace(/<script type="module"[^>]*><\/script>/, '').replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '');
const bundle = readFileSync('dist-test/app.js', 'utf8');
const sheetCalls = [];
const errors = [];

function boot() {
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.__PULSE_API__ = 'https://api.test';
  w.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.startsWith('https://api.test')) {
      const r = await handle(new Request(u, { method: opts.method || 'GET', body: opts.body, headers: { Origin: 'http://localhost', ...(opts.headers || {}) } }), env);
      return { ok: r.ok, status: r.status, json: () => r.json(), text: () => r.text() };
    }
    sheetCalls.push(u);
    return { ok: false, status: 404, text: async () => '', json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
  };
  w.addEventListener('error', (e) => errors.push(e.message));
  w.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
  w.eval(bundle);
  return w;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const login = async (w, user, pwd) => {
  w.document.getElementById('loginUsername').value = user;
  w.document.getElementById('loginPassword').value = pwd;
  w.yassirHandleLogin({ preventDefault() {} });
  await wait(1200);
};

test('chargement sans erreur, écran de connexion visible', () => {
  const w = boot();
  assert.equal(w.document.getElementById('loginScreen').classList.contains('hidden'), false);
  assert.equal(w.document.getElementById('appWrapper').classList.contains('hidden'), true);
  assert.deepEqual(errors, []);
});

test('mauvais mot de passe : erreur affichée, application toujours verrouillée', async () => {
  const w = boot();
  await login(w, 'omar.beldi', 'mauvais-mot-de-passe');
  assert.equal(w.document.getElementById('loginErrorBox').classList.contains('hidden'), false);
  assert.equal(w.document.getElementById('appWrapper').classList.contains('hidden'), true);
});

test('connexion AM : app déverrouillée, rôle venant du serveur, synchro Sheets avec les IDs reçus après connexion', async () => {
  const w = boot();
  await login(w, 'omar.beldi', 'Omar-Test-12345');
  assert.equal(w.document.getElementById('appWrapper').classList.contains('hidden'), false);
  assert.equal(w.document.getElementById('headerUserBadge').textContent, 'Omar Beldi');
  const id = seed.live.PORTFOLIOS_SHEET_ID;
  assert.ok(sheetCalls.some((u) => u.includes(id)), 'aucun appel Google Sheets avec les IDs issus de /api/bootstrap');
  assert.equal(w.sessionStorage.getItem('pulse_token_v1').split('.').length, 3);
  assert.equal(w.localStorage.getItem('pulse_token_v1'), null); // pas de "se souvenir de moi" coché
});

test('faux jeton dans le stockage : aucune connexion (ancienne faille « nom d\'utilisateur dans localStorage »)', async () => {
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only' });
  const w = dom.window;
  w.localStorage.setItem('yassir_vf_remember_v9', JSON.stringify({ username: 'proprio', role: 'owner' }));
  w.localStorage.setItem('pulse_token_v1', 'a.b.c');
  w.__PULSE_API__ = 'https://api.test';
  w.fetch = async (u, o = {}) => { const r = await handle(new Request(u, { method: o.method || 'GET', headers: { Origin: 'http://localhost', ...(o.headers || {}) } }), env); return { ok: r.ok, status: r.status, json: () => r.json() }; };
  w.eval(bundle);
  await wait(800);
  assert.equal(w.document.getElementById('appWrapper').classList.contains('hidden'), true);
  assert.equal(w.localStorage.getItem('yassir_vf_remember_v9'), null); // ancienne clé purgée
});

test('propriétaire : liste des comptes via API, sans hash', async () => {
  const w = boot();
  await login(w, 'proprio', 'Proprio-Test-123');
  w.yassirOpenAccessModal();
  await wait(800);
  const rows = w.document.querySelectorAll('#accountsTableBody tr');
  assert.ok(rows.length >= 2);
  assert.equal(w.document.getElementById('accessManagerModal').classList.contains('hidden'), false);
  assert.equal(w.document.getElementById('accountsTableBody').innerHTML.includes('pbkdf2'), false);
});

// ---- Régression Kool : bascule de marque, moteur (ex-crash stat) et Top des ventes ----
// Données simulées (semaine 16-22 nov 2026) servies à la place des feuilles Google Kool.
const csvEsc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const toCsv = (rows) => rows.map((r) => r.map(csvEsc).join(',')).join('\n');
const koolCsvData = toCsv([
  ['Annulé', '', 'Raison annulation', 'Date', 'N° commande', '', 'Restaurant', '', '', 'Montant HT', 'Frais livraison', 'Remise'],
  ['', '', '', '16/11/2026', '1001', '', 'Resto Alpha', '', '', '25.50', '3', '0'],
  ['', '', '', '17/11/2026', '1002', '', 'Resto Alpha', '', '', '40.00', '6', '5'],
  ['', '', '', '17/11/2026', '1003', '', 'Resto Beta', '', '', '18.00', '2', '0'],
  ['oui', '', 'Client absent', '18/11/2026', '1004', '', 'Resto Alpha', '', '', '22.00', '3', '0'],
  // 1005 : livrée le 18/11 mais SANS ligne dans la feuille « détails articles » (cas réel : couverture incomplète).
  ['', '', '', '18/11/2026', '1005', '', 'Resto Alpha', '', '', '10.00', '2', '0']
]);
const koolCsvItems = toCsv([
  ['Order ID', 'Date', 'Restaurant', 'Category', 'Article', 'Quantity', 'Unit Price', 'Discount Price', 'Original Price', 'Type'],
  ['1001', '16/11/2026', 'Resto Alpha', 'Pizza', 'Pizza Margherita', 2, 12, 0, 12, 'Food'],
  ['1001', '16/11/2026', 'Resto Alpha', 'Boisson', 'Coca Cola', 1, 3, 0, 3, 'Food'],
  ['1001', '16/11/2026', 'Resto Alpha', 'Extra', 'Sauce Fromage', 1, 2, 0, 2, 'Extra'],
  ['1002', '17/11/2026', 'Resto Alpha', 'Burger', 'Burger Classic', 1, 15, 0, 15, 'Food'],
  ['1003', '17/11/2026', 'Resto Beta', 'Tacos', 'Tacos Poulet', 3, 9, 0, 9, 'Food']
]);
const koolCsvComm = toCsv([['Restaurant', 'Commission'], ['Resto Alpha', '20'], ['Resto Beta', '15']]);
const koolCsvPort = toCsv([['Restaurant', 'Ville', 'AM'], ['Resto Alpha', 'Tunis', 'Omar Beldi'], ['Resto Beta', 'Ariana', 'Nour Ali']]);
const koolCsvOffre = toCsv([['Restaurant', 'Participation', 'Tag', 'Période'], ['Resto Alpha', '10', 'Toute la carte', '01/11/2026 - 30/11/2026']]);
// Onglet « 2025 Kool » du classeur fusionné (format horizontal W 07..W 47).
const koolCsvHist2025Kool = toCsv([
  ['', 'W 45', 'W 46', 'W 47'],
  ['Requested', 100, 110, 120],
  ['Delivered Orders', 5, 6, 7],
  ['GMV (Total Food VF)', 100, 120, 140],
  ['CA KOOL', 10, 12, 14]
]);

// Variantes pour le test Participation : le Burger de la commande 1002 est remisé
// (12 au lieu de 15) et Resto Alpha a en plus une règle article « Super Promo » à 10 %.
// Resto Beta n'a AUCUNE règle : sa commande 1003 est remisée (3 TND) pour tester la
// règle comptable Kool (2026-11-26, Kool uniquement) : une remise Kool sans règle
// n'est PAS comptable — Beta ne doit apparaître ni en vue carte, ni en vue article.
// Resto Gamma a une règle à participation VIDE (= 0 %) : 100 % restaurant.
// Resto Delta a une règle à 30 % : plafonnement (30 % × brut 52 = 15.60 > remise 2).
const koolCsvDataPart = toCsv([
  ['Annulé', '', 'Raison annulation', 'Date', 'N° commande', '', 'Restaurant', '', '', 'Montant HT', 'Frais livraison', 'Remise'],
  ['', '', '', '16/11/2026', '1001', '', 'Resto Alpha', '', '', '25.50', '3', '0'],
  ['', '', '', '17/11/2026', '1002', '', 'Resto Alpha', '', '', '40.00', '6', '5'],
  ['', '', '', '17/11/2026', '1003', '', 'Resto Beta', '', '', '18.00', '2', '3'],
  ['oui', '', 'Client absent', '18/11/2026', '1004', '', 'Resto Alpha', '', '', '22.00', '3', '0'],
  ['', '', '', '18/11/2026', '1005', '', 'Resto Alpha', '', '', '10.00', '2', '0'],
  // 1006 (Resto Gamma, règle « Toute la carte » à participation VIDE → 0 %) et 1007
  // (Resto Delta, règle à 30 % → plafonnement : 30 % × brut 52 = 15.60 > remise 2).
  ['', '', '', '17/11/2026', '1006', '', 'Resto Gamma', '', '', '20.00', '2', '4'],
  ['', '', '', '17/11/2026', '1007', '', 'Resto Delta', '', '', '50.00', '2', '2']
]);
const koolCsvItemsPart = toCsv([
  ['Order ID', 'Date', 'Restaurant', 'Category', 'Article', 'Quantity', 'Unit Price', 'Discount Price', 'Original Price', 'Type'],
  ['1001', '16/11/2026', 'Resto Alpha', 'Pizza', 'Pizza Margherita', 2, 12, 0, 12, 'Food'],
  ['1001', '16/11/2026', 'Resto Alpha', 'Boisson', 'Coca Cola', 1, 3, 0, 3, 'Food'],
  ['1001', '16/11/2026', 'Resto Alpha', 'Extra', 'Sauce Fromage', 1, 2, 0, 2, 'Extra'],
  ['1002', '17/11/2026', 'Resto Alpha', 'Burger', 'Burger Classic', 1, 15, 12, 15, 'Food'],
  ['1003', '17/11/2026', 'Resto Beta', 'Tacos', 'Tacos Poulet', 3, 9, 8, 9, 'Food']
]);
const koolCsvOffrePart = toCsv([
  ['Restaurant', 'Participation', 'Tag', 'Période'],
  ['Resto Alpha', '10', 'Toute la carte', '01/11/2026 - 30/11/2026'],
  ['Resto Alpha', '10', 'Super Promo', '01/11/2026 - 30/11/2026'],
  ['Resto Gamma', '', 'Toute la carte', '01/11/2026 - 30/11/2026'],
  ['Resto Delta', '30', 'Toute la carte', '01/11/2026 - 30/11/2026']
]);

function bootKool(overrides) {
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.__PULSE_API__ = 'https://api.test';
  w.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.startsWith('https://api.test')) {
      const r = await handle(new Request(u, { method: opts.method || 'GET', body: opts.body, headers: { Origin: 'http://localhost', ...(opts.headers || {}) } }), env);
      return { ok: r.ok, status: r.status, json: () => r.json(), text: () => r.text() };
    }
    if (u.includes('format=xlsx')) return { ok: false, status: 404, text: async () => '', json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
    const kc = koolCfg;
    const ov = overrides || {};
    const match = (id) => id && u.includes(id);
    let body = null;
    if (match(kc.DATA_SHEET_ID)) body = ov.data || koolCsvData;
    else if (match(kc.ORDER_ITEMS_SHEET_ID)) body = ov.items || koolCsvItems;
    else if (match(kc.COMMISSION_SHEET_ID)) body = ov.comm || koolCsvComm;
    else if (match(kc.PORTFOLIOS_SHEET_ID)) body = ov.port || koolCsvPort;
    else if (match(kc.OFFRE_PARTICIPATION_SHEET_ID)) body = ov.offre || koolCsvOffre;
    // 2025 Kool : pas de données par défaut (les tests existants supposent
    // « aucune donnée Kool 2025 ») ; seul un override explicite en fournit.
    else if (match(kc.HISTORICAL_2025_SHEET_ID)) body = ov.hist2025 || null;
    if (body !== null) return { ok: true, status: 200, text: async () => body, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: false, status: 404, text: async () => '', json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
  };
  w.addEventListener('error', (e) => errors.push(e.message));
  w.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
  w.eval(bundle);
  // jsdom n'a pas de canvas : le vrai Chart.js enregistre une instance cassée (canvas null)
  // puis plante au 2e graphique (« Canvas is already in use »). Faux neutre : les valeurs
  // des KPI et des cartes sont déjà dans le DOM, seuls les graphiques sont neutralisés.
  // On enregistre quand même les configurations pour vérifier les couleurs des séries.
  w.__chartConfigs = [];
  w.Chart = class { constructor(ctx, cfg) { w.__chartConfigs.push(cfg); } destroy() {} };
  return w;
}

test('Kool : bascule de marque (favicon K jaune), moteur sans crash et Top des ventes', async () => {
  const w = bootKool();
  await login(w, 'proprio', 'Proprio-Test-123');
  assert.equal(w.document.getElementById('appWrapper').classList.contains('hidden'), false);

  await w.yassirSyncKoolSheets(true);
  assert.ok(w.koolOrderItemsByOrderId.size > 0, 'aucun détail article Kool indexé');
  assert.ok(w.koolOrderItemsRawCount > 0, '0 ligne de détail article');

  w.yassirSwitchBrand('kool');
  await wait(600);
  assert.ok(w.document.title.startsWith('Kool Pulse'), 'titre non basculé sur Kool : ' + w.document.title);
  const fav = w.document.getElementById('appFavicon');
  assert.ok(fav, 'lien favicon #appFavicon absent');
  const favHref = String(fav.getAttribute('href') || fav.href || '');
  assert.ok(favHref.startsWith('data:image/svg+xml'), 'favicon Kool non appliqué');
  assert.ok(favHref.includes('FFD100'), 'favicon Kool non jaune');

  w.yassirApplyDatePreset('ALL');
  await wait(600);
  w.yassirSwitchTab('resto_analytics');
  await wait(600);
  const firstKey = [...w.document.querySelectorAll('#selectRestoAnalytics option')].map((o) => o.value).filter(Boolean)[0];
  assert.ok(firstKey, 'aucun restaurant proposé en analyse');
  w.yassirOnSelectRestoAnalytics(firstKey);
  await wait(400);
  const badge = w.document.getElementById('restoItemsCountBadge').textContent;
  assert.notEqual(badge, '0 article(s)', 'Top des ventes vide pour ' + firstKey);
  const topHtml = w.document.getElementById('restoTopItemsTableBody').innerHTML;
  assert.ok(topHtml.includes('Pizza Margherita') || topHtml.includes('Tacos Poulet'), 'aucun article attendu dans le Top');

  // Synthèse Kool : GMV Brut (J+L) ≠ GMV After (J), CA HT > 0 (ex-bug : libellé « CA YASSIR »).
  // Livrées : 1001 (25.50+0), 1002 (40+5 remise), 1003 (18+0), 1005 (10+0).
  // Brut = 98.5, After = 93.5, CA KOOL = 20 % × 75.5 + 15 % × 18 = 17.8, CA HT = 17.8 / 1.19 ≈ 15.
  w.yassirSwitchTab('synth_global');
  await wait(600);
  const kpi = {};
  w.document.querySelectorAll('#synthGlobalKpisBody tr').forEach((tr) => {
    const tds = tr.querySelectorAll('td');
    if (tds.length >= 2) kpi[tds[0].textContent.trim()] = tds[1].textContent.trim();
  });
  assert.equal(kpi['GMV Brut (Item total)'], '98.5', 'GMV Brut Kool (J+L) : ' + JSON.stringify(kpi));
  assert.equal(kpi['GMV (Total Food VF)'], '93.5', 'GMV After Kool (J) : ' + JSON.stringify(kpi));
  assert.equal(kpi['CA KOOL'], '17.8', 'CA KOOL : ' + JSON.stringify(kpi));
  const numTxt = (s) => Number(String(s).replace(/[^0-9-]/g, ''));
  assert.equal(numTxt(w.document.getElementById('execGmvBrutVal').textContent), 99, 'carte GMV Brut');
  assert.equal(numTxt(w.document.getElementById('execGmvAfterVal').textContent), 94, 'carte GMV After');
  assert.equal(numTxt(w.document.getElementById('execCardCaVal').textContent), 15, 'carte CA HT (ex 0)');

  // Promo.Order Kool (ex 0) : seule la commande 1002 a une remise > 0, sur 4 livrées.
  assert.equal(kpi['Promo Order'], '1', 'Promo Order Kool (remise > 0) : ' + JSON.stringify(kpi));
  assert.equal(w.document.getElementById('execCardPromoVal').textContent, '1(25%)', 'carte Promo.Order : ' + w.document.getElementById('execCardPromoVal').textContent);

  // Couleurs des graphiques en mode Kool : jaune/noir, pas violet/rose (Yassir).
  const chartWithLabels = (labels) => w.__chartConfigs.find((c) => c && c.data && Array.isArray(c.data.datasets) && labels.every((lb, i) => c.data.datasets[i] && c.data.datasets[i].label === lb));
  const aovCfg = chartWithLabels(['AOV Before %', 'AOV After %']);
  assert.ok(aovCfg, 'graphique AOV non créé');
  assert.equal(aovCfg.data.datasets[0].backgroundColor, '#FFD100', 'AOV Before % doit être jaune en mode Kool');
  assert.equal(aovCfg.data.datasets[1].backgroundColor, '#111111', 'AOV After % doit être noir en mode Kool');
  const yoyCfgs = w.__chartConfigs.filter((c) => c && c.data && Array.isArray(c.data.datasets) && c.data.datasets.length === 2 && c.data.datasets[0].label === '2025' && c.data.datasets[1].label === '2026');
  assert.ok(yoyCfgs.length >= 2, 'graphiques YoY (Delivered + GMV) non créés : ' + yoyCfgs.length);
  yoyCfgs.forEach((c) => {
    assert.equal(c.data.datasets[0].borderColor, '#FFD100', 'YoY 2025 doit être jaune en mode Kool');
    assert.equal(c.data.datasets[1].borderColor, '#111111', 'YoY 2026 doit être noir en mode Kool');
  });

  // Top AVEC filtre de date : 16/11 uniquement → commande 1001 (3 articles, pas de Burger).
  w.document.getElementById('filterDateStart').value = '2026-11-16';
  w.document.getElementById('filterDateEnd').value = '2026-11-16';
  w.yassirOnDateRangeChange();
  await wait(600);
  w.yassirSwitchTab('resto_analytics');
  await wait(600);
  w.yassirOnSelectRestoAnalytics('resto alpha');
  await wait(400);
  assert.equal(w.document.getElementById('restoItemsCountBadge').textContent, '3 article(s)', 'Top filtré 16/11');
  const top16Html = w.document.getElementById('restoTopItemsTableBody').innerHTML;
  assert.ok(top16Html.includes('Pizza Margherita'), 'Pizza Margherita attendue le 16/11');
  assert.ok(!top16Html.includes('Burger Classic'), 'Burger Classic (17/11) ne doit pas apparaître le 16/11');

  // Top sur une période NON couverte par les détails articles (18/11 : 1005 livrée, sans article) :
  // message explicite avec la fin de couverture (17/11/2026), pas le message générique.
  w.document.getElementById('filterDateStart').value = '2026-11-18';
  w.document.getElementById('filterDateEnd').value = '2026-11-18';
  w.yassirOnDateRangeChange();
  await wait(600);
  w.yassirOnSelectRestoAnalytics('resto alpha');
  await wait(400);
  assert.equal(w.document.getElementById('restoItemsCountBadge').textContent, '0 article(s)', 'Top 18/11 doit être vide');
  const top18Html = w.document.getElementById('restoTopItemsTableBody').innerHTML;
  assert.ok(top18Html.includes('17/11/2026'), 'message de couverture attendu (fin au 17/11/2026) : ' + top18Html.slice(0, 200));
  assert.ok(!top18Html.includes('Aucun article trouvé pour ce restaurant.'), 'le message générique ne doit pas apparaître quand c’est un manque de couverture');

  assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
});

test('page de connexion : carte compacte, sélecteur Kool (un seul Kool + point noir), bascule de marque', () => {
  const w = boot();
  const card = w.document.getElementById('loginCard');
  assert.ok(card.className.includes('max-w-[330px]'), 'carte de connexion non compacte : ' + card.className);
  const btnK = w.document.getElementById('loginBrandBtnKool');
  assert.equal(btnK.textContent.trim(), 'Kool', 'sélecteur Kool : texte inattendu');
  assert.equal(btnK.querySelectorAll('img').length, 0, 'sélecteur Kool : logo image encore présent');
  const dot = btnK.querySelector('span');
  assert.ok(dot && dot.className.includes('bg-[#111111]'), 'sélecteur Kool : point noir absent');
  // Bascule de marque depuis la page de connexion (sans session).
  w.yassirSwitchBrand('kool');
  assert.ok(w.document.title.startsWith('Kool Pulse'), 'titre non basculé sur Kool : ' + w.document.title);
  assert.equal(w.document.getElementById('loginLogoContainerKool').classList.contains('hidden'), false);
  assert.equal(w.document.getElementById('loginLogoContainerYassir').classList.contains('hidden'), true);
  w.yassirSwitchBrand('yassir');
  assert.ok(w.document.title.startsWith('Yassir Pulse'), 'titre non revenu sur Yassir : ' + w.document.title);
  assert.equal(w.document.getElementById('loginLogoContainerYassir').classList.contains('hidden'), false);
  assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
});

test('sidebar : Synthèse dans Weekly & Growth, Sync Kool réservé au proprio, section Synchronisation', async () => {
  // Propriétaire : tout visible.
  const w = bootKool();
  await login(w, 'proprio', 'Proprio-Test-123');
  const synthBtn = w.document.getElementById('tabBtnSynthGlobal');
  assert.equal(synthBtn.closest('.lmd-nav-group').getAttribute('data-group'), 'weekly_growth', 'Synthèse pas dans Weekly & Growth');
  assert.equal(w.document.querySelector('[data-group="analytics"] #tabBtnSynthGlobal'), null, 'Synthèse encore dans Operation & Analytics');
  const syncSec = w.document.getElementById('syncSection');
  assert.ok(syncSec, 'section Synchronisation absente');
  assert.equal(syncSec.classList.contains('hidden'), false, 'section Synchronisation masquée pour le proprio');
  assert.ok(w.document.getElementById('syncYassirBlock'), 'bloc Yassir absent');
  assert.ok(w.document.getElementById('syncKoolBlock'), 'bloc Kool absent');
  assert.ok(w.document.getElementById('btnSyncYassirAll').closest('#syncYassirBlock'), 'Sync Yassir pas dans le bloc Yassir');
  assert.equal(w.document.getElementById('btnSyncYassirAll').classList.contains('hidden'), false, 'Sync Yassir masqué pour le proprio');
  ['btnSyncSheetsNow', 'btnSyncBudgetNow', 'btnSyncHistoricalSheets', 'btnSyncRestoStatusSidebar', 'btnSyncOffrePartSidebar', 'btnSync2025Sidebar'].forEach(function (id) {
    assert.equal(w.document.getElementById(id), null, 'ancien bouton ' + id + ' encore présent');
  });
  assert.ok(w.document.getElementById('btnSyncKoolSheetsNow').closest('#syncKoolBlock'), 'Sync Kool pas dans le bloc Kool');
  assert.equal(w.document.getElementById('btnSyncKoolSheetsNow').classList.contains('hidden'), false, 'Sync Kool masqué pour le proprio');
  // Onglet Synthèse accessible depuis son nouvel emplacement.
  w.yassirSwitchTab('synth_global');
  assert.ok(w.document.getElementById('activeSectionTitle').textContent.startsWith('Synthèse Food'), 'titre Synthèse non affiché : ' + w.document.getElementById('activeSectionTitle').textContent);

  // AM : Sync Kool et section Synchronisation masqués, synchro manuelle bloquée.
  const wAm = bootKool();
  await login(wAm, 'omar.beldi', 'Omar-Test-12345');
  assert.equal(wAm.document.getElementById('syncSection').classList.contains('hidden'), true, 'section Synchronisation visible pour un AM');
  assert.equal(wAm.document.getElementById('btnSyncYassirAll').classList.contains('hidden'), true, 'Sync Yassir visible pour un AM');
  assert.equal(wAm.document.getElementById('btnSyncKoolSheetsNow').classList.contains('hidden'), true, 'Sync Kool visible pour un AM');
  const labelBefore = wAm.document.getElementById('labelSyncKoolSheets').textContent;
  wAm.yassirSyncKoolSheets(true);
  assert.equal(wAm.document.getElementById('labelSyncKoolSheets').textContent, labelBefore, 'synchro manuelle Kool lancée par un AM');
  assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
});

test('Sync Yassir unique : les 6 synchros enchaînées en ordre, progression puis statut final', async () => {
  const w = bootKool();
  await login(w, 'proprio', 'Proprio-Test-123');
  // On remplace les 6 synchros par des doublures qui enregistrent l'ordre d'appel.
  const calls = [];
  const stub = (name) => () => { calls.push(name); return Promise.resolve(); };
  w.yassirSyncAllFromGoogleSheets = stub('portefeuilles');
  w.yassirSyncHistoricalSheets = stub('historique');
  w.yassirSyncBudgetSheet = stub('budget');
  w.yassirSyncRestoStatusSheet = stub('statut');
  w.yassirSyncOffreParticipationSheet = stub('offres');
  w.yassirSync2025Sheet = stub('2025');
  const label = w.document.getElementById('labelSyncYassirAll');
  w.yassirSyncYassirAll();
  // Deuxième appel pendant l'exécution : ignoré (garde anti double-clic).
  w.yassirSyncYassirAll();
  assert.ok(label.textContent.indexOf('(1/6)') !== -1, 'pas de progression 1/6 : ' + label.textContent);
  await wait(300);
  assert.deepEqual(calls, ['portefeuilles', 'historique', 'budget', 'statut', 'offres', '2025'], 'ordre des 6 synchros incorrect');
  assert.ok(/^Yassir OK \(\d{2}:\d{2}\)$/.test(label.textContent), 'statut final inattendu : ' + label.textContent);
  assert.equal(w.document.getElementById('iconSyncYassirAll').classList.contains('fa-spin'), false, 'icône toujours en rotation après la fin');

  // Échec d'une étape : statut partiel, les autres étapes continuent.
  calls.length = 0;
  w.yassirSyncBudgetSheet = () => { calls.push('budget'); return Promise.reject(new Error('feuille inaccessible')); };
  w.yassirSyncYassirAll();
  await wait(300);
  assert.deepEqual(calls, ['portefeuilles', 'historique', 'budget', 'statut', 'offres', '2025'], 'une étape en échec a interrompu la chaîne');
  assert.equal(label.textContent, 'Yassir partiel (5/6)', 'statut partiel inattendu : ' + label.textContent);
  assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
});

test('Kool : section Participation (toute la carte / par article) et colonne Promo Admin masquée', async () => {
  const w = bootKool({ data: koolCsvDataPart, items: koolCsvItemsPart, offre: koolCsvOffrePart });
  await login(w, 'proprio', 'Proprio-Test-123');
  await w.yassirSyncKoolSheets(true);
  w.yassirSwitchBrand('kool');
  await wait(600);
  w.yassirApplyDatePreset('ALL');
  await wait(600);

  // Demande 2 — tableau Offres en mode Kool : pas de colonne « Promo Admin ».
  w.yassirSwitchTab('offres');
  await wait(600);
  const headTxt = w.document.getElementById('previewTableHead').textContent;
  assert.equal(headTxt.includes('Promo Admin'), false, 'colonne Promo Admin encore affichée en mode Kool : ' + headTxt);
  assert.equal(headTxt.includes('Promo Restaurant'), true, 'colonne Promo Restaurant absente en mode Kool');
  assert.equal(w.document.querySelectorAll('#previewTableBody tr td').length, 21, 'trois lignes Offres Kool (Alpha, Gamma, Delta) × 7 cellules (sans Promo Admin)');
  assert.ok(w.document.getElementById('previewTableBody').textContent.includes('Resto Gamma'), 'Resto Gamma (règle à 0 %) absent du tableau Offres');
  assert.deepEqual([...w.yassirGetOffresVisibleHeaders()], ['Portefeuille AM', 'Area', 'Nom du restaurant', 'Total Offres', 'Discount Article', 'Promo Restaurant']);
  // En mode Yassir, la colonne est toujours là.
  w.yassirSwitchBrand('yassir');
  assert.deepEqual([...w.yassirGetOffresVisibleHeaders()], ['Portefeuille AM', 'Area', 'Nom du restaurant', 'Total Offres', 'Discount Article', 'Promo Admin', 'Promo Restaurant']);
  w.yassirSwitchBrand('kool');
  await wait(600);

  // Demande 1 — section Participation, vue « Toute la carte » (par défaut).
  // Formule corrigée : plateforme = partPct % du BRUT (item total), restaurant = remise − plateforme (plafonné à la remise).
  // 1001 (Alpha, brut 25.50, D 0) : plateforme min(2.55, 0) = 0, resto 0.
  // 1002 (Alpha, brut 45, D 5) : plateforme 4.50, resto 0.50.
  // 1003 (Beta, sans règle, D 3) : IGNORÉE — remise Kool sans règle non comptable (règle Kool 2026-11-26 ; Yassir garde le repli 100 % plateforme).
  // 1005 (Alpha, brut 10, D 0) : plateforme 0, resto 0.
  // 1006 (Gamma, règle à participation VIDE → 0 %, D 4) : plateforme 0, resto 4.00.
  // 1007 (Delta, règle 30 %, brut 52, D 2) : plateforme plafonnée à 2.00, resto 0.
  // Totaux : 5 offres / 11.00 / resto 4.50 / plateforme 6.50.
  w.yassirSwitchTab('participation');
  await wait(600);
  assert.equal(w.document.getElementById('activeSectionTitle').textContent, 'Participation des Offres');
  assert.equal(w.document.getElementById('partKpiOffres').textContent, '5', 'Total Offres (carte)');
  assert.equal(w.document.getElementById('partKpiRemise').textContent, '11.00 TND', 'Remise totale (carte)');
  assert.equal(w.document.getElementById('partKpiResto').textContent, '4.50 TND', 'Participation restaurant (carte)');
  assert.equal(w.document.getElementById('partKpiPlateforme').textContent, '6.50 TND', 'Participation plateforme (carte)');
  const bodyTxt = w.document.getElementById('partTableBody').textContent;
  assert.ok(bodyTxt.includes('Resto Alpha'), 'Resto Alpha absent du tableau Participation');
  assert.ok(!bodyTxt.includes('Resto Beta'), 'Resto Beta (remise sans règle) ne doit plus apparaître dans le tableau Participation');
  assert.ok(bodyTxt.includes('Resto Gamma'), 'Resto Gamma (règle à 0 %) doit apparaître à 100 % restaurant');
  assert.ok(bodyTxt.includes('Resto Delta'), 'Resto Delta (plafonnement) absent du tableau Participation');
  assert.ok(w.document.getElementById('partTableFoot').textContent.includes('4.50'), 'total Participation restaurant absent du pied de tableau');
  // KPI budget « Participation Offres » (coût restaurant) : carte 4.50 + article 1.50 = 6.00.
  // Inchangé : le repli Kool supprimé mettait la remise sans règle à 100 % plateforme (coût
  // restaurant 0), et la fonction ne comptait déjà que les commandes avec règle.
  assert.equal(w.yassirCalculerCoutParticipationOffresLivrees(w.yassirGetDeliveredRecords()), 6, 'KPI Participation Offres (coût restaurant)');

  // Vue « Par article » : 1002 a un article remisé (Burger 15 → 12, discount 3.00,
  // plateforme 10 % × 15 = 1.50, resto 3.00 − 1.50 = 1.50) ; 1003 (Resto Beta, sans règle) a des
  // Tacos remisés (9 → 8 × 3 = 3.00) → IGNORÉS (remise sans règle non comptable). Totaux : 1 / 3.00 / 1.50 / 1.50.
  w.yassirSetParticipationView('article');
  assert.equal(w.document.getElementById('partKpiOffres').textContent, '1', 'Total Offres (article)');
  assert.equal(w.document.getElementById('partKpiRemise').textContent, '3.00 TND', 'Discount article');
  assert.equal(w.document.getElementById('partKpiResto').textContent, '1.50 TND', 'Participation restaurant (article)');
  assert.equal(w.document.getElementById('partKpiPlateforme').textContent, '1.50 TND', 'Participation plateforme (article)');
  assert.ok(w.document.getElementById('partTableBody').textContent.includes('Resto Alpha'), 'Resto Alpha absent en vue article');
  assert.ok(!w.document.getElementById('partTableBody').textContent.includes('Resto Beta'), 'Resto Beta ne doit plus apparaître en vue article (remise sans règle)');

  // Filtre de date : 16/11 uniquement → seule 1001 (carte : remise 0, plateforme min(2.55, 0) = 0, resto 0).
  w.yassirSetParticipationView('carte');
  w.document.getElementById('filterDateStart').value = '2026-11-16';
  w.document.getElementById('filterDateEnd').value = '2026-11-16';
  w.yassirOnDateRangeChange();
  await wait(600);
  assert.equal(w.document.getElementById('partKpiOffres').textContent, '1', 'Total Offres 16/11 (carte)');
  assert.equal(w.document.getElementById('partKpiRemise').textContent, '0.00 TND', 'Remise 16/11 (carte)');
  assert.equal(w.document.getElementById('partKpiResto').textContent, '0.00 TND', 'Participation restaurant 16/11 (carte)');
  assert.equal(w.document.getElementById('partKpiPlateforme').textContent, '0.00 TND', 'Participation plateforme 16/11 (carte)');
  // Même jour en vue article : détails couverts mais aucune offre article → message neutre, pas de couverture.
  w.yassirSetParticipationView('article');
  assert.equal(w.document.getElementById('partKpiOffres').textContent, '0', 'Total Offres 16/11 (article)');
  const note16 = w.document.getElementById('partNoteBanner').textContent;
  assert.ok(note16.includes('Aucune participation sur articles pour cette période'), 'message neutre attendu le 16/11 : ' + note16);
  assert.ok(!note16.includes('17/11/2026'), 'pas de message de couverture le 16/11');

  // 18/11 : commande 1005 livrée sans détail article → message de couverture (fin au 17/11).
  // La vue « Toute la carte » fonctionne sans détails articles : remise 0 donc plateforme 0 et resto 0.
  w.document.getElementById('filterDateStart').value = '2026-11-18';
  w.document.getElementById('filterDateEnd').value = '2026-11-18';
  w.yassirOnDateRangeChange();
  await wait(600);
  w.yassirSetParticipationView('carte');
  assert.equal(w.document.getElementById('partKpiOffres').textContent, '1', 'Total Offres 18/11 (carte)');
  assert.equal(w.document.getElementById('partKpiResto').textContent, '0.00 TND', 'Participation restaurant 18/11 (carte)');
  assert.equal(w.document.getElementById('partKpiPlateforme').textContent, '0.00 TND', 'Participation plateforme 18/11 (carte)');
  w.yassirSetParticipationView('article');
  const note18 = w.document.getElementById('partNoteBanner').textContent;
  assert.ok(note18.includes('17/11/2026'), 'message de couverture attendu (fin au 17/11/2026) : ' + note18);

  assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
});

// ---- Vues du deck Kool (slides 33-38) : Executive Summary, Daily Orders vs Avg Daily
// GMV, Top 20 / Top Growth, Clients (Nouveaux vs Retours vs Réactivés) ----
// Données simulées à 33 colonnes : « ID Client » en col. F (index 5) et
// « New Client » en col. AG (index 32), comme dans la vraie feuille Data Kool.
// Semaine précédente W46 (9-15/11/2026) et semaine courante W47 (16-22/11/2026).
const deckRow = (date, oid, client, resto, j, k, l, isNew) => {
  const r = new Array(33).fill('');
  r[3] = date; r[4] = oid; r[5] = String(client); r[6] = resto;
  r[9] = j; r[10] = k; r[11] = l; r[32] = String(isNew);
  return r;
};
const deckHeader = new Array(33).fill('');
deckHeader[0] = 'Annulé'; deckHeader[2] = 'Raison annulation'; deckHeader[3] = 'Date';
deckHeader[4] = 'N° commande'; deckHeader[5] = 'ID Client'; deckHeader[6] = 'Restaurant';
deckHeader[9] = 'Montant HT'; deckHeader[10] = 'Frais livraison'; deckHeader[11] = 'Remise';
deckHeader[32] = 'New Client';
const koolCsvDataDeck = toCsv([
  deckHeader,
  // W46 (période précédente) : Alpha 4 livrées (GMV After 87), Beta 2 (55).
  deckRow('10/11/2026', '2001', 101, 'Resto Alpha', '30.00', '3', '5', 1),
  deckRow('11/11/2026', '2002', 102, 'Resto Alpha', '20.00', '2', '0', 0),
  deckRow('12/11/2026', '2003', 103, 'Resto Alpha', '25.00', '3', '0', 0),
  deckRow('09/11/2026', '2009', 105, 'Resto Alpha', '12.00', '2', '0', 0),
  deckRow('10/11/2026', '2004', 201, 'Resto Beta', '40.00', '4', '0', 1),
  deckRow('13/11/2026', '2005', 202, 'Resto Beta', '15.00', '2', '0', 0),
  // W47 (période courante) : Alpha 4 (GMV After 117), Beta 1 (40), Gamma 2 (80).
  deckRow('17/11/2026', '2006', 101, 'Resto Alpha', '35.00', '3', '5', 0),
  deckRow('18/11/2026', '2007', 104, 'Resto Alpha', '50.00', '5', '0', 1),
  deckRow('18/11/2026', '2008', 105, 'Resto Alpha', '10.00', '2', '0', 0),
  deckRow('19/11/2026', '2010', 106, 'Resto Alpha', '22.00', '2', '0', 1),
  deckRow('17/11/2026', '2011', 201, 'Resto Beta', '40.00', '4', '0', 0),
  deckRow('18/11/2026', '2013', 301, 'Resto Gamma', '60.00', '5', '0', 1),
  deckRow('19/11/2026', '2014', 302, 'Resto Gamma', '20.00', '2', '0', 1)
]);
const koolCsvCommDeck = toCsv([['Restaurant', 'Commission'], ['Resto Alpha', '20'], ['Resto Beta', '15'], ['Resto Gamma', '10']]);
const koolCsvPortDeck = toCsv([['Restaurant', 'Ville', 'AM'], ['Resto Alpha', 'Tunis', 'Omar Beldi'], ['Resto Beta', 'Ariana', 'Nour Ali'], ['Resto Gamma', 'Tunis', 'Omar Beldi']]);

test('Kool : vues du deck (Executive Summary, Daily Orders vs Avg Daily GMV, Top 20 / Top Growth, Clients)', async () => {
  const w = bootKool({ data: koolCsvDataDeck, comm: koolCsvCommDeck, port: koolCsvPortDeck });
  await login(w, 'proprio', 'Proprio-Test-123');
  await w.yassirSyncKoolSheets(true);
  w.yassirSwitchBrand('kool');
  await wait(600);
  w.yassirApplyDatePreset('ALL');
  await wait(600);

  // Classifieur client (règle des 7 jours) — test unitaire direct : l'archive
  // couvre oct.–nov. 2026, un écart > 7 jours est fréquent via les données
  // synchronisées (le test d'intégration ci-dessous a donc 1 réactivé).
  assert.equal(w.yassirClassifierClientKool(1, '', '2026-11-16'), 'new', 'New Client = 1 → nouveau');
  assert.equal(w.yassirClassifierClientKool(0, '2026-11-09', '2026-11-16'), 'returning', 'ancien, 7 jours exactement → retour (seuil > 7)');
  assert.equal(w.yassirClassifierClientKool(0, '2026-11-08', '2026-11-16'), 'reactivated', 'ancien, 8 jours → réactivé');
  assert.equal(w.yassirClassifierClientKool(0, '2026-10-20', '2026-11-16'), 'reactivated', 'ancien, 27 jours → réactivé');
  assert.equal(w.yassirClassifierClientKool(0, '2026-09-10', '2026-11-16'), 'reactivated', 'ancien, 67 jours → réactivé');
  assert.equal(w.yassirClassifierClientKool(0, '', '2026-11-16'), 'returning', 'ancien sans commande précédente → retour');

  // Période courante W47 (16-22/11/2026).
  w.document.getElementById('filterDateStart').value = '2026-11-16';
  w.document.getElementById('filterDateEnd').value = '2026-11-22';
  w.yassirOnDateRangeChange();
  await wait(600);

  // Executive Summary (slide 33) : KPIs de la semaine filtrée.
  // Livrées W47 : 7 (Alpha 4, Beta 1, Gamma 2). GMV Brut = 242, After = 237.
  // CA KOOL = 20 % × 117 + 15 % × 40 + 10 % × 80 = 37.4 ; CA HT = 37.4 / 1.19 ≈ 31.
  // Promo.Order : seule 2006 a une remise > 0 → 1 (14 %).
  w.yassirSwitchTab('synth_global');
  await wait(600);
  const kpi = {};
  w.document.querySelectorAll('#synthGlobalKpisBody tr').forEach((tr) => {
    const tds = tr.querySelectorAll('td');
    if (tds.length >= 2) kpi[tds[0].textContent.trim()] = tds[1].textContent.trim();
  });
  assert.equal(kpi['Requested'], '7', 'Requested W47 : ' + JSON.stringify(kpi));
  assert.equal(kpi['Delivered Orders'], '7', 'Delivered W47');
  assert.equal(kpi['GMV Brut (Item total)'], '242', 'GMV Brut W47');
  assert.equal(kpi['GMV (Total Food VF)'], '237', 'GMV After W47');
  assert.equal(kpi['CA KOOL'], '37.4', 'CA KOOL W47 : ' + JSON.stringify(kpi));
  assert.equal(kpi['Promo Order'], '1', 'Promo Order W47');
  assert.equal(kpi['Active Store'], '3', 'Active Store W47');
  const numTxt = (s) => Number(String(s).replace(/[^0-9-]/g, ''));
  assert.equal(numTxt(w.document.getElementById('execGmvBrutVal').textContent), 242, 'carte GMV Brut');
  assert.equal(numTxt(w.document.getElementById('execGmvAfterVal').textContent), 237, 'carte GMV After');
  assert.equal(numTxt(w.document.getElementById('execCardCaVal').textContent), 31, 'carte CA HT');
  assert.equal(w.document.getElementById('execCardPromoVal').textContent, '1(14%)', 'carte Promo.Order');
  assert.equal(numTxt(w.document.getElementById('execAvgDayVal').textContent), 1, 'AVG/DAY = 7 livrées / 7 jours');
  assert.equal(w.document.getElementById('execCardStoreVal').textContent, '3', 'carte Active Store');

  // Records calculés sur les données disponibles (archive oct.–nov. 2026) :
  // meilleure semaine W47 (7 livrées), meilleur jour 18/11 (3 livrées).
  const bulletsTxt = w.document.getElementById('execSummaryBullets').textContent;
  assert.ok(bulletsTxt.includes('W47-26'), 'meilleure semaine W47 attendue : ' + bulletsTxt);
  assert.ok(bulletsTxt.includes('(Del)7'), 'meilleure semaine : 7 livrées');
  assert.ok(bulletsTxt.includes('3 (18/11/2026)'), 'meilleur jour 18/11 (3 livrées) : ' + bulletsTxt);
  assert.ok(bulletsTxt.includes('sur les données disponibles'), 'mention « sur les données disponibles »');
  assert.ok(!bulletsTxt.includes('3006'), 'le record codé en dur (3006, 2022) ne doit plus apparaître en mode Kool');

  // Slide 34 partie 1 : Daily Orders (barres) vs Avg Daily GMV (courbe), W44–W47.
  // W46 : 6 livrées → 1/jour, GMV 142 → 20/jour ; W47 : 7 livrées → 1/jour, GMV 237 → 34/jour.
  assert.equal(w.document.getElementById('weeklyWowPerfTitle').textContent, 'Daily Orders vs Avg Daily GMV', 'titre du graphique hebdo Kool');
  const chartWithLabels = (labels) => w.__chartConfigs.find((c) => c && c.data && Array.isArray(c.data.datasets) && labels.every((lb, i) => c.data.datasets[i] && c.data.datasets[i].label === lb));
  const wowCfg = chartWithLabels(['Avg Daily GMV', 'Daily Orders']);
  assert.ok(wowCfg, 'graphique Daily Orders vs Avg Daily GMV non créé');
  // Étaler les tableaux jsdom dans le realm du test : deepEqual compare les
  // prototypes, et un tableau créé dans la fenêtre jsdom n'a pas le même
  // prototype qu'un littéral du test (échec « valeurs identiques » sinon).
  assert.deepEqual([...wowCfg.data.labels], ['w44', 'w45', 'w46', 'w47'], 'semaines W44–W47');
  assert.deepEqual([...wowCfg.data.datasets[0].data], [0, 0, 20, 34], 'Avg Daily GMV = GMV / 7');
  assert.deepEqual([...wowCfg.data.datasets[1].data], [0, 0, 1, 1], 'Daily Orders = livrées / 7');
  assert.equal(wowCfg.data.datasets[1].backgroundColor, '#FFD100', 'Daily Orders en jaune Kool');
  // Courbe 2025 absente (aucune donnée Kool 2025) + note explicative visible.
  const yoyCfg = w.__chartConfigs.find((c) => c && c.data && Array.isArray(c.data.datasets) && c.data.datasets.length === 2 && c.data.datasets[0].label === '2025' && c.data.datasets[1].label === '2026');
  assert.ok(yoyCfg, 'graphique YoY non créé');
  assert.ok(yoyCfg.data.datasets[0].data.every((v) => v === null), 'la série 2025 doit être vide (aucune donnée Kool 2025)');
  assert.equal(w.document.getElementById('koolNoYoyNote').classList.contains('hidden'), false, 'note « pas de données 2025 » visible');
  assert.ok(w.document.getElementById('koolNoYoyNote').textContent.includes('indisponible pour Kool'), 'message YoY Kool');

  // Top 20 / Top Growth (slides 35-36) : période précédente W46 (9-15/11) via « Data préc ».
  w.document.getElementById('filterPrevDateStart').value = '2026-11-09';
  w.document.getElementById('filterPrevDateEnd').value = '2026-11-15';
  w.yassirOnPrevDateRangeChange();
  await wait(600);
  assert.equal(w.document.getElementById('synthVariationSection').classList.contains('hidden'), false, 'section Variation masquée sans période précédente');
  assert.equal(w.document.getElementById('variationSortButtons').classList.contains('hidden'), false, 'boutons Top 20 / Top Growth masqués en Kool');
  const varRows = () => [...w.document.querySelectorAll('#synthVariationTableBody tr')].map((tr) => (tr.querySelector('td') || {}).textContent || '');
  w.yassirSetVariationSort('top20');
  assert.deepEqual(varRows(), ['Resto Alpha', 'Resto Gamma', 'Resto Beta'], 'Top 20 trié par livrées décroissantes');
  assert.ok(w.document.getElementById('synthVariationSubDesc').textContent.includes('Top 20'), 'sous-titre Top 20');
  w.yassirSetVariationSort('growth');
  assert.deepEqual(varRows(), ['Resto Alpha', 'Resto Beta'], 'Top Growth : Alpha 0 %, Beta −50 %, Gamma exclu (sans période précédente)');
  w.yassirSetVariationSort('score');

  // Clients Kool (slides 34 partie 3, 37-38) : période W47.
  // Nouveaux : 104, 106 (Alpha), 301, 302 (Gamma) = 4. Retours : 101 (Alpha),
  // 201 (Beta) = 2. Réactivés : 105 (Alpha, commande précédente le 09/11, soit
  // 9 jours avant sa première commande de la période) = 1.
  w.yassirSwitchTab('kool_clients');
  await wait(600);
  assert.equal(w.document.getElementById('koolCliKpiNouveaux').textContent, '4', 'Nouveaux clients W47');
  assert.equal(w.document.getElementById('koolCliKpiRetours').textContent, '2', 'Clients de retour W47');
  assert.equal(w.document.getElementById('koolCliKpiReactives').textContent, '1', 'Clients réactivés W47');
  assert.equal(w.document.getElementById('koolCliKpiTotal').textContent, '7', 'Total clients W47');
  const areaRows = [...w.document.querySelectorAll('#koolCliAreaTableBody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()));
  assert.deepEqual(areaRows[0].slice(0, 5), ['Tunis', '4', '1', '1', '6'], 'Tunis : 4 nouveaux, 1 retour, 1 réactivé, 6 clients');
  assert.deepEqual(areaRows[1].slice(0, 5), ['Ariana', '0', '1', '0', '1'], 'Ariana : 0 nouveau, 1 retour, 1 client');
  const acqTxt = w.document.getElementById('koolCliTopAcqBody').textContent;
  assert.ok(acqTxt.includes('Resto Alpha') && acqTxt.includes('Resto Gamma'), 'Top Acquisition : Alpha et Gamma');
  assert.ok(!acqTxt.includes('Resto Beta'), 'Top Acquisition : Beta (0 nouveau) absent');
  const retTxt = w.document.getElementById('koolCliTopRetBody').textContent;
  assert.ok(retTxt.includes('Resto Alpha') && retTxt.includes('Resto Beta'), 'Top Returning : Alpha et Beta');
  assert.ok(w.document.getElementById('koolCliTopReaBody').textContent.includes('Resto Alpha'), 'Top Reactivated : Alpha (105 réactivé)');
  const cliCfg = chartWithLabels(['Nouveaux', 'Retours', 'Réactivés']);
  assert.ok(cliCfg, 'graphique clients par ville non créé');
  // (étaler aussi le résultat du .map : datasets est un tableau jsdom, son .map
  // renvoie un tableau jsdom — même piège de prototype que pour le graphique WoW.)
  assert.deepEqual([...cliCfg.data.datasets.map((d) => d.backgroundColor)], ['#FFD100', '#111111', '#9CA3AF'], 'couleurs du graphique clients');
  assert.ok(cliCfg.data.labels.includes('Tunis') && cliCfg.data.labels.includes('Ariana'), 'villes du graphique clients');
  assert.ok(w.document.getElementById('panelKoolClients').textContent.includes('7 jours'), 'seuil de réactivation (7 jours) affiché dans le panneau');
  // Bouton de téléchargement du graphique Clients Kool (.png).
  assert.ok(w.document.getElementById('btnDownloadKoolClientsChart'), 'bouton Télécharger le graphique absent');
  assert.equal(typeof w.yassirDownloadKoolClientsChart, 'function', 'fonction de téléchargement du graphique absente');
  // Bouton de téléchargement des Top 10 Clients Kool (.xlsx) : 3 feuilles,
  // mêmes chiffres que les tableaux affichés.
  assert.ok(w.document.getElementById('btnDownloadKoolClientsTop10'), 'bouton Télécharger les Top 10 absent');
  assert.equal(typeof w.yassirDownloadKoolClientsTop10, 'function', 'fonction de téléchargement des Top 10 absente');
  const wbTop10 = w.yassirConstruireClasseurTop10Kool();
  assert.ok(wbTop10, 'classeur Top 10 non construit');
  assert.deepEqual([...wbTop10.SheetNames], ['Acquisition', 'Returning', 'Reactivated'], 'feuilles du classeur Top 10');
  const topSheet = (n) => w.XLSX.utils.sheet_to_json(wbTop10.Sheets[n], { header: 1 });
  assert.deepEqual([...topSheet('Acquisition')[0]], ['#', 'Restaurant', 'Ville (Area)', 'Nouveaux'], 'en-tête Acquisition');
  assert.deepEqual([...topSheet('Acquisition').slice(1).map((r) => r[1])], ['Resto Alpha', 'Resto Gamma'], 'Top Acquisition : Alpha puis Gamma');
  assert.deepEqual([...topSheet('Returning').slice(1).map((r) => r[1])], ['Resto Alpha', 'Resto Beta'], 'Top Returning : Alpha puis Beta');
  assert.deepEqual([...topSheet('Reactivated').slice(1).map((r) => r[1])], ['Resto Alpha'], 'Top Reactivated : Alpha seul');

  // En mode Yassir, l'onglet Clients Kool disparaît (la vue est Kool uniquement).
  w.yassirSwitchBrand('yassir');
  await wait(600);
  assert.equal(w.document.getElementById('tabBtnKoolClients').classList.contains('hidden'), true, 'onglet Clients Kool visible en Yassir');

  assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
});

// ---- Filtre par Polygone Client (Kool uniquement) ----
// Données simulées à 33 colonnes : « Polygone Client » en col. AB (index 27),
// comme dans la vraie feuille Data Kool. 4 commandes : Menzah 1, Marsa 2,
// polygone vide 1.
const polyRow = (date, oid, client, resto, j, k, l, isNew, poly) => {
  const r = new Array(33).fill('');
  r[3] = date; r[4] = oid; r[5] = String(client); r[6] = resto;
  r[9] = j; r[10] = k; r[11] = l; r[27] = poly; r[32] = String(isNew);
  return r;
};
const polyHeader = new Array(33).fill('');
polyHeader[0] = 'Annulé'; polyHeader[2] = 'Raison annulation'; polyHeader[3] = 'Date';
polyHeader[4] = 'N° commande'; polyHeader[5] = 'ID Client'; polyHeader[6] = 'Restaurant';
polyHeader[9] = 'Montant HT'; polyHeader[10] = 'Frais livraison'; polyHeader[11] = 'Remise';
polyHeader[27] = 'Polygone Client'; polyHeader[32] = 'New Client';
const koolCsvDataPoly = toCsv([
  polyHeader,
  polyRow('17/11/2026', '3001', 401, 'Resto Alpha', '30.00', '3', '0', 1, 'Menzah'),
  polyRow('18/11/2026', '3002', 402, 'Resto Alpha', '40.00', '4', '0', 0, 'Marsa'),
  polyRow('18/11/2026', '3003', 403, 'Resto Beta', '20.00', '2', '0', 1, 'Marsa'),
  polyRow('19/11/2026', '3004', 404, 'Resto Gamma', '50.00', '5', '0', 0, '')
]);
const koolCsvCommPoly = toCsv([['Restaurant', 'Commission'], ['Resto Alpha', '20'], ['Resto Beta', '15'], ['Resto Gamma', '10']]);
const koolCsvPortPoly = toCsv([['Restaurant', 'Ville', 'AM'], ['Resto Alpha', 'Tunis', 'Omar Beldi'], ['Resto Beta', 'Ariana', 'Nour Ali'], ['Resto Gamma', 'Tunis', 'Omar Beldi']]);

test('Kool : filtre par Polygone Client (multi-sélection + recherche), Kool uniquement', async () => {
  const w = bootKool({ data: koolCsvDataPoly, comm: koolCsvCommPoly, port: koolCsvPortPoly });
  await login(w, 'proprio', 'Proprio-Test-123');
  await w.yassirSyncKoolSheets(true);
  w.yassirSwitchBrand('kool');
  await wait(600);
  w.yassirApplyDatePreset('ALL');
  await wait(600);

  const foodCount = () => w.document.getElementById('tabCountFood').textContent;
  const polyLabel = () => w.document.getElementById('polygonFilterBtnLabel').textContent;
  const polyBoxes = () => [...w.document.querySelectorAll('#polygonCheckList input[type="checkbox"]')].map((cb) => cb.dataset.poly);

  // Ligne visible en Kool ; liste = Menzah + Marsa (le polygone vide n'apparaît pas).
  assert.equal(w.document.getElementById('polygonFilterRow').classList.contains('hidden'), false, 'ligne filtre polygone masquée en Kool');
  assert.deepEqual(polyBoxes(), ['Marsa', 'Menzah'], 'liste des polygones (triée)');
  assert.equal(foodCount(), '4', 'toutes les commandes sans filtre');
  assert.equal(polyLabel(), 'Polygone : Tous', 'libellé initial');

  // Sélection simple : Marsa → 2 commandes.
  w.yassirSetPolygonFilter(['Marsa']);
  assert.equal(foodCount(), '2', 'filtre Marsa : 2 commandes');
  assert.equal(polyLabel(), 'Polygone : Marsa', 'libellé 1 sélection');

  // Multi-sélection : Menzah + Marsa → 3 commandes.
  w.yassirSetPolygonFilter(['Menzah', 'Marsa']);
  assert.equal(foodCount(), '3', 'filtre Menzah + Marsa : 3 commandes');
  assert.equal(polyLabel(), 'Polygone : 2 sélectionnés', 'libellé 2 sélections');

  // Recherche : taper « mar » ne montre que Marsa, sans toucher à la sélection.
  const inp = w.document.getElementById('polygonSearchInput');
  inp.value = 'mar';
  w.yassirSearchPolygones(inp.value);
  assert.deepEqual(polyBoxes(), ['Marsa'], 'recherche « mar » : seul Marsa affiché');
  assert.equal(foodCount(), '3', 'la recherche ne change pas le filtre (Menzah + Marsa = 3)');
  assert.equal(polyLabel(), 'Polygone : 2 sélectionnés', 'libellé inchangé pendant la recherche');
  // Recherche sans résultat : message explicite, liste vide.
  inp.value = 'zzz';
  w.yassirSearchPolygones(inp.value);
  assert.deepEqual(polyBoxes(), [], 'recherche sans résultat : liste vide');
  assert.ok(w.document.getElementById('polygonCheckList').textContent.includes('ne correspond'), 'message « aucun polygone » affiché');
  // Effacer la recherche : la liste complète revient.
  inp.value = '';
  w.yassirSearchPolygones(inp.value);
  assert.deepEqual(polyBoxes(), ['Marsa', 'Menzah'], 'recherche effacée : liste complète');

  // « Effacer le filtre » efface AUSSI la recherche et remet tous les polygones.
  inp.value = 'men';
  w.yassirSearchPolygones(inp.value);
  assert.deepEqual(polyBoxes(), ['Menzah'], 'recherche « men » avant effacement');
  w.yassirClearPolygonFilter();
  assert.equal(w.document.getElementById('polygonSearchInput').value, '', 'recherche effacée');
  assert.deepEqual(polyBoxes(), ['Marsa', 'Menzah'], 'liste complète après effacement');
  assert.equal(foodCount(), '4', 'effacement : tout revient');
  assert.equal(polyLabel(), 'Polygone : Tous', 'libellé après effacement');
  assert.equal(w.document.getElementById('polygonCheckAll').checked, true, 'case « Tous » cochée après effacement');

  // « Tous les polygones » décoché = tout désélectionner : 0 commande, « Aucun »,
  // toutes les cases décochées. Recocher un polygone ensuite filtre sur lui seul.
  w.yassirToggleAllPolygones(false);
  assert.equal(foodCount(), '0', 'tout désélectionner : 0 commande');
  assert.equal(polyLabel(), 'Polygone : Aucun', 'libellé après désélection de tous');
  assert.equal(w.document.getElementById('polygonCheckAll').checked, false, 'case « Tous » décochée');
  assert.ok([...w.document.querySelectorAll('#polygonCheckList input[type="checkbox"]')].every((cb) => !cb.checked), 'toutes les cases décochées');
  const marsaBox = [...w.document.querySelectorAll('#polygonCheckList input[type="checkbox"]')].find((cb) => cb.dataset.poly === 'Marsa');
  w.yassirTogglePolygon(marsaBox);
  assert.equal(foodCount(), '2', 'Marsa seul après désélection totale : 2 commandes');
  assert.equal(polyLabel(), 'Polygone : Marsa', 'libellé Marsa seul');
  w.yassirToggleAllPolygones(true);
  assert.equal(foodCount(), '4', '« Tous » recoché : tout revient');
  assert.equal(polyLabel(), 'Polygone : Tous', 'libellé « Tous » recoché');

  // En mode Yassir, la ligne du filtre est masquée (pas de colonne polygone).
  w.yassirSwitchBrand('yassir');
  await wait(600);
  assert.equal(w.document.getElementById('polygonFilterRow').classList.contains('hidden'), true, 'ligne filtre polygone visible en Yassir');

  assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
});

// Règle comptable Yassir (2026-11-26) : offre sans règle → 100 % à la charge du
// restaurant (l'offre reste comptée). Données importées par fichier, comme un
// vrai Data exp : les règles arrivent par le fichier Offre Participation, les
// commandes par le fichier Data exp (en-têtes cibles exacts, IDs YAF-).
// Attendus recalculés : carte 3 offres / 23,00 / resto 13,00 / plateforme 10,00 ;
// article 2 / 10,00 / resto 4,00 / plateforme 6,00 ; KPI budget 17,00
// (ancien repli 100 % plateforme : carte resto 8,00 / plateforme 15,00,
// article resto 0,00 / plateforme 10,00, KPI 8,00).
test('Yassir : règle comptable — offre sans règle à 100 % restaurant (carte + article) et KPI budget', async () => {
  const w = boot();
  await login(w, 'proprio', 'Proprio-Test-123');

  const makeXlsxFile = (aoa, sheetName, fileName) => {
    const wb = w.XLSX.utils.book_new();
    w.XLSX.utils.book_append_sheet(wb, w.XLSX.utils.aoa_to_sheet(aoa), sheetName);
    const buf = w.XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    return new w.File([buf], fileName, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  };

  // Règles : A 10 % « Toute la carte », C 0 % (partPct vide) « Toute la carte »,
  // D 20 % « Super Promo » (article). B et E n'ont AUCUNE règle.
  const rulesFile = makeXlsxFile([
    ['Restaurant', 'Participation', 'Tag', 'Période'],
    ['Resto Yassir A', '10', 'Toute la carte', '01/11/2026 - 30/11/2026'],
    ['Resto Yassir C', '', 'Toute la carte', '01/11/2026 - 30/11/2026'],
    ['Resto Yassir D', '20', 'Super Promo', '01/11/2026 - 30/11/2026']
  ], 'Offre Participation', 'offre-participation.xlsx');
  w.yassirOnOffrePartFileChange({ target: { files: [rulesFile], value: 'x' } });
  await wait(800);

  const dataAoa = [TARGET_HEADERS_TEST.slice(),
    yassirRow('16/11/2026', 'YAF-3001', 'Resto Yassir A', 100, 10, 'Percentage', ''),
    yassirRow('17/11/2026', 'YAF-3002', 'Resto Yassir B', 50, 5, 'Percentage', ''),
    yassirRow('17/11/2026', 'YAF-3003', 'Resto Yassir C', 80, 8, 'Percentage', ''),
    yassirRow('18/11/2026', 'YAF-3004', 'Resto Yassir D', 60, 6, '', 'Super Promo'),
    yassirRow('18/11/2026', 'YAF-3005', 'Resto Yassir E', 40, 4, '', 'Super Promo')
  ];
  const dataFile = makeXlsxFile(dataAoa, 'Data exp', 'data-exp.xlsx');
  w.yassirOnMainFileChange({ target: { files: [dataFile], value: 'x' } });
  await wait(1200);

  // Vue « Toute la carte » : A (règle 10 % : plateforme 10, resto 0), B (sans règle :
  // resto 5, plateforme 0), C (règle 0 % : resto 8, plateforme 0). D (règle article)
  // et E (offre article sans règle) sont exclus de cette vue.
  w.yassirSwitchTab('participation');
  await wait(600);
  assert.equal(w.document.getElementById('partKpiOffres').textContent, '3', 'Total Offres Yassir (carte)');
  assert.equal(w.document.getElementById('partKpiRemise').textContent, '23.00 TND', 'Remise totale Yassir (carte)');
  assert.equal(w.document.getElementById('partKpiResto').textContent, '13.00 TND', 'Participation restaurant Yassir (carte)');
  assert.equal(w.document.getElementById('partKpiPlateforme').textContent, '10.00 TND', 'Participation plateforme Yassir (carte)');
  const bodyTxt = w.document.getElementById('partTableBody').textContent;
  assert.ok(bodyTxt.includes('Resto Yassir A'), 'Resto Yassir A absent (carte)');
  assert.ok(bodyTxt.includes('Resto Yassir B'), 'Resto Yassir B (sans règle) doit apparaître à 100 % restaurant (carte)');
  assert.ok(bodyTxt.includes('Resto Yassir C'), 'Resto Yassir C (règle à 0 %) absent (carte)');
  assert.ok(!bodyTxt.includes('Resto Yassir D'), 'Resto Yassir D (règle article) ne doit pas apparaître en vue carte');
  assert.ok(!bodyTxt.includes('Resto Yassir E'), 'Resto Yassir E (offre article sans règle) ne doit pas apparaître en vue carte');

  // KPI budget « Participation Offres » (coût restaurant) : A 0 + B 5 + C 8 + D 0 + E 4 = 17.
  assert.equal(w.yassirCalculerCoutParticipationOffresLivrees(w.yassirGetDeliveredRecords()), 17, 'KPI Participation Offres Yassir (coût restaurant)');

  // Vue « Par article » : D (règle Super Promo 20 % : plateforme 6, resto 0),
  // E (sans règle : resto 4, plateforme 0). A, B, C sont exclus de cette vue.
  w.yassirSetParticipationView('article');
  assert.equal(w.document.getElementById('partKpiOffres').textContent, '2', 'Total Offres Yassir (article)');
  assert.equal(w.document.getElementById('partKpiRemise').textContent, '10.00 TND', 'Remise totale Yassir (article)');
  assert.equal(w.document.getElementById('partKpiResto').textContent, '4.00 TND', 'Participation restaurant Yassir (article)');
  assert.equal(w.document.getElementById('partKpiPlateforme').textContent, '6.00 TND', 'Participation plateforme Yassir (article)');
  const bodyArt = w.document.getElementById('partTableBody').textContent;
  assert.ok(bodyArt.includes('Resto Yassir D'), 'Resto Yassir D absent (article)');
  assert.ok(bodyArt.includes('Resto Yassir E'), 'Resto Yassir E (sans règle) doit apparaître à 100 % restaurant (article)');
  assert.ok(!bodyArt.includes('Resto Yassir A'), 'Resto Yassir A (règle carte) ne doit pas apparaître en vue article');

  assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
});

// ---- Notifications (étapes 1 et 2) ----
// Données Kool 16-22/11/2026 (ref = 22/11, aujourd'hui = 26/11 → données vieilles de 4 jours) :
// Alpha (1 livrée/jour, offre qui se termine le 23/11), Beta (dernière livrée le 17/11 → 0 cmd),
// Gamma (drop 5 -> 3 -> 1), Delta (10 reçues dont 3 annulées = 30 %).
const notifRow = (date, oid, resto, j, k, l, annule, raison) => {
  const r = new Array(33).fill('');
  r[0] = annule || ''; r[2] = raison || ''; r[3] = date; r[4] = oid; r[6] = resto;
  r[9] = j; r[10] = k; r[11] = l;
  return r;
};
const notifHeader = new Array(33).fill('');
notifHeader[0] = 'Annulé'; notifHeader[2] = 'Raison annulation'; notifHeader[3] = 'Date';
notifHeader[4] = 'N° commande'; notifHeader[6] = 'Restaurant';
notifHeader[9] = 'Montant HT'; notifHeader[10] = 'Frais livraison'; notifHeader[11] = 'Remise';
const notifDataRows = [notifHeader];
{
  let oid = 5000;
  const addDeliv = (date, resto, n) => { for (let i = 0; i < n; i++) notifDataRows.push(notifRow(date, String(++oid), resto, '20.00', '3', '0')); };
  ['16/11/2026', '17/11/2026', '18/11/2026', '19/11/2026', '20/11/2026', '21/11/2026', '22/11/2026'].forEach((d) => addDeliv(d, 'Resto Alpha', 1));
  addDeliv('16/11/2026', 'Resto Beta', 1);
  addDeliv('17/11/2026', 'Resto Beta', 1);
  addDeliv('20/11/2026', 'Resto Gamma', 5);
  addDeliv('21/11/2026', 'Resto Gamma', 3);
  addDeliv('22/11/2026', 'Resto Gamma', 1);
  ['16/11/2026', '17/11/2026', '18/11/2026', '19/11/2026', '20/11/2026', '21/11/2026', '22/11/2026'].forEach((d) => addDeliv(d, 'Resto Delta', 1));
  ['18/11/2026', '19/11/2026', '20/11/2026'].forEach((d) => notifDataRows.push(notifRow(d, String(++oid), 'Resto Delta', '20.00', '3', '0', 'oui', 'Client absent')));
}
const notifCsvComm = toCsv([['Restaurant', 'Commission'], ['Resto Alpha', '20'], ['Resto Beta', '15'], ['Resto Gamma', '20'], ['Resto Delta', '20']]);
const notifCsvPort = toCsv([['Restaurant', 'Ville', 'AM'], ['Resto Alpha', 'Tunis', 'Omar Beldi'], ['Resto Beta', 'Ariana', 'Nour Ali'], ['Resto Gamma', 'Tunis', 'Omar Beldi'], ['Resto Delta', 'Sfax', 'Omar Beldi']]);
const notifCsvOffre = toCsv([['Restaurant', 'Participation', 'Tag', 'Période'], ['Resto Alpha', '10', 'Toute la carte', '01/11/2026 - 23/11/2026']]);

test('Notifications Kool : Traité / Tout lu, regroupement, tri, clic, nouvelles alertes', async () => {
  const w = bootKool({ data: toCsv(notifDataRows), comm: notifCsvComm, port: notifCsvPort, offre: notifCsvOffre });
  await login(w, 'proprio', 'Proprio-Test-123');
  await w.yassirSyncKoolSheets(true);
  w.yassirSwitchBrand('kool');
  await wait(600);
  w.yassirApplyDatePreset('ALL');
  await wait(600);
  w.yassirRecalculerNotifications();
  await wait(200);

  const bell = () => w.document.getElementById('notifBellBadgeCount').textContent;
  const listTxt = () => w.document.getElementById('yassirNotifListBody').textContent;
  const groupCards = () => [...w.document.querySelectorAll('#yassirNotifListBody > div')];

  // 5 alertes non traitées : Beta 0 cmd, Gamma drop, Alpha fin offre, Delta annulations, données anciennes.
  assert.equal(bell(), '5', 'cloche : 5 alertes non traitées');
  assert.equal(w.document.getElementById('notifPanelTotalCount').textContent, '5', 'total panneau : 5');
  assert.equal(groupCards().length, 5, '5 cartes (4 restos + Système)');
  // Tri par gravité : Système d'abord, puis Beta (0 cmd) et Delta (annulations), Gamma (drop), Alpha (fin offre).
  const txt = listTxt();
  assert.ok(txt.indexOf('Système') < txt.indexOf('Resto Beta'), 'Système épinglé en haut');
  assert.ok(txt.indexOf('Resto Beta') < txt.indexOf('Resto Delta'), 'Beta (0 cmd) avant Delta (annulations)');
  assert.ok(txt.indexOf('Resto Delta') < txt.indexOf('Resto Gamma'), 'Delta avant Gamma (drop)');
  assert.ok(txt.indexOf('Resto Gamma') < txt.indexOf('Resto Alpha'), 'Gamma (drop) avant Alpha (fin offre)');
  // Compteurs par catégorie.
  assert.equal(w.document.getElementById('notifCntZero').textContent, '1', 'compteur 0 cmd : 1');
  assert.equal(w.document.getElementById('notifCntDrop').textContent, '1', 'compteur drop : 1');
  assert.equal(w.document.getElementById('notifCntOffer').textContent, '1', 'compteur fin offre : 1');
  assert.equal(w.document.getElementById('notifCntCanc').textContent, '1', 'compteur annulations : 1');
  assert.equal(w.document.getElementById('notifCntSystem').textContent, '1', 'compteur système : 1');
  assert.ok(txt.includes('4 jours'), 'alerte données anciennes : 4 jours');

  // Filtre catégorie : Fin offre → seule Alpha visible (la cloche ne change pas).
  w.yassirSetNotifCategoryFilter('OFFER_END');
  assert.ok(listTxt().includes('Resto Alpha'), 'filtre Fin offre : Alpha visible');
  assert.ok(!listTxt().includes('Resto Gamma'), 'filtre Fin offre : Gamma masqué');
  assert.equal(bell(), '5', 'cloche inchangée par le filtre catégorie');
  w.yassirSetNotifCategoryFilter('ALL');

  // « Traité » sur Beta : la cloche baisse, la carte disparaît.
  // (jsdom tourne en runScripts 'outside-only' : les onclick inline ne se
  // déclenchent pas au clic — on vérifie le câblage dans l'attribut, puis on
  // appelle la fonction directement, comme le ferait le clic dans un vrai navigateur.)
  const betaCard = groupCards().find((d) => d.textContent.includes('Resto Beta'));
  const traiteBtn = [...betaCard.querySelectorAll('button')].find((b) => b.textContent.includes('Traité'));
  assert.ok(traiteBtn, 'bouton Traité de Beta absent');
  assert.ok(traiteBtn.getAttribute('onclick').includes("yassirTraiterAlerte('kool|ZERO_3D|resto beta|Nour Ali')"), 'câblage Traité de Beta incorrect : ' + traiteBtn.getAttribute('onclick'));
  w.yassirTraiterAlerte('kool|ZERO_3D|resto beta|Nour Ali');
  assert.equal(bell(), '4', 'cloche : 4 après avoir traité Beta');
  assert.ok(!listTxt().includes('Resto Beta'), 'Beta disparaît de la liste');
  // L'alerte traitée ne réapparaît pas au recalcul (la situation existe toujours).
  w.yassirRecalculerNotifications();
  assert.equal(bell(), '4', 'cloche : toujours 4 après recalcul (Beta reste traitée)');

  // Clic sur la carte Gamma : onglet Analyse Restaurant, Gamma sélectionné.
  // (même remarque jsdom : on vérifie le câblage, puis on appelle directement.)
  const gammaCard = groupCards().find((d) => d.textContent.includes('Resto Gamma'));
  const gammaItem = gammaCard.querySelector('[onclick*="yassirOuvrirAlerte"]');
  assert.ok(gammaItem, 'carte Gamma sans onclick de navigation');
  assert.ok(gammaItem.getAttribute('onclick').includes("yassirOuvrirAlerte('resto gamma', 'DROP_3D')"), 'câblage clic Gamma incorrect : ' + gammaItem.getAttribute('onclick'));
  w.yassirOuvrirAlerte('resto gamma', 'DROP_3D');
  await wait(400);
  assert.equal(w.document.getElementById('panelRestoAnalytics').classList.contains('hidden'), false, 'clic Gamma : onglet Analyse Restaurant');
  assert.equal(w.document.getElementById('selectRestoAnalytics').value, 'resto gamma', 'clic Gamma : restaurant sélectionné');

  // Clic sur la carte Alpha (fin d'offre) : section Participation.
  w.yassirSetNotifCategoryFilter('ALL');
  const alphaCard = groupCards().find((d) => d.textContent.includes('Resto Alpha'));
  const alphaItem = alphaCard.querySelector('[onclick*="yassirOuvrirAlerte"]');
  assert.ok(alphaItem, 'carte Alpha sans onclick de navigation');
  assert.ok(alphaItem.getAttribute('onclick').includes("yassirOuvrirAlerte('resto alpha', 'OFFER_END')"), 'câblage clic Alpha incorrect : ' + alphaItem.getAttribute('onclick'));
  w.yassirOuvrirAlerte('resto alpha', 'OFFER_END');
  await wait(400);
  assert.equal(w.document.getElementById('panelParticipation').classList.contains('hidden'), false, 'clic Alpha (fin offre) : section Participation');

  // Synchro en échec : alerte épinglée, puis effacée.
  w.localStorage.setItem('yassir_pulse_last_sync_fail_v1', JSON.stringify({ brand: 'kool', at: new Date().toISOString(), detail: 'Data Kool' }));
  w.yassirRecalculerNotifications();
  assert.equal(bell(), '5', 'cloche : 5 avec l\'alerte synchro en échec');
  assert.ok(listTxt().includes('Synchro en échec'), 'alerte synchro en échec affichée');
  w.yassirEffacerEchecSynchro('kool');
  w.yassirRecalculerNotifications();
  assert.equal(bell(), '4', 'cloche : 4 après effacement de l\'échec');

  // « Tout marquer lu » : la cloche se vide.
  assert.ok(w.document.getElementById('btnNotifMarkAllRead'), 'bouton Tout marquer lu absent');
  w.yassirToutMarquerNotifLu();
  assert.equal(bell(), '0', 'cloche : 0 après Tout marquer lu');
  assert.ok(listTxt().includes('marquées comme traitées'), 'message « toutes traitées » affiché');

  assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
});

// ---- Notifications : alerte Budget (Yassir uniquement) ----
// Même montage que le test de la règle comptable : Data exp + règles Offre
// Participation. Coût restaurant total = 17 (A 0 + B 5 + C 8 + D 0 + E 4).
// Budget global préréglé en localStorage avant le chargement de l'application.
function bootYassirWithBudget(globalBudget) {
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.__PULSE_API__ = 'https://api.test';
  w.localStorage.setItem('yassir_vf_budget_v1', JSON.stringify({ byAm: {}, global: globalBudget }));
  w.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.startsWith('https://api.test')) {
      const r = await handle(new Request(u, { method: opts.method || 'GET', body: opts.body, headers: { Origin: 'http://localhost', ...(opts.headers || {}) } }), env);
      return { ok: r.ok, status: r.status, json: () => r.json(), text: () => r.text() };
    }
    sheetCalls.push(u);
    return { ok: false, status: 404, text: async () => '', json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
  };
  w.addEventListener('error', (e) => errors.push(e.message));
  w.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
  w.eval(bundle);
  return w;
}

test('Notifications Yassir : alerte Budget dépassé à 90 % puis 100 % (global)', async () => {
  const build = async (globalBudget) => {
    const w = bootYassirWithBudget(globalBudget);
    await login(w, 'proprio', 'Proprio-Test-123');
    const makeXlsxFile = (aoa, sheetName, fileName) => {
      const wb = w.XLSX.utils.book_new();
      w.XLSX.utils.book_append_sheet(wb, w.XLSX.utils.aoa_to_sheet(aoa), sheetName);
      const buf = w.XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      return new w.File([buf], fileName, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    };
    const rulesFile = makeXlsxFile([
      ['Restaurant', 'Participation', 'Tag', 'Période'],
      ['Resto Yassir A', '10', 'Toute la carte', '01/11/2026 - 30/11/2026'],
      ['Resto Yassir C', '', 'Toute la carte', '01/11/2026 - 30/11/2026'],
      ['Resto Yassir D', '20', 'Super Promo', '01/11/2026 - 30/11/2026']
    ], 'Offre Participation', 'offre-participation.xlsx');
    w.yassirOnOffrePartFileChange({ target: { files: [rulesFile], value: 'x' } });
    await wait(800);
    const dataAoa = [TARGET_HEADERS_TEST.slice(),
      yassirRow('16/11/2026', 'YAF-3001', 'Resto Yassir A', 100, 10, 'Percentage', ''),
      yassirRow('17/11/2026', 'YAF-3002', 'Resto Yassir B', 50, 5, 'Percentage', ''),
      yassirRow('17/11/2026', 'YAF-3003', 'Resto Yassir C', 80, 8, 'Percentage', ''),
      yassirRow('18/11/2026', 'YAF-3004', 'Resto Yassir D', 60, 6, '', 'Super Promo'),
      yassirRow('18/11/2026', 'YAF-3005', 'Resto Yassir E', 40, 4, '', 'Super Promo')
    ];
    // « Amount to restaurant » = montant brut (sinon la règle Comm. 100 % croit à tort
    // que le restaurant ne touche rien — la colonne est remplie dans le vrai Data exp).
    const idxAmtRest = TARGET_HEADERS_TEST.indexOf('amount to restaurant');
    dataAoa.slice(1).forEach((r) => { r[idxAmtRest] = r[TARGET_HEADERS_TEST.indexOf('item total')]; });
    const dataFile = makeXlsxFile(dataAoa, 'Data exp', 'data-exp.xlsx');
    w.yassirOnMainFileChange({ target: { files: [dataFile], value: 'x' } });
    await wait(1200);
    w.yassirRecalculerNotifications();
    await wait(200);
    return w;
  };

  // Budget global 10 TND, coût 17 → 170 % : alerte « Budget dépassé ».
  // (La cloche totale dépend du seed local — portefeuilles Yassir — on
  // vérifie le compteur Budget, indépendant du seed.)
  const w100 = await build(10);
  assert.equal(w100.document.getElementById('notifCntBudget').textContent, '1', 'compteur Budget : 1 à 170 %');
  w100.yassirSetNotifCategoryFilter('BUDGET');
  assert.ok(w100.document.getElementById('yassirNotifListBody').textContent.includes('Budget dépassé'), 'alerte Budget dépassé absente');

  // Budget global 18 TND, coût 17 → 94 % : alerte « Budget à 90 % ».
  const w90 = await build(18);
  assert.equal(w90.document.getElementById('notifCntBudget').textContent, '1', 'compteur Budget : 1 à 94 %');
  w90.yassirSetNotifCategoryFilter('BUDGET');
  assert.ok(w90.document.getElementById('yassirNotifListBody').textContent.includes('Budget à 90 %'), 'alerte Budget à 90 % absente');

  // Budget global 100 TND, coût 17 → 17 % : aucune alerte budget.
  const wOk = await build(100);
  assert.equal(wOk.document.getElementById('notifCntBudget').textContent, '0', 'compteur Budget : 0 à 17 %');
  wOk.yassirSetNotifCategoryFilter('BUDGET');
  assert.ok(!wOk.document.getElementById('yassirNotifListBody').textContent.includes('Budget'), 'alerte Budget présente à tort');

  assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
});

// ---- Mission C : mot de passe changé par le proprio -> session AM tuée ----
test('Mot de passe AM changé par le proprio : la session AM meurt au prochain contrôle (401 -> écran de connexion)', async () => {
  const wAm = boot();
  await login(wAm, 'omar.beldi', 'Omar-Test-12345');
  assert.equal(wAm.document.getElementById('appWrapper').classList.contains('hidden'), false, 'AM non connecté');
  assert.ok(wAm.sessionStorage.getItem('pulse_token_v1'), 'pas de jeton AM');

  // Le proprio change le mot de passe d'Omar (même KV en mémoire, autre fenêtre).
  const wOwner = boot();
  await login(wOwner, 'proprio', 'Proprio-Test-123');
  const ownerToken = wOwner.sessionStorage.getItem('pulse_token_v1');
  const putRes = await handle(new Request('https://api.test/api/accounts/omar.beldi', {
    method: 'PUT',
    body: JSON.stringify({ password: 'Nouveau-Mot-De-Passe-1', role: 'am', amName: 'Omar Beldi', displayName: 'Omar Beldi' }),
    headers: { Origin: 'http://localhost', Authorization: 'Bearer ' + ownerToken }
  }), env);
  assert.equal(putRes.status, 200, 'changement de mot de passe refusé');

  // L'AM vérifie sa session : 401 -> jeton effacé, écran de connexion.
  await wAm.yassirVerifierSession();
  await wait(300);
  assert.equal(wAm.sessionStorage.getItem('pulse_token_v1'), null, 'jeton AM toujours présent après 401');
  assert.equal(wAm.localStorage.getItem('pulse_token_v1'), null, 'jeton AM persistant toujours présent après 401');
  assert.equal(wAm.document.getElementById('loginScreen').classList.contains('hidden'), false, 'écran de connexion non affiché après 401');
  assert.equal(wAm.document.getElementById('appWrapper').classList.contains('hidden'), true, 'application toujours visible après 401');

  // L'ancien mot de passe ne marche plus, le nouveau oui.
  await login(wAm, 'omar.beldi', 'Omar-Test-12345');
  assert.equal(wAm.document.getElementById('appWrapper').classList.contains('hidden'), true, 'ancien mot de passe accepté à tort');
  await login(wAm, 'omar.beldi', 'Nouveau-Mot-De-Passe-1');
  assert.equal(wAm.document.getElementById('appWrapper').classList.contains('hidden'), false, 'nouveau mot de passe refusé');

  // Remise en état pour les autres tests (même KV partagé) : mot de passe d'origine.
  const amToken = wAm.sessionStorage.getItem('pulse_token_v1');
  assert.ok(amToken, 'pas de jeton après reconnexion');
  const restoreRes = await handle(new Request('https://api.test/api/accounts/omar.beldi', {
    method: 'PUT',
    body: JSON.stringify({ password: 'Omar-Test-12345', role: 'am', amName: 'Omar Beldi', displayName: 'Omar Beldi' }),
    headers: { Origin: 'http://localhost', Authorization: 'Bearer ' + ownerToken }
  }), env);
  assert.equal(restoreRes.status, 200, 'restauration du mot de passe AM échouée');

  assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
});

test('Proprio change SON propre mot de passe : il reste connecté (reconnexion automatique)', async () => {
  const w = boot();
  await login(w, 'proprio', 'Proprio-Test-123');
  assert.equal(w.document.getElementById('appWrapper').classList.contains('hidden'), false, 'proprio non connecté');
  const tokenBefore = w.sessionStorage.getItem('pulse_token_v1');

  w.yassirOpenAccessModal();
  await wait(800);
  const rows = [...w.document.querySelectorAll('#accountsTableBody tr')];
  const proprioIdx = rows.findIndex((tr) => tr.textContent.includes('proprio'));
  assert.ok(proprioIdx >= 0, 'compte proprio absent du tableau');
  w.yassirPrefillAccount(proprioIdx);
  w.document.getElementById('newAccountPassword').value = 'Nouveau-Proprio-123';
  w.yassirSaveAccount({ preventDefault() {} });
  await wait(1200);

  // Toujours connecté, avec un nouveau jeton (l'ancien est mort).
  assert.equal(w.document.getElementById('appWrapper').classList.contains('hidden'), false, 'proprio déconnecté après changement de son propre mot de passe');
  const tokenAfter = w.sessionStorage.getItem('pulse_token_v1');
  assert.ok(tokenAfter && tokenAfter !== tokenBefore, 'jeton non renouvelé');
  await w.yassirVerifierSession();
  await wait(300);
  assert.equal(w.document.getElementById('appWrapper').classList.contains('hidden'), false, 'session proprio invalide après vérification');

  // Le nouveau mot de passe fonctionne ; l'ancien ne marche plus. Puis remise en état.
  const w2 = boot();
  await login(w2, 'proprio', 'Proprio-Test-123');
  assert.equal(w2.document.getElementById('appWrapper').classList.contains('hidden'), true, 'ancien mot de passe proprio accepté à tort');
  await login(w2, 'proprio', 'Nouveau-Proprio-123');
  assert.equal(w2.document.getElementById('appWrapper').classList.contains('hidden'), false, 'nouveau mot de passe proprio refusé');
  const ownerToken2 = w2.sessionStorage.getItem('pulse_token_v1');
  const restoreRes = await handle(new Request('https://api.test/api/accounts/proprio', {
    method: 'PUT',
    body: JSON.stringify({ password: 'Proprio-Test-123', role: 'owner', displayName: 'Propriétaire Admin' }),
    headers: { Origin: 'http://localhost', Authorization: 'Bearer ' + ownerToken2 }
  }), env);
  assert.equal(restoreRes.status, 200, 'restauration du mot de passe proprio échouée');

  assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
});

// ---- Classeur fusionné : filtre par colonne APP ----
test('Classeur fusionné : filtre par colonne APP (portefeuilles, commissions, offres, budget)', () => {
  const w = boot();

  // Portefeuilles : lignes Yassir exclues de la carte Kool et inversement.
  const portRows = [
    ['Ville', 'Segment', 'restaurant Name', 'APP'],
    ['Tunis', 'Top Performer', 'Resto Yassir A', 'Yassir'],
    ['Sfax', 'Top Performer', 'Resto Kool A', 'Kool'],
    ['Tunis', 'Long Tail', 'Resto Commun', 'Yassir'],
    ['Tunis', 'Long Tail', 'Resto Commun', 'Kool']
  ];
  const mapK = {};
  w.yassirExtraireRestaurantsDepuisLignesSheet(portRows, 'Omar Beldi', mapK, 'Kool');
  assert.equal(Object.keys(mapK).length, 2, 'portefeuilles Kool : 2 restos');
  assert.ok(mapK['resto kool a'], 'portefeuilles Kool : Resto Kool A présent');
  assert.ok(mapK['resto commun'], 'portefeuilles Kool : Resto Commun présent');
  assert.ok(!mapK['resto yassir a'], 'portefeuilles Kool : Resto Yassir A exclu');
  const mapY = {};
  w.yassirExtraireRestaurantsDepuisLignesSheet(portRows, 'Omar Beldi', mapY, 'Yassir');
  assert.equal(Object.keys(mapY).length, 2, 'portefeuilles Yassir : 2 restos');
  assert.ok(mapY['resto yassir a'] && mapY['resto commun'], 'portefeuilles Yassir : bons restos');
  assert.ok(!mapY['resto kool a'], 'portefeuilles Yassir : Resto Kool A exclu');
  const mapAll = {};
  w.yassirExtraireRestaurantsDepuisLignesSheet(portRows, 'Omar Beldi', mapAll);
  assert.equal(Object.keys(mapAll).length, 3, 'sans filtre : 3 restos (Resto Commun fusionné)');
  // Sans colonne APP : tout est gardé (compatibilité anciens classeurs).
  const mapOld = {};
  w.yassirExtraireRestaurantsDepuisLignesSheet(
    [['Ville', 'Segment', 'restaurant Name'], ['Tunis', 'Top Performer', 'Resto Ancien']],
    'Omar Beldi', mapOld, 'Kool');
  assert.ok(mapOld['resto ancien'], 'sans colonne APP : ligne gardée');

  // Onglet Budget : il ne doit pas injecter de restaurants 'Yassir'/'Kool'.
  const wbRows = {
    'Omar Beldi': portRows,
    'Budget': [['AM', 'Budget global', 'APP'], ['Omar beldi', 337181, 'Yassir'], ['Omar beldi', 90000, 'Kool']],
    'Commissions': [['Restaurant', 'Commission', 'APP'], ['Resto X', 20, 'Yassir']],
    '2025 Kool': [['', 'W 07'], ['Requested', 100]]
  };
  const res = w.yassirExtrairePortefeuillesDepuisClasseur(Object.keys(wbRows), function (n) { return wbRows[n]; }, 'Yassir', null);
  assert.equal(Object.keys(res.map).length, 2, 'portefeuilles Yassir via classeur : 2 restos');
  assert.ok(!res.map['yassir'] && !res.map['kool'], 'onglet Budget : aucun resto Yassir/Kool injecté');

  // Commissions : filtre APP, ancien format sans en-tête conservé.
  const commRows = [
    ['Restaurant', 'Commission', 'APP'],
    ['Resto Yassir A', 20, 'Yassir'],
    ['Resto Kool A', 15, 'Kool'],
    ['Resto Commun', 25, 'Yassir'],
    ['Resto Commun', 10, 'Kool']
  ];
  const ck = w.yassirParseCommissionRows(commRows, 'Kool');
  assert.equal(ck.count, 2, 'commissions Kool : 2 lignes');
  assert.equal(ck.map['resto kool a'], 15, 'commission Kool A');
  assert.equal(ck.map['resto commun'], 10, 'commission Kool Commun');
  const cy = w.yassirParseCommissionRows(commRows, 'Yassir');
  assert.equal(cy.count, 2, 'commissions Yassir : 2 lignes');
  assert.equal(cy.map['resto commun'], 25, 'commission Yassir Commun');
  const co = w.yassirParseCommissionRows([['Resto Alpha', 20], ['Resto Beta', 15]], 'Kool');
  assert.equal(co.count, 2, 'commissions sans en-tête : 2 lignes (ancien format)');

  // Offres : filtre APP.
  const offreRows = [
    ['Area', 'Restaurant Name', 'C %', 'TAG', 'Responsable Account', 'Répartition', 'Participation de C %', "Détails de l'offre", 'Start Date', 'End Date', 'Période', 'APP'],
    ['El Menzah', 'Resto Yassir A', 100, 'Discount', 'Aziza', 'OOK', 10, '30% sur tt la carte', '2026-11-01', '2026-11-30', 'Black Friday', 'Yassir'],
    ['Sfax', 'Resto Kool A', 25, 'BOGOF', 'Ilyes', 'Sud (Ilyes)', 0, '1 acheté = 1 offert', '2026-11-01', '2026-12-07', 'Black Friday', 'Kool']
  ];
  const ok = w.yassirParseOffreParticipationRows(offreRows, 'Kool');
  assert.equal(ok.length, 1, 'offres Kool : 1 règle');
  assert.equal(ok[0].restaurant, 'resto kool a', 'offre Kool : bon restaurant');
  const oy = w.yassirParseOffreParticipationRows(offreRows, 'Yassir');
  assert.equal(oy.length, 1, 'offres Yassir : 1 règle');
  assert.equal(oy[0].restaurant, 'resto yassir a', 'offre Yassir : bon restaurant');
  assert.equal(w.yassirParseOffreParticipationRows(offreRows).length, 2, 'offres sans filtre : 2 règles');

  // Budget : séparation par APP ; sans APP → Yassir.
  const budgetRows = [
    ['AM', 'Budget global', 'APP'],
    ['Omar beldi', 337181, 'Yassir'],
    ['Omar beldi', 90000, 'Kool'],
    ['Nour Ali', 100000, 'Yassir'],
    ['Nour Ali', 20000, 'Kool']
  ];
  const b = w.yassirParseBudgetRowsParMarque(budgetRows);
  assert.equal(b.yassir['Omar Beldi'], 337181, 'budget Yassir Omar');
  assert.equal(b.kool['Omar Beldi'], 90000, 'budget Kool Omar');
  assert.equal(b.yassir['Nour Ali'], 100000, 'budget Yassir Nour');
  assert.equal(b.kool['Nour Ali'], 20000, 'budget Kool Nour');
  const b2 = w.yassirParseBudgetRowsParMarque([['AM', 'Budget global'], ['Omar beldi', 50000]]);
  assert.equal(b2.yassir['Omar Beldi'], 50000, 'budget sans APP : Yassir');
  assert.equal(Object.keys(b2.kool).length, 0, 'budget sans APP : rien pour Kool');

  assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
});

// ---- 2025 Kool : synchro et panneau YoY ----
test('Kool : données 2025 Kool synchronisées et utilisées par le panneau YoY', async () => {
  const w = bootKool({ data: koolCsvDataDeck, comm: koolCsvCommDeck, port: koolCsvPortDeck, hist2025: koolCsvHist2025Kool });
  await login(w, 'proprio', 'Proprio-Test-123');
  await w.yassirSyncKoolSheets(true);
  w.yassirSwitchBrand('kool');
  await wait(600);
  // Lignes 2025 Kool stockées séparément des lignes Yassir.
  const stored = w.localStorage.getItem('kool_vf_hist_2025_rows_v1');
  assert.ok(stored && stored.includes('Requested'), 'lignes 2025 Kool stockées');
  assert.equal(w.yassirGetActive2025Rows().length, 5, 'lignes 2025 actives en Kool : 5');
  // Période courante W47 (16-22/11/2026).
  w.yassirApplyDatePreset('ALL');
  await wait(600);
  w.document.getElementById('filterDateStart').value = '2026-11-16';
  w.document.getElementById('filterDateEnd').value = '2026-11-22';
  w.yassirOnDateRangeChange();
  await wait(600);
  w.yassirSwitchTab('synth_global');
  await wait(600);
  const yoyGrid = w.document.getElementById('synth2025YoyCardsGrid');
  assert.ok(yoyGrid, 'grille YoY absente');
  // La grille doit garder xl:col-span-12 (pleine largeur de la slide) :
  // renderSynth2025Panel écrasait className et les cartes finissaient
  // écrasées dans une étroite bande à gauche (capture du 2026-11-26).
  assert.ok(yoyGrid.classList.contains('xl:col-span-12'), 'grille YoY : doit garder xl:col-span-12 pour rester pleine largeur');
  assert.ok(!yoyGrid.textContent.includes('indisponible pour Kool'), 'la note « indisponible pour Kool » doit disparaître avec des données 2025 Kool');
  assert.ok(yoyGrid.textContent.includes('Variation YoY'), 'carte YoY W47 absente');
  // Cartes YoY : semaine en cours W47 + semaine précédente W46 (comme le
  // filtre) — plus W45 (bug : le code poussait curSelectedW - 2).
  assert.ok(yoyGrid.textContent.includes('W47'), 'carte YoY W47 absente');
  assert.ok(yoyGrid.textContent.includes('W46'), 'carte YoY W46 (semaine précédente) absente');
  assert.ok(!yoyGrid.textContent.includes('W45'), 'carte YoY W45 : ne doit plus s\'afficher');
  assert.ok(yoyGrid.textContent.indexOf('W47') < yoyGrid.textContent.indexOf('W46'), 'carte W47 : doit être avant W46');
  const note = w.document.getElementById('koolNoYoyNote');
  assert.ok(note && note.classList.contains('hidden'), 'note Kool sous les graphiques YoY : doit être masquée');
  // La série 2025 du graphique YoY n'est plus vide (W45 : 5 livrées, W46 : 6, W47 : 7).
  const yoyCfg = w.__chartConfigs.find(function (c) {
    return c && c.data && Array.isArray(c.data.datasets) && c.data.datasets.length === 2 &&
      c.data.datasets[0].label === '2025' && c.data.datasets[1].label === '2026';
  });
  assert.ok(yoyCfg, 'config graphique YoY introuvable');
  assert.ok(yoyCfg.data.datasets[0].data.some(function (v) { return v !== null && v !== undefined; }), 'série 2025 du graphique YoY : vide');
  assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
});

// ---- 2025 : validation des lignes avant stockage (repli par nom d'onglet) ----
// Risque corrigé (2026-11-26) : gviz ignore parfois le gid et renvoie le 1er
// onglet (portefeuilles). Sans validation, ~1300 lignes de portefeuilles
// étaient stockées comme « données 2025 » et la comparaison YoY restait vide
// sans aucun message d'erreur.
test('2025 : le validateur accepte une matrice 2025 et rejette le reste', () => {
  const w = boot();
  const matrice = [
    ['', 'W 07', 'W 08', 'W 09'],
    ['Requested', 100, 110, 120],
    ['Delivered Orders', 5, 6, 7],
    ['GMV (Total Food VF)', 100, 120, 140]
  ];
  assert.equal(w.yassirValiderLignes2025(matrice), true, 'matrice 2025 refusée');
  // Lignes de portefeuilles (mauvaise feuille renvoyée malgré le gid).
  const portefeuilles = [
    ['Ville', 'Segment', 'restaurant Name', 'APP'],
    ['Sousse', 'Top Performer', 'BABKE Kebab & Plates', 'Yassir'],
    ['El Menzah', 'Top Performer', 'Plan B Ennasr', 'Yassir']
  ];
  assert.equal(w.yassirValiderLignes2025(portefeuilles), false, 'portefeuilles acceptés comme 2025');
  assert.equal(w.yassirValiderLignes2025([]), false, 'lignes vides acceptées');
  assert.equal(w.yassirValiderLignes2025([['', 'W 07', 'W 08'], ['Requested', 1, 2]]), false, 'moins de 3 colonnes semaine acceptées');
  // « W15 » sans espace et « Semaine 10 » sont aussi des semaines.
  assert.equal(w.yassirValiderLignes2025([['', 'W15', 'W16', 'Semaine 10'], ['Requested', 1, 2, 3]]), true, 'variantes W15 / Semaine 10 refusées');
  assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
});

test('2025 Kool : le stockage validé stocke et compte, l\'invalide retourne 0 sans écraser', () => {
  const w = boot();
  const matrice = [
    ['', 'W 45', 'W 46', 'W 47'],
    ['Requested', 100, 110, 120],
    ['Delivered Orders', 5, 6, 7],
    ['GMV (Total Food VF)', 100, 120, 140],
    ['CA KOOL', 10, 12, 14]
  ];
  assert.equal(w.yassirStockerLignes2025Kool(matrice), 5, 'lignes 2025 valides : 5 attendues');
  const stored = w.localStorage.getItem('kool_vf_hist_2025_rows_v1');
  assert.ok(stored && stored.includes('Requested'), 'lignes 2025 Kool non stockées');
  // Lignes de portefeuilles : 0, et le bon stockage n'est pas écrasé.
  const portefeuilles = [
    ['Ville', 'Segment', 'restaurant Name', 'APP'],
    ['Sousse', 'Top Performer', 'BABKE Kebab & Plates', 'Yassir']
  ];
  assert.equal(w.yassirStockerLignes2025Kool(portefeuilles), 0, 'portefeuilles stockés comme 2025');
  assert.equal(w.localStorage.getItem('kool_vf_hist_2025_rows_v1'), stored, 'le stockage valide a été écrasé par des lignes invalides');
  assert.equal(w.yassirStockerLignes2025Kool([]), 0, 'lignes vides stockées');
  // Symétrique côté Yassir.
  assert.equal(w.yassirStockerLignes2025Yassir(matrice), 5, 'lignes 2025 Yassir : 5 attendues');
  assert.ok(w.localStorage.getItem('yassir_vf_hist_2025_rows_v1').includes('Requested'), 'lignes 2025 Yassir non stockées');
  assert.equal(w.yassirStockerLignes2025Yassir(portefeuilles), 0, 'portefeuilles stockés comme 2025 Yassir');
  assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
});

// ---- Multi-onglets : data journalière par onglet (2026-11-26) ----
// Construit un classeur XLSX simulé (ArrayBuffer) à partir d'une liste
// [nomOnglet, aoa].
const construireClasseurXlsx = (w, onglets) => {
  const wb = w.XLSX.utils.book_new();
  onglets.forEach(([nom, aoa]) => {
    w.XLSX.utils.book_append_sheet(wb, w.XLSX.utils.aoa_to_sheet(aoa), nom);
  });
  const out = w.XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return (out instanceof ArrayBuffer) ? out : new Uint8Array(out).buffer;
};
// Lit un CSV (chaîne) en AoA via SheetJS (pour construire l'onglet principal
// d'un classeur simulé à partir du deck CSV existant).
const aoaDepuisCsv = (w, csv) => {
  const wbCsv = w.XLSX.read(csv, { type: 'string' });
  return w.XLSX.utils.sheet_to_json(wbCsv.Sheets[wbCsv.SheetNames[0]], { header: 1, defval: '' });
};

test('Multi-onglets : fusion des onglets, mapping par en-têtes, onglets invalides ignorés', async () => {
  const w = bootKool();
  const sheetId = 'TEST_MULTI_TAB_ID_000000000001';
  const mainAoa = [
    ['Annulé', '', 'Raison annulation', 'Date', 'N° commande', '', 'Restaurant', '', '', 'Montant HT', 'Frais livraison', 'Remise'],
    ['', '', '', '16/11/2026', '1001', '', 'Resto Alpha', '', '', '25.50', '3', '0'],
    ['', '', '', '17/11/2026', '1002', '', 'Resto Alpha', '', '', '40.00', '6', '5']
  ];
  // Onglet journalier : mêmes colonnes dans un ordre différent + 2 commandes
  // (1006 le 19/11, 1007 le 20/11).
  const dailyAoa = [
    ['Restaurant', 'Remise', 'N° commande', 'Date', 'Montant HT', 'Annulé', 'Raison annulation', '', '', '', 'Frais livraison', ''],
    ['Resto Alpha', '2', '1006', '19/11/2026', '30.00', '', '', '', '', '', '4', ''],
    ['Resto Beta', '0', '1007', '20/11/2026', '20.00', '', '', '', '', '', '3', '']
  ];
  const badAoa = [['Ville', 'Segment', 'Restaurant'], ['Tunis', 'Top', 'Resto X']];
  const xlsxBuf = construireClasseurXlsx(w, [
    ['Data', mainAoa],
    ['2026-11-19', dailyAoa],
    ['Portefeuilles', badAoa],
    ['Vide', []]
  ]);
  let xlsxFetches = 0;
  const origFetch = w.fetch;
  w.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes(sheetId)) {
      if (u.includes('format=xlsx')) {
        xlsxFetches++;
        return { ok: true, status: 200, text: async () => '', json: async () => ({}), arrayBuffer: async () => xlsxBuf };
      }
      return { ok: true, status: 200, text: async () => toCsv(mainAoa), json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
    }
    return origFetch(url, opts);
  };
  w.yassirViderCacheOngletsClasseur();
  const merged = await w.yassirLireClasseurToutesFeuilles(sheetId, '0', w.yassirValiderEnTetesDataKool, { force: true });
  assert.equal(xlsxFetches, 1, 'découverte XLSX : 1 téléchargement attendu');
  assert.equal(merged.length, 5, 'lignes fusionnées : 1 en-tête + 2 + 2, obtenu ' + merged.length);
  const byOid = {};
  merged.slice(1).forEach((r) => { byOid[String(r[4] || '').trim()] = r; });
  assert.ok(byOid['1001'] && byOid['1002'], 'commandes de l\'onglet principal absentes');
  assert.ok(byOid['1006'] && byOid['1007'], 'commandes de l\'onglet journalier absentes');
  // Mapping par en-têtes : la commande 1006 a ses valeurs aux bons indices
  // (Date en 3, Restaurant en 6, Montant HT en 9, Remise en 11) malgré
  // l'ordre des colonnes différent dans son onglet.
  assert.equal(byOid['1006'][3], '19/11/2026', 'date 1006 mal mappée');
  assert.equal(byOid['1006'][6], 'Resto Alpha', 'restaurant 1006 mal mappé');
  assert.equal(String(byOid['1006'][9]), '30.00', 'montant 1006 mal mappé');
  assert.equal(String(byOid['1006'][11]), '2', 'remise 1006 mal mappée');
  // Onglet invalide (portefeuilles) et onglet vide ignorés : pas de « Resto X ».
  assert.ok(!merged.some((r) => String(r[6] || '').includes('Resto X')), 'onglet invalide non ignoré');
  assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
});

test('Multi-onglets : classeur à un seul onglet = comportement inchangé, pas de second téléchargement XLSX', async () => {
  const w = bootKool();
  const sheetId = 'TEST_SINGLE_TAB_ID_00000000001';
  const mainAoa = [
    ['Annulé', '', 'Raison annulation', 'Date', 'N° commande', '', 'Restaurant', '', '', 'Montant HT', 'Frais livraison', 'Remise'],
    ['', '', '', '16/11/2026', '1001', '', 'Resto Alpha', '', '', '25.50', '3', '0'],
    ['', '', '', '17/11/2026', '1002', '', 'Resto Alpha', '', '', '40.00', '6', '5']
  ];
  const xlsxBuf = construireClasseurXlsx(w, [['Data', mainAoa]]);
  let xlsxFetches = 0;
  const origFetch = w.fetch;
  w.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes(sheetId)) {
      if (u.includes('format=xlsx')) {
        xlsxFetches++;
        return { ok: true, status: 200, text: async () => '', json: async () => ({}), arrayBuffer: async () => xlsxBuf };
      }
      return { ok: true, status: 200, text: async () => toCsv(mainAoa), json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
    }
    return origFetch(url, opts);
  };
  w.yassirViderCacheOngletsClasseur();
  const r1 = await w.yassirLireClasseurToutesFeuilles(sheetId, '0', w.yassirValiderEnTetesDataKool, {});
  assert.equal(r1.length, 3, '1er appel : lignes de l\'onglet principal');
  assert.equal(xlsxFetches, 1, '1er appel : une seule découverte XLSX');
  const r2 = await w.yassirLireClasseurToutesFeuilles(sheetId, '0', w.yassirValiderEnTetesDataKool, {});
  assert.equal(r2.length, 3, '2e appel : mêmes lignes');
  assert.equal(xlsxFetches, 1, '2e appel : aucun téléchargement XLSX supplémentaire (cache 1 onglet)');
  assert.deepEqual(r2, r1, 'résultat identique entre les deux appels');
  // Synchro manuelle : force la redécouverte.
  await w.yassirLireClasseurToutesFeuilles(sheetId, '0', w.yassirValiderEnTetesDataKool, { force: true });
  assert.equal(xlsxFetches, 2, 'appel forcé : redécouverte XLSX');
  assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
});

test('Kool : synchro multi-onglets (Data + détails articles), pas de duplication au 2e sync', async () => {
  const w = bootKool();
  await login(w, 'proprio', 'Proprio-Test-123');
  // Onglet journalier Data : mêmes colonnes dans un ordre différent
  // (1006 le 19/11, 1007 le 20/11). On reste en novembre : le site ignore
  // les dates futures (garde préexistante de parseOrderDayToIsoDate), donc
  // un onglet de décembre ne sera lu qu'à partir de décembre — la fenêtre
  // décembre est testée unitairement plus bas (yassirEstDatePeriodeActive).
  const dailyDataAoa = [
    ['Restaurant', 'Remise', 'N° commande', 'Date', 'Montant HT', 'Annulé', 'Raison annulation', '', '', '', 'Frais livraison', ''],
    ['Resto Alpha', '2', '1006', '19/11/2026', '30.00', '', '', '', '', '', '4', ''],
    ['Resto Beta', '0', '1007', '20/11/2026', '20.00', '', '', '', '', '', '3', '']
  ];
  const dataWbBuf = construireClasseurXlsx(w, [
    ['Data', aoaDepuisCsv(w, koolCsvData)],
    ['2026-11-19', dailyDataAoa],
    ['Portefeuilles', [['Ville', 'Segment', 'Restaurant'], ['Tunis', 'Top', 'Resto X']]]
  ]);
  // Onglet journalier Détails articles : colonnes dans un ordre différent.
  const dailyItemsAoa = [
    ['Article', 'Order ID', 'Date', 'Restaurant', 'Category', 'Quantity', 'Unit Price', 'Discount Price', 'Original Price', 'Type'],
    ['Pizza Quatre Fromages', '1006', '19/11/2026', 'Resto Alpha', 'Pizza', 1, 14, 0, 14, 'Food'],
    ['Tiramisu', '1006', '19/11/2026', 'Resto Alpha', 'Dessert', 1, 6, 0, 6, 'Food'],
    ['Salade César', '1007', '20/11/2026', 'Resto Beta', 'Salade', 2, 8, 0, 8, 'Food']
  ];
  const itemsWbBuf = construireClasseurXlsx(w, [
    ['Détails', aoaDepuisCsv(w, koolCsvItems)],
    ['2026-11-19', dailyItemsAoa]
  ]);
  const origFetch = w.fetch;
  w.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes(koolCfg.DATA_SHEET_ID) && u.includes('format=xlsx')) return { ok: true, status: 200, text: async () => '', json: async () => ({}), arrayBuffer: async () => dataWbBuf };
    if (u.includes(koolCfg.ORDER_ITEMS_SHEET_ID) && u.includes('format=xlsx')) return { ok: true, status: 200, text: async () => '', json: async () => ({}), arrayBuffer: async () => itemsWbBuf };
    return origFetch(url, opts);
  };
  const lireKpiGmvBrut = () => {
    const kpi = {};
    w.document.querySelectorAll('#synthGlobalKpisBody tr').forEach((tr) => {
      const tds = tr.querySelectorAll('td');
      if (tds.length >= 2) kpi[tds[0].textContent.trim()] = tds[1].textContent.trim();
    });
    return kpi['GMV Brut (Item total)'];
  };
  await w.yassirSyncKoolSheets(true);
  w.yassirSwitchBrand('kool');
  await wait(600);
  w.yassirApplyDatePreset('ALL');
  await wait(600);
  w.yassirSwitchTab('synth_global');
  await wait(600);
  // GMV Brut deck 98.5 + 1006 (30+2) + 1007 (20+0) = 150.5.
  assert.equal(lireKpiGmvBrut(), '150.5', 'GMV Brut Kool multi-onglets : ' + lireKpiGmvBrut());
  // Détails articles : 5 lignes du deck + 3 de l'onglet journalier = 8.
  assert.equal(w.koolOrderItemsRawCount, 8, 'détails articles multi-onglets : ' + w.koolOrderItemsRawCount);
  assert.ok(w.koolOrderItemsByOrderId.has('1006'), 'commande 1006 absente des détails articles');
  assert.ok(w.koolOrderItemsByOrderId.has('1007'), 'commande 1007 absente des détails articles');
  // 2e synchro : pas de duplication (fusion par Order ID + réindexation).
  await w.yassirSyncKoolSheets(true);
  w.yassirApplyDatePreset('ALL');
  await wait(600);
  w.yassirSwitchTab('synth_global');
  await wait(600);
  assert.equal(lireKpiGmvBrut(), '150.5', 'GMV Brut après 2e sync (duplication ?) : ' + lireKpiGmvBrut());
  assert.equal(w.koolOrderItemsRawCount, 8, 'détails articles après 2e sync : ' + w.koolOrderItemsRawCount);
  assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
});

test('Yassir : synchro multi-onglets par mois (fusion des onglets journaliers)', async () => {
  // Mois simulés (la config de test n'en a pas par défaut) : on remplace la
  // config du worker pour ce test puis on la restaure.
  const octId = 'YASSIR_OCT_TEST_ID_000000000001';
  const novId = 'YASSIR_NOV_TEST_ID_000000000002';
  const prevConfig = store.get('config');
  try {
    store.set('config', JSON.stringify({ live: { ...seed.live, HISTORICAL_MONTHS: [
      { label: 'Octobre (Google Sheets)', sheetId: octId, gid: '0', tab: 'Data exp' },
      { label: 'Novembre (Google Sheets)', sheetId: novId, gid: '0', tab: 'Data exp' }
    ] }, kool: koolCfg }));
    const w = boot();
    const mkRow = (date, oid, resto, itemTot) => yassirRow(date, oid, resto, itemTot, 0, '', '');
    // Octobre : onglet principal (1 commande) + onglet journalier aux colonnes
    // mélangées (2 commandes).
    const octMainAoa = [TARGET_HEADERS_TEST.slice(), mkRow('16/10/2026', 'YAF-9001', 'Resto Yassir A', 100)];
    const octDailyHeaders = [...TARGET_HEADERS_TEST].reverse();
    const octDailyAoa = [octDailyHeaders,
      [...mkRow('17/10/2026', 'YAF-9002', 'Resto Yassir B', 50)].reverse(),
      [...mkRow('20/11/2026', 'YAF-9004', 'Resto Yassir C', 40)].reverse()];
    const octWbBuf = construireClasseurXlsx(w, [
      ['Data exp', octMainAoa],
      ['2026-10-17', octDailyAoa]
    ]);
    // Novembre : un seul onglet (comportement inchangé).
    const novMainAoa = [TARGET_HEADERS_TEST.slice(), mkRow('16/11/2026', 'YAF-9003', 'Resto Yassir A', 60)];
    const novWbBuf = construireClasseurXlsx(w, [['Data exp', novMainAoa]]);
    const origFetch = w.fetch;
    w.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.includes(octId)) {
        if (u.includes('format=xlsx')) return { ok: true, status: 200, text: async () => '', json: async () => ({}), arrayBuffer: async () => octWbBuf };
        return { ok: true, status: 200, text: async () => toCsv(octMainAoa), json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
      }
      if (u.includes(novId)) {
        if (u.includes('format=xlsx')) return { ok: true, status: 200, text: async () => '', json: async () => ({}), arrayBuffer: async () => novWbBuf };
        return { ok: true, status: 200, text: async () => toCsv(novMainAoa), json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
      }
      return origFetch(url, opts);
    };
    await login(w, 'proprio', 'Proprio-Test-123');
    await w.yassirSyncHistoricalSheets(true);
    // 2 sources (Octobre + Novembre), 4 commandes (9001 + 9002 + 9004 + 9003).
    assert.ok(w.document.getElementById('mainFileName').textContent.includes('2 source(s)'), 'sources Yassir : ' + w.document.getElementById('mainFileName').textContent);
    assert.ok(w.document.getElementById('mainFileName').textContent.includes('4 commandes'), 'commandes Yassir fusionnées : ' + w.document.getElementById('mainFileName').textContent);
    // La 4e commande (onglet journalier) est bien dans l'archive.
    assert.ok(w.document.getElementById('mainFileSub').textContent.includes('2026-11-20'), 'période max sans 20/11 : ' + w.document.getElementById('mainFileSub').textContent);
    // 2e synchro : pas de duplication.
    await w.yassirSyncHistoricalSheets(true);
    assert.ok(w.document.getElementById('mainFileName').textContent.includes('4 commandes'), 'commandes après 2e sync : ' + w.document.getElementById('mainFileName').textContent);
    assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
  } finally {
    store.set('config', prevConfig);
  }
});

// ---- Fenêtre de données active : décembre accepté (data journalière) ----
// Le site ignore les dates futures (garde préexistante de
// parseOrderDayToIsoDate) : un onglet de décembre 2026 ne peut pas être
// testé de bout en bout tant qu'on est en novembre — on teste donc la
// fenêtre avec des dates de décembre déjà passées (2025).
test('Fenêtre active : décembre accepté, mai rejeté', () => {
  const w = boot();
  assert.equal(w.yassirEstDatePeriodeActive('19/12/2025'), true, 'décembre doit être dans la fenêtre active');
  assert.equal(w.yassirEstDatePeriodeActive('19/11/2026'), true, 'novembre doit être dans la fenêtre active');
  assert.equal(w.yassirEstDatePeriodeActive('19/10/2026'), true, 'octobre doit être dans la fenêtre active');
  assert.equal(w.yassirEstDatePeriodeActive('19/05/2026'), false, 'mai doit être hors fenêtre active');
  assert.equal(w.yassirEstDatePeriodeActive(''), false, 'date vide rejetée');
  assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
});

// ---- Budget Kool : alertes « Budget à 90 % » et « Budget dépassé » en mode Kool ----
// Données deck Kool (toute période) : coût = livraison gratuite (5 − K quand K < 5)
// + part restaurant des offres Resto Alpha (règle 10 % : 2001 → 5 − 3.5 = 1.5,
// 2006 → 5 − 4 = 1, soit 2.5) = 23.50 TND (Omar : Alpha 18 + 2.5, Gamma 3)
// et 28.50 TND (Global : + Beta 5). Budget Kool Omar 25 TND → Omar 94 %
// (alerte « Budget à 90 % »), Global 114 % (alerte « Budget dépassé »).
test('Notifications Kool : alerte Budget à 90 % avec les budgets Kool', async () => {
  const w = bootKool({ data: koolCsvDataDeck, comm: koolCsvCommDeck, port: koolCsvPortDeck });
  w.localStorage.setItem('kool_vf_budget_v1', JSON.stringify({ byAm: { 'Omar Beldi': 25 }, global: 25 }));
  await login(w, 'proprio', 'Proprio-Test-123');
  await w.yassirSyncKoolSheets(true);
  w.yassirSwitchBrand('kool');
  await wait(600);
  w.yassirApplyDatePreset('ALL');
  await wait(600);
  w.yassirRecalculerNotifications();
  await wait(200);
  assert.equal(w.document.getElementById('notifCntBudget').textContent, '2', 'compteur Budget Kool : 2 (Global + Omar)');
  w.yassirSetNotifCategoryFilter('BUDGET');
  const budTxt = w.document.getElementById('yassirNotifListBody').textContent;
  assert.ok(budTxt.includes('Budget à 90 %'), 'alerte Budget Kool à 90 % absente (Omar 94 %)');
  assert.ok(budTxt.includes('Budget dépassé'), 'alerte Budget Kool dépassé absente (Global 114 %)');
  assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
});

// ---- Journal d'activité des AM (visible uniquement par le proprio) ----
test("journal d'activité : un AM est journalisé (export + déconnexion), le proprio ne l'est pas", async () => {
  store.delete('activity_log');
  const w = boot();
  await login(w, 'omar.beldi', 'Omar-Test-12345');
  w.yassirJournaliser('export', 'Export Excel : Test.xlsx');
  await wait(400);
  // La connexion AM (côté Worker) + l'export sont journalisés.
  let entries = JSON.parse(store.get('activity_log') || '[]');
  assert.ok(entries.some((e) => e.type === 'login' && e.user === 'omar.beldi'), 'connexion AM absente du journal');
  assert.ok(entries.some((e) => e.type === 'export' && e.user === 'omar.beldi' && e.detail.includes('Test.xlsx')), 'export AM absent du journal');
  // Déconnexion journalisée.
  w.yassirLogout();
  await wait(400);
  entries = JSON.parse(store.get('activity_log') || '[]');
  assert.ok(entries.some((e) => e.type === 'logout' && e.user === 'omar.beldi'), 'déconnexion AM absente du journal');
  // Le proprio n'est jamais journalisé : ni sa connexion, ni ses appels à l'aide.
  const before = entries.length;
  const w2 = boot();
  await login(w2, 'proprio', 'Proprio-Test-123');
  w2.yassirJournaliser('export', 'Export Excel : Proprio.xlsx');
  await wait(400);
  entries = JSON.parse(store.get('activity_log') || '[]');
  assert.equal(entries.length, before, 'le proprio ne doit rien ajouter au journal');
  assert.ok(!entries.some((e) => e.user === 'proprio'), 'aucune entrée proprio dans le journal');
});

test("journal d'activité : échec de connexion AM journalisé côté Worker", async () => {
  store.delete('activity_log');
  const w = boot();
  await login(w, 'omar.beldi', 'mauvais-mot-de-passe');
  await wait(300);
  const entries = JSON.parse(store.get('activity_log') || '[]');
  assert.equal(entries.length, 1, 'un seul échec attendu');
  assert.equal(entries[0].type, 'login_fail');
  assert.equal(entries[0].user, 'omar.beldi');
  assert.ok(!JSON.stringify(entries).includes('mauvais-mot-de-passe'), 'jamais de mot de passe dans le journal');
});

test("journal d'activité : le proprio voit le journal et ses filtres, l'AM ne voit pas le bouton", async () => {
  store.set('activity_log', JSON.stringify([
    { ts: Date.now() - 3000, user: 'omar.beldi', type: 'login', detail: 'Connexion' },
    { ts: Date.now() - 2000, user: 'omar.beldi', type: 'export', detail: 'Export Excel : Test.xlsx' },
    { ts: Date.now() - 1000, user: 'aziza.souli', type: 'alerte', detail: 'Alerte traitée : Commission 100 % — Resto Test' }
  ]));
  const w = boot();
  await login(w, 'proprio', 'Proprio-Test-123');
  assert.equal(w.document.getElementById('btnOpenActivityLog').classList.contains('hidden'), false, 'bouton journal absent pour le proprio');
  w.yassirOuvrirJournalActivite();
  await wait(1000);
  assert.equal(w.document.getElementById('activityLogModal').classList.contains('hidden'), false, 'modale journal non ouverte');
  const rows = () => w.document.querySelectorAll('#activityLogTableBody tr');
  assert.equal(rows().length, 3, '3 entrées attendues');
  assert.ok(rows()[0].textContent.includes('aziza.souli'), 'plus récentes d\'abord');
  // Filtre par type.
  w.document.getElementById('activityLogTypeFilter').value = 'export';
  w.yassirFiltrerJournalActivite();
  assert.equal(rows().length, 1, 'filtre export : 1 entrée');
  // Filtre par AM.
  w.document.getElementById('activityLogTypeFilter').value = 'ALL';
  w.document.getElementById('activityLogUserFilter').value = 'omar.beldi';
  w.yassirFiltrerJournalActivite();
  assert.equal(rows().length, 2, 'filtre omar.beldi : 2 entrées');
  assert.equal(w.document.getElementById('activityLogCount').textContent, '2', 'compteur filtré : 2');
  // Effacement (confirmation acceptée).
  w.confirm = function () { return true; };
  w.yassirEffacerJournalActivite();
  await wait(400);
  assert.equal(store.get('activity_log'), undefined, 'journal non effacé côté serveur');
  assert.ok(w.document.getElementById('activityLogTableBody').textContent.includes('Aucune activité'), 'tableau non vidé');
  // L'AM ne voit pas le bouton.
  const wAm = boot();
  await login(wAm, 'omar.beldi', 'Omar-Test-12345');
  assert.equal(wAm.document.getElementById('btnOpenActivityLog').classList.contains('hidden'), true, 'bouton journal visible pour un AM');
});

test("journal d'activité : alerte marquée « Traité » journalisée", async () => {
  store.delete('activity_log');
  const w = boot();
  await login(w, 'omar.beldi', 'Omar-Test-12345');
  w.yassirTraiterAlerte('test|key');
  await wait(400);
  const entries = JSON.parse(store.get('activity_log') || '[]');
  assert.ok(entries.some((e) => e.type === 'alerte' && e.detail.includes('test|key')), 'alerte traitée absente du journal');
});
