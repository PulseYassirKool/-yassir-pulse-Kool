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
  DATA_GID: '0', ORDER_ITEMS_GID: '0', COMMISSION_GID: '0', PORTFOLIOS_GID: '0', OFFRE_PARTICIPATION_GID: '0',
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
  deckRow('14/11/2026', '2009', 105, 'Resto Alpha', '12.00', '2', '0', 0),
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

  // Classifieur client (règle des 60 jours) — test unitaire direct : l'archive ne
  // couvre qu'oct.–nov. 2026, un écart > 60 jours est impossible via les données
  // synchronisées (le test d'intégration ci-dessous a donc 0 réactivé, ce qui est
  // le résultat honnête pour 2 mois d'archive).
  assert.equal(w.yassirClassifierClientKool(1, '', '2026-11-16'), 'new', 'New Client = 1 → nouveau');
  assert.equal(w.yassirClassifierClientKool(0, '2026-10-20', '2026-11-16'), 'returning', 'ancien, 27 jours → retour');
  assert.equal(w.yassirClassifierClientKool(0, '2026-09-10', '2026-11-16'), 'reactivated', 'ancien, 67 jours → réactivé');
  assert.equal(w.yassirClassifierClientKool(0, '2026-09-17', '2026-11-16'), 'returning', 'ancien, 60 jours exactement → retour (seuil > 60)');
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
  // Nouveaux : 104, 106 (Alpha), 301, 302 (Gamma) = 4. Retours : 101, 105 (Alpha), 201 (Beta) = 3. Réactivés : 0.
  w.yassirSwitchTab('kool_clients');
  await wait(600);
  assert.equal(w.document.getElementById('koolCliKpiNouveaux').textContent, '4', 'Nouveaux clients W47');
  assert.equal(w.document.getElementById('koolCliKpiRetours').textContent, '3', 'Clients de retour W47');
  assert.equal(w.document.getElementById('koolCliKpiReactives').textContent, '0', 'Clients réactivés W47');
  assert.equal(w.document.getElementById('koolCliKpiTotal').textContent, '7', 'Total clients W47');
  const areaRows = [...w.document.querySelectorAll('#koolCliAreaTableBody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()));
  assert.deepEqual(areaRows[0].slice(0, 5), ['Tunis', '4', '2', '0', '6'], 'Tunis : 4 nouveaux, 2 retours, 6 clients');
  assert.deepEqual(areaRows[1].slice(0, 5), ['Ariana', '0', '1', '0', '1'], 'Ariana : 0 nouveau, 1 retour, 1 client');
  const acqTxt = w.document.getElementById('koolCliTopAcqBody').textContent;
  assert.ok(acqTxt.includes('Resto Alpha') && acqTxt.includes('Resto Gamma'), 'Top Acquisition : Alpha et Gamma');
  assert.ok(!acqTxt.includes('Resto Beta'), 'Top Acquisition : Beta (0 nouveau) absent');
  const retTxt = w.document.getElementById('koolCliTopRetBody').textContent;
  assert.ok(retTxt.includes('Resto Alpha') && retTxt.includes('Resto Beta'), 'Top Returning : Alpha et Beta');
  assert.ok(w.document.getElementById('koolCliTopReaBody').textContent.includes('Aucun'), 'Top Reactivated vide (aucun réactivé)');
  const cliCfg = chartWithLabels(['Nouveaux', 'Retours', 'Réactivés']);
  assert.ok(cliCfg, 'graphique clients par ville non créé');
  // (étaler aussi le résultat du .map : datasets est un tableau jsdom, son .map
  // renvoie un tableau jsdom — même piège de prototype que pour le graphique WoW.)
  assert.deepEqual([...cliCfg.data.datasets.map((d) => d.backgroundColor)], ['#FFD100', '#111111', '#9CA3AF'], 'couleurs du graphique clients');
  assert.ok(cliCfg.data.labels.includes('Tunis') && cliCfg.data.labels.includes('Ariana'), 'villes du graphique clients');
  assert.ok(w.document.getElementById('panelKoolClients').textContent.includes('60 jours'), 'seuil de réactivation (60 jours) affiché dans le panneau');

  // En mode Yassir, l'onglet Clients Kool disparaît (la vue est Kool uniquement).
  w.yassirSwitchBrand('yassir');
  await wait(600);
  assert.equal(w.document.getElementById('tabBtnKoolClients').classList.contains('hidden'), true, 'onglet Clients Kool visible en Yassir');

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
