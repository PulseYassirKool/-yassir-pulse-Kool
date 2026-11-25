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

function bootKool() {
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
    const match = (id) => id && u.includes(id);
    let body = null;
    if (match(kc.DATA_SHEET_ID)) body = koolCsvData;
    else if (match(kc.ORDER_ITEMS_SHEET_ID)) body = koolCsvItems;
    else if (match(kc.COMMISSION_SHEET_ID)) body = koolCsvComm;
    else if (match(kc.PORTFOLIOS_SHEET_ID)) body = koolCsvPort;
    else if (match(kc.OFFRE_PARTICIPATION_SHEET_ID)) body = koolCsvOffre;
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
