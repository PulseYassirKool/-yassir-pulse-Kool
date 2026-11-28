// Test d'intégration : vrai HTML + vrai code de l'application (jsdom) + vraie API (worker) branchée en mémoire.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { generateKeyPairSync } from 'node:crypto';
import { handle, hashPassword } from '../worker/src/index.js';
import { clearGoogleTokenCache } from '../worker/src/google-sheets.js';

const seed = existsSync('private/seed.json') ? JSON.parse(readFileSync('private/seed.json', 'utf8')) : { live: { PORTFOLIOS_SHEET_ID: 'SHEET_TEST_ID_000000000000000000000000000' }, kool: {}, commissions: { 'test resto': 20 }, portfolios: {} };
// Identifiants de classeurs simulés (format valide, jamais les vrais IDs) :
// le front ne les connaît plus (il appelle /api/sheets/:source), mais le
// Worker les lit dans la KV `config` — la config de test est donc complète
// et ne dépend plus de private/seed.json (absent en CI).
const UNIQUE = 'UNIQUE00000000000000000000000001';
const OCT = 'OCT000000000000000000000000000001';
const NOV = 'NOV000000000000000000000000000001';
const DATA_KOOL = 'KOOL0000000000000000000000000001';
const DETAILS = 'DET000000000000000000000000000001';
const koolCfg = {
  DATA_SHEET_ID: DATA_KOOL, DATA_GID: '0',
  COMMISSION_SHEET_ID: UNIQUE, COMMISSION_TAB: 'Commissions', COMMISSION_ALT_TABS: ['Commissions'], COMMISSION_GID: '9',
  PORTFOLIOS_SHEET_ID: UNIQUE, PORTFOLIOS_GID: '1',
  OFFRE_PARTICIPATION_SHEET_ID: UNIQUE, OFFRE_PARTICIPATION_GID: '10',
  ORDER_ITEMS_SHEET_ID: DETAILS, ORDER_ITEMS_GID: '0',
  BUDGET_SHEET_ID: UNIQUE, BUDGET_GID: '11',
  HISTORICAL_2025_SHEET_ID: UNIQUE, HISTORICAL_2025_GID: '14'
};
const testConfigBase = {
  live: {
    PORTFOLIOS_SHEET_ID: UNIQUE,
    PORTFOLIOS_TABS: [
      { tab: 'Omar Beldi', altTabs: [], gid: '1', am: 'Omar Beldi' },
      { tab: 'Nour Ali', altTabs: [], gid: '2', am: 'Nour Ali' }
    ],
    COMMISSIONS_SHEET_ID: UNIQUE, COMMISSIONS_TAB: 'Commissions', COMMISSIONS_GID: '9',
    BUDGET_SHEET_ID: UNIQUE, BUDGET_GID: '11', BUDGET_TAB: 'Budget',
    RESTO_STATUS_SHEET_ID: UNIQUE, RESTO_STATUS_GID: '12',
    OFFRE_PARTICIPATION_SHEET_ID: UNIQUE, OFFRE_PARTICIPATION_GID: '10',
    HISTORICAL_2025_SHEET_ID: UNIQUE, HISTORICAL_2025_GID: '13',
    HISTORICAL_MONTHS: [
      { label: 'Octobre (Google Sheets)', sheetId: OCT, gid: '0', tab: 'Data exp' },
      { label: 'Novembre (Google Sheets)', sheetId: NOV, gid: '0', tab: 'Data exp' }
    ]
  },
  kool: koolCfg
};
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
const kvMeta = new Map(); // clé -> { metadata, expirationTtl } (options du put)
const kv = {
  get: async (k, t) => (store.has(k) ? (t === 'json' ? JSON.parse(store.get(k)) : store.get(k)) : null),
  put: async (k, v, opts) => {
    store.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    if (opts) kvMeta.set(k, { metadata: opts.metadata, expirationTtl: opts.expirationTtl });
  },
  delete: async (k) => { store.delete(k); kvMeta.delete(k); },
  list: async ({ prefix = '', limit = 1000, cursor } = {}) => {
    const names = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
    let start = 0;
    if (cursor) { const i = names.indexOf(cursor); start = i === -1 ? names.length : i + 1; }
    const page = names.slice(start, start + limit);
    const done = start + page.length >= names.length;
    return {
      keys: page.map((name) => ({ name, metadata: kvMeta.get(name) ? kvMeta.get(name).metadata : undefined })),
      list_complete: done,
      cursor: done ? null : page[page.length - 1]
    };
  }
};
// Journal d'activité (I4 : une clé KV par événement) : vider le journal et
// le relire via le contrat HTTP GET /api/activity (compte proprio — la
// connexion proprio n'est jamais journalisée, donc la lecture ne pollue pas).
const clearJournal = () => {
  for (const k of [...store.keys()]) if (k.startsWith('activity:') || k === 'activity_log') store.delete(k);
  for (const k of [...kvMeta.keys()]) if (k.startsWith('activity:')) kvMeta.delete(k);
};
const journalEntries = async () => {
  const loginR = await handle(new Request('https://api.test/api/login', { method: 'POST', body: JSON.stringify({ username: 'proprio', password: 'Proprio-Test-123' }), headers: { Origin: 'http://localhost' } }), env);
  const token = (await loginR.json()).token;
  const r = await handle(new Request('https://api.test/api/activity', { headers: { Origin: 'http://localhost', Authorization: 'Bearer ' + token } }), env);
  return (await r.json()).entries || [];
};
// Compte de service simulé (clé RSA générée pour le test) : le Worker signe
// son JWT avec elle pour lire Google Sheets — ici, Google est simulé.
const { privateKey: testServiceKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const testServiceAccount = {
  type: 'service_account', project_id: 'projet-factures-483821',
  client_email: 'yassir-pulse@projet-factures-483821.iam.gserviceaccount.com',
  private_key: testServiceKey.export({ type: 'pkcs8', format: 'pem' })
};
const env = { PULSE_KV: kv, JWT_SECRET: 'j'.repeat(48), LEGACY_SALT: 's', ALLOWED_ORIGIN: 'http://localhost', GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify(testServiceAccount) };
store.set('accounts', JSON.stringify([
  { username: 'proprio', hash: await hashPassword('Proprio-Test-123'), role: 'owner', displayName: 'Propriétaire Admin', amName: null, protected: true },
  { username: 'omar.beldi', hash: await hashPassword('Omar-Test-12345'), role: 'am', displayName: 'Omar Beldi', amName: 'Omar Beldi', protected: true },
  { username: 'ahmed.marrouki', hash: await hashPassword('Ahmed-Test-12345'), role: 'viewer_all', displayName: 'Ahmed Marrouki', amName: null, protected: true }
]));
store.set('config', JSON.stringify(testConfigBase));
store.set('defaults', JSON.stringify({ commissions: seed.commissions, portfolios: seed.portfolios }));

const html = readFileSync('index.html', 'utf8').replace(/<script type="module"[^>]*><\/script>/, '').replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '');
const bundle = readFileSync('dist-test/app.js', 'utf8');
const sheetCalls = [];
const errors = [];

// ---- Google Sheets simulé (G3 suite) ----
// Le front n'appelle plus Google directement : c'est le Worker qui lit les
// feuilles (GET /api/sheets/:source) via le compte de service. Dans ce test,
// le fetch global (Node) est simulé : jeton OAuth + métadonnées + valeurs,
// avec les données des fixtures CSV du fichier (converties en lignes).
// buildGoogleMockData(overrides) reconstruit les classeurs simulés ;
// setGoogleMockTabs(id, tabs) ajoute/remplace les onglets d'un classeur ;
// googleFailTabs simule un onglet illisible (403 sur les valeurs).
const csvToRows = (csv) => {
  const rows = [];
  let row = [], cur = '', inQ = false;
  const s = String(csv || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') {
      if (inQ && s[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === ',' && !inQ) { row.push(cur); cur = ''; }
    else if ((ch === '\n' || (ch === '\r' && s[i + 1] === '\n')) && !inQ) {
      if (ch === '\r') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else if (ch !== '\r' || inQ) { cur += ch; }
  }
  row.push(cur);
  if (row.some((c) => String(c).trim() !== '')) rows.push(row);
  return rows;
};
let googleSheetsData = null;
const googleFailTabs = new Set();
// googleFailAllValues simule des feuilles toutes illisibles (403 sur les
// valeurs) : réplique l'ancien environnement de test où la lecture Google
// directe échouait, pour les tests qui prérèglent des données en
// localStorage et ne doivent pas les voir écrasées par la synchro auto.
let googleFailAllValues = false;
function buildGoogleMockData(overrides) {
  const ov = overrides || {};
  // Portefeuilles : un onglet par AM (données CSV « port » groupées par AM).
  const portTabs = {};
  const portRows = csvToRows(ov.port || koolCsvPort);
  const portHdr = portRows[0] || [];
  const idxAmPort = portHdr.findIndex((h) => String(h).trim().toLowerCase() === 'am');
  const byAm = {};
  for (let r = 1; r < portRows.length; r++) {
    const am = idxAmPort !== -1 ? String(portRows[r][idxAmPort] || '').trim() : '';
    if (!am) continue;
    if (!byAm[am]) byAm[am] = [portHdr];
    byAm[am].push(portRows[r]);
  }
  for (const am of Object.keys(byAm)) portTabs[am] = byAm[am];
  googleSheetsData = {
    [UNIQUE]: {
      ...portTabs,
      Commissions: csvToRows(ov.comm || koolCsvComm),
      'Offre Participation': csvToRows(ov.offre || koolCsvOffre),
      Budget: [
        ['AM', 'Budget', 'APP'],
        ['Omar Beldi', '100000', 'Yassir'],
        ['Eya Majdoub', '50000', 'Yassir'],
        ['Omar Beldi', '80000', 'Kool'],
        ['Global', '200000', 'Yassir']
      ],
      Statuts: [
        ['id', 'Restaurant Name', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10', 'Status'],
        ['1', 'Resto Yassir A', '', '', '', '', '', '', '', '', 'Active'],
        ['2', 'Resto Yassir B', '', '', '', '', '', '', '', '', 'Inactive'],
        ['3', 'Resto Alpha', '', '', '', '', '', '', '', '', 'Active']
      ],
      '2025 Yassir': [
        ['', 'W 45', 'W 46', 'W 47'],
        ['Requested', 100, 110, 120],
        ['Delivered Orders', 5, 6, 7],
        ['GMV (Total Food VF)', 100, 120, 140],
        ['CA YASSIR', 10, 12, 14]
      ],
      // 2025 Kool : pas de données par défaut (les tests existants supposent
      // « aucune donnée Kool 2025 ») ; seul un override explicite en fournit.
      '2025 Kool': ov.hist2025 ? csvToRows(ov.hist2025) : [['', 'W 45', 'W 46', 'W 47']],
      // Bogof Kool : en-têtes seuls par défaut (aucune règle) ; un override
      // explicite fournit les règles des tests Bogof.
      Bogof: ov.bogof ? csvToRows(ov.bogof) : [['Area', 'Restaurant', 'Responsable AM', 'C%', 'C% Globale', 'Article', 'Prix article', '2ème Article (prix)', 'Participation 2ème article', 'Spécificité', "Détails de l'offre", 'Start Date', 'End Date', 'Période']]
    },
    [OCT]: { 'Data exp': [TARGET_HEADERS_TEST.slice(), yassirRow('16/10/2026', 'YAF-1', 'Resto Yassir A', 100, 0, '', '')] },
    [NOV]: { 'Data exp': [TARGET_HEADERS_TEST.slice(), yassirRow('16/11/2026', 'YAF-2', 'Resto Yassir A', 60, 0, '', '')] },
    [DATA_KOOL]: { Data: csvToRows(ov.data || koolCsvData) },
    [DETAILS]: { Articles: csvToRows(ov.items || koolCsvItems) }
  };
  return googleSheetsData;
}
function setGoogleMockData(overrides) { return buildGoogleMockData(overrides); }
function setGoogleMockTabs(spreadsheetId, tabs) {
  if (!googleSheetsData) buildGoogleMockData(null);
  googleSheetsData[spreadsheetId] = { ...(googleSheetsData[spreadsheetId] || {}), ...tabs };
}
let googleMockInstalled = false;
function installGoogleMock() {
  if (!googleSheetsData) buildGoogleMockData(null);
  if (googleMockInstalled) return;
  googleMockInstalled = true;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com/token')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'ya29.test-token', expires_in: 3600, token_type: 'Bearer' }) };
    }
    if (u.includes('sheets.googleapis.com/v4/spreadsheets/')) {
      const m = u.match(/spreadsheets\/([A-Za-z0-9_-]+)(?:\/values\/([^?]+))?/);
      if (!m) throw new Error('URL Google inattendue : ' + u);
      const id = m[1];
      const tabs = googleSheetsData[id] || {};
      if (!m[2]) {
        const titles = Object.keys(tabs);
        return { ok: true, status: 200, json: async () => ({ sheets: titles.map((t, i) => ({ properties: { sheetId: i, title: t } })) }) };
      }
      const range = decodeURIComponent(m[2]);
      const rm = range.match(/^'((?:[^']|'')+)'!A(\d+):ZZ(\d+)$/);
      if (!rm) throw new Error('Plage inattendue : ' + range);
      const title = rm[1].replace(/''/g, "'");
      if (googleFailAllValues || googleFailTabs.has(title)) {
        return { ok: false, status: 403, json: async () => ({ error: { code: 403, message: 'Forbidden' } }) };
      }
      const rows = tabs[title] || [];
      const slice = rows.slice(Number(rm[2]) - 1, Number(rm[3]));
      return { ok: true, status: 200, json: async () => ({ range, majorDimension: 'ROWS', values: slice }) };
    }
    return realFetch(u, opts);
  };
}
// Le cache feuilles du Worker (KV, sans expiration dans ce test) doit être
// vidé entre deux boots, sinon un test lirait les données du précédent.
const clearSheetCache = () => {
  for (const k of [...store.keys()]) if (k.startsWith('sheetcache:')) store.delete(k);
  clearGoogleTokenCache();
};


function boot() {
  clearSheetCache();
  googleFailTabs.clear();
  googleFailAllValues = false;
  buildGoogleMockData(null);
  installGoogleMock();
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.__PULSE_API__ = 'https://api.test';
  w.__sheetApiCalls = [];
  w.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.startsWith('https://api.test')) {
      if (u.includes('/api/sheets/')) w.__sheetApiCalls.push(u);
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

// Attend une condition durable (plutôt qu'un délai fixe) : la synchro par
// tranches (intervalle 1,5 s) rend les délais fixes fragiles — la donnée
// n'est pas forcément là après 600/1200 ms.
const waitFor = async (fn, timeoutMs = 20000, stepMs = 200) => {
  const start = Date.now();
  for (;;) {
    if (fn()) return;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor : condition jamais atteinte après ' + timeoutMs + ' ms');
    await wait(stepMs);
  }
};
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

test('connexion AM : app déverrouillée, rôle venant du serveur, synchro via /api/sheets (aucun appel Google direct)', async () => {
  const w = boot();
  await login(w, 'omar.beldi', 'Omar-Test-12345');
  assert.equal(w.document.getElementById('appWrapper').classList.contains('hidden'), false);
  assert.equal(w.document.getElementById('headerUserBadge').textContent, 'Omar Beldi');
  // La synchro automatique (à la connexion) lit les feuilles via le Worker :
  // des appels /api/sheets/:source ont eu lieu, et le front n'a jamais
  // appelé docs.google.com directement (ni CSV, ni gviz, ni XLSX).
  await wait(800);
  assert.ok(w.__sheetApiCalls.some((u) => u.includes('/api/sheets/portfolios')), 'aucun appel /api/sheets/portfolios : ' + JSON.stringify(w.__sheetApiCalls));
  assert.ok(w.__sheetApiCalls.some((u) => u.includes('/api/sheets/commissions')), 'aucun appel /api/sheets/commissions');
  assert.ok(!sheetCalls.some((u) => u.includes('docs.google.com')), 'le front appelle encore Google directement : ' + JSON.stringify(sheetCalls));
  assert.ok(!w.__sheetApiCalls.some((u) => u.includes('fresh=1')), 'la synchro automatique ne doit jamais passer fresh=1');
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
  assert.equal(w.document.getElementById('accountsTableBody').innerHTML.includes('pbkdf2$'), false, 'hash exposé dans la liste des comptes');
  // Étiquette exacte (audit 2026-11-27, item 8) : PBKDF2, pas SHA-256.
  assert.ok(w.document.getElementById('accountsTableBody').textContent.includes('PBKDF2'), 'étiquette PBKDF2 absente');
  assert.ok(!w.document.getElementById('accountsTableBody').textContent.includes('SHA-256'), 'ancienne étiquette SHA-256 toujours présente');
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
  // Le Burger est dans la catégorie « Super Promo » : c'est la correspondance EXACTE
  // (audit 2026-11-27, item 5a) qui le rattache à la règle article « Super Promo » —
  // l'ancien repli sur la première règle est supprimé.
  ['1002', '17/11/2026', 'Resto Alpha', 'Super Promo', 'Burger Classic', 1, 15, 12, 15, 'Food'],
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
  clearSheetCache();
  googleFailTabs.clear();
  googleFailAllValues = false;
  // Les overrides alimentent le mock Google (le Worker lit les feuilles) :
  // plus aucun CSV servi directement au front.
  buildGoogleMockData(overrides || null);
  installGoogleMock();
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.__PULSE_API__ = 'https://api.test';
  w.__sheetApiCalls = [];
  w.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.startsWith('https://api.test')) {
      if (u.includes('/api/sheets/')) w.__sheetApiCalls.push(u);
      const r = await handle(new Request(u, { method: opts.method || 'GET', body: opts.body, headers: { Origin: 'http://localhost', ...(opts.headers || {}) } }), env);
      return { ok: r.ok, status: r.status, json: () => r.json(), text: () => r.text() };
    }
    sheetCalls.push(u);
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

  // Remises non attribuées (audit 2026-11-27, item 5a) : 1003 (Resto Beta, sans règle)
  // a 3 Tacos remisés (9 → 8 × 3 = 3.00 TND) — visibles dans le bandeau, jamais
  // rattachés à une règle, jamais dans les parts resto/plateforme.
  const unattrBanner = w.document.getElementById('partUnattributedBanner');
  assert.equal(unattrBanner.classList.contains('hidden'), false, 'bandeau « non attribué » masqué en vue article');
  assert.ok(unattrBanner.textContent.includes('3.00 TND'), 'montant non attribué incorrect : ' + unattrBanner.textContent);
  assert.ok(unattrBanner.textContent.includes('3 article'), 'nombre d’articles non attribués incorrect : ' + unattrBanner.textContent);
  // En vue « Toute la carte », le bandeau est masqué (les non attribués ne sont suivis qu'en vue article).
  w.yassirSetParticipationView('carte');
  assert.equal(w.document.getElementById('partUnattributedBanner').classList.contains('hidden'), true, 'bandeau « non attribué » visible en vue carte');

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

// ---- Bogof Kool (onglet « Bogof », 2026-11-28) ----
// RÈGLE 1 : la participation est prise TELLE QUELLE depuis « Participation
// 2ème article » (DT), jamais calculée ni dérivée. RÈGLE 2 : la date vient
// de la ligne détail (Catégorie « Buy 1 Get 1 Free »), jamais de la feuille
// Bogof (les dates de la feuille sont ignorées — ici absentes).
// Split (interprétation à confirmer par l'utilisateur) : plateforme =
// participation, restaurant = remise − participation.
// 1008 (Alpha, Pizza Polo, 2ème article 12, participation 6) : remise 12,
// plateforme 6, resto 6. 1009 (Alpha, Sandwich A76, 2ème article 9,
// participation 2,5 — PAS la moitié calculée, la valeur telle quelle) :
// remise 9, plateforme 2,50, resto 6,50. 1010 (Beta, Pizza Polo, 2ème
// article 12, participation 4 — autre restaurant, autre règle) : remise 12,
// plateforme 4, resto 8. Totaux vue article : 3 / 33.00 / 20.50 / 12.50.
// La règle « Super Promo » d'Alpha ne doit PAS s'appliquer aux lignes BOGOF
// (catégorie différente, pas de Pack/BOGOF dans le libellé).
const koolCsvDataBogof = toCsv([
  ['Annulé', '', 'Raison annulation', 'Date', 'N° commande', '', 'Restaurant', '', '', 'Montant HT', 'Frais livraison', 'Remise'],
  ['', '', '', '17/11/2026', '1008', '', 'Resto Alpha', '', '', '12.00', '3', '12'],
  ['', '', '', '17/11/2026', '1009', '', 'Resto Alpha', '', '', '9.00', '3', '9'],
  ['', '', '', '17/11/2026', '1010', '', 'Resto Beta', '', '', '12.00', '3', '12']
]);
const koolCsvItemsBogof = toCsv([
  ['Order ID', 'Date', 'Restaurant', 'Category', 'Article', 'Quantity', 'Unit Price', 'Discount Price', 'Original Price', 'Type'],
  ['1008', '17/11/2026', 'Resto Alpha', 'Buy 1 Get 1 Free', 'Pizza Polo', 1, 12, 0, 12, 'Food'],
  ['1009', '17/11/2026', 'Resto Alpha', 'Buy 1 Get 1 Free', 'Sandwich A76', 1, 9, 0, 9, 'Food'],
  ['1010', '17/11/2026', 'Resto Beta', 'Buy 1 Get 1 Free', 'Pizza Polo', 1, 12, 0, 12, 'Food']
]);
const koolCsvOffreBogof = toCsv([
  ['Restaurant', 'Participation', 'Tag', 'Période'],
  ['Resto Alpha', '10', 'Super Promo', '01/11/2026 - 30/11/2026']
]);
const koolCsvBogof = toCsv([
  ['Area', 'Restaurant', 'Responsable AM', 'C%', 'C% Globale', 'Article', 'Prix article', '2ème Article (prix)', 'Participation 2ème article', 'Spécificité', "Détails de l'offre", 'Start Date', 'End Date', 'Période'],
  ['Tunis', 'Resto Alpha', 'Omar Beldi', '20', '', 'Pizza Polo', '25', '12', '6', '', 'Buy 1 Get 1 Free', '', '', ''],
  ['Tunis', 'Resto Alpha', 'Omar Beldi', '20', '', 'Sandwich A76', '14,5', '9', '2,5', '', 'Buy 1 Get 1 Free', '', '', ''],
  ['Ariana', 'Resto Beta', 'Nour Ali', '20', '', 'Pizza Polo', '25', '12', '4', '', 'Buy 1 Get 1 Free', '', '', '']
]);

test('Kool : Bogof — participation telle quelle depuis la feuille Bogof (vue Par article)', async () => {
  const w = bootKool({ data: koolCsvDataBogof, items: koolCsvItemsBogof, offre: koolCsvOffreBogof, bogof: koolCsvBogof });
  await login(w, 'proprio', 'Proprio-Test-123');
  await w.yassirSyncKoolSheets(true);
  w.yassirSwitchBrand('kool');
  await wait(600);
  w.yassirApplyDatePreset('ALL');
  await wait(600);

  // La synchro Kool a chargé les 3 règles Bogof (onglet « Bogof »).
  assert.equal(w.yassirGetBogofRules().length, 3, 'règles Bogof chargées');
  assert.equal(w.yassirGetBogofRules()[0].participation2eme, 6, 'participation telle quelle (6 DT, pas un %)');
  assert.equal(w.yassirGetBogofRules()[1].participation2eme, 2.5, 'participation 2,5 telle quelle (pas la moitié de 9)');

  // Carte GMV : item total des livrées = 24 + 18 + 24 = 66,00 TND.
  assert.equal(w.document.getElementById('kpiGmvLivrees').textContent, '66,00 TND', 'GMV Kool Bogof');

  // Vue « Par article » : 3 offres / remise 33.00 / resto 20.50 / plateforme 12.50.
  w.yassirSwitchTab('participation');
  await wait(600);
  w.yassirSetParticipationView('article');
  assert.equal(w.document.getElementById('partKpiOffres').textContent, '3', 'Total Offres Bogof (article)');
  assert.equal(w.document.getElementById('partKpiRemise').textContent, '33.00 TND', 'Remise Bogof (article)');
  assert.equal(w.document.getElementById('partKpiResto').textContent, '20.50 TND', 'Participation restaurant Bogof (article)');
  assert.equal(w.document.getElementById('partKpiPlateforme').textContent, '12.50 TND', 'Participation plateforme Bogof (article)');
  const bodyTxt = w.document.getElementById('partTableBody').textContent;
  assert.ok(bodyTxt.includes('Resto Alpha'), 'Resto Alpha absent en vue article Bogof');
  assert.ok(bodyTxt.includes('Resto Beta'), 'Resto Beta absent en vue article Bogof');
  // KPI budget « Participation Offres » (coût restaurant) : 6 + 6,50 + 8 = 20,50.
  assert.equal(w.yassirCalculerCoutParticipationOffresLivrees(w.yassirGetDeliveredRecords()), 20.5, 'KPI Participation Offres Bogof (coût restaurant)');

  // Vue « Toute la carte » : aucune règle carte pour Alpha/Beta → 0 offre.
  // Le Bogof ne doit PAS fuiter dans la vue carte.
  w.yassirSetParticipationView('carte');
  assert.equal(w.document.getElementById('partKpiOffres').textContent, '0', 'Total Offres Bogof (carte — doit être 0)');
  assert.equal(w.document.getElementById('partKpiRemise').textContent, '0.00 TND', 'Remise Bogof (carte — doit être 0)');

  assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
});

// ---- Correctif 1 (diagnostic 2026-11-27) : partPct Kool lu 100 fois trop petit ----
// La feuille « Offre Participation » écrit la participation « 0,1 » (= 10 %) ;
// la synchro Kool lit la feuille en CSV (chaînes) et parsePercentNumber ne
// multipliait par 100 que les NOMBRES entre 0 et 1, pas les chaînes.
// W47 réel ramené à une commande : brut 37 076,50, remise 31 017,42, règle
// partPct « 0,1 » (CSV) = 10 points. Avant le correctif : plateforme 37,08
// (0,1 % du brut), restaurant 30 980,34. Après : 3 707,65 / 27 309,77.
const koolCsvDataW47 = toCsv([
  ['Annulé', '', 'Raison annulation', 'Date', 'N° commande', '', 'Restaurant', '', '', 'Montant HT', 'Frais livraison', 'Remise'],
  ['', '', '', '20/11/2026', '2001', '', 'Resto W47', '', '', '6059.08', '0', '31017.42']
]);
const koolCsvItemsW47 = toCsv([
  ['Order ID', 'Date', 'Restaurant', 'Category', 'Article', 'Quantity', 'Unit Price', 'Discount Price', 'Original Price', 'Type'],
  ['2001', '20/11/2026', 'Resto W47', 'Food', 'Menu W47', 1, 37076.50, 6059.08, 37076.50, 'Food']
]);
const koolCsvOffreW47 = toCsv([
  ['Restaurant', 'Participation', 'Tag', 'Période'],
  ['Resto W47', '0,1', 'Toute la carte', '01/11/2026 - 30/11/2026']
]);

test('partPct CSV : "0,1" vaut 10 points, "0,238" vaut 23,8 (bug ×100 Kool)', () => {
  const w = boot();
  const p = w.yassirParsePercentNumber;
  assert.ok(typeof p === 'function', 'yassirParsePercentNumber non exposé');
  // Chaînes CSV (synchro Kool) : la feuille écrit 0,1 pour 10 %.
  assert.equal(p('0,1'), 10, '"0,1" doit valoir 10 points');
  assert.equal(p('0,238'), 23.8, '"0,238" doit valoir 23,8 points');
  assert.equal(p('0'), 0, '"0" doit valoir 0');
  assert.equal(p('10'), 10, '"10" inchangé');
  assert.equal(p('10%'), 10, '"10%" inchangé');
  assert.equal(p('23,8'), 23.8, '"23,8" inchangé');
  assert.equal(p(''), 0, 'chaîne vide = 0');
  assert.equal(p('abc'), 0, 'non numérique = 0');
  // Nombres (XLSX Yassir) : comportement inchangé.
  assert.equal(p(0.1), 10, '0.1 (nombre) = 10');
  assert.equal(p(0.238), 23.8, '0.238 (nombre) = 23,8');
  assert.equal(p(10), 10, '10 (nombre) inchangé');
  assert.equal(p(0), 0, '0 (nombre) = 0');
  // Par la feuille : des lignes « Offre Participation » en CSV.
  const rules = w.yassirParseOffreParticipationRows([
    ['Restaurant', 'Participation', 'Tag', 'Période'],
    ['Resto Alpha', '0,1', 'Toute la carte', '01/11/2026 - 30/11/2026'],
    ['Resto Beta', '0,238', 'Toute la carte', '01/11/2026 - 30/11/2026'],
    ['Resto Gamma', '0', 'Toute la carte', '01/11/2026 - 30/11/2026']
  ], 'Kool');
  assert.equal(rules.length, 3, '3 règles lues');
  assert.equal(rules[0].partPct, 10, 'Alpha partPct 10');
  assert.equal(rules[1].partPct, 23.8, 'Beta partPct 23,8');
  assert.equal(rules[2].partPct, 0, 'Gamma partPct 0');
  assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
});

// ---- Correctif 4a : parseCommissionRows — même motif ×100 que partPct ----
// La feuille Commissions écrit « 0,238 » (= 23,8 %) ; la synchro Kool lit
// la feuille en CSV (chaînes) et seuls les NOMBRES entre 0 et 1 étaient
// multipliés par 100 — « 0,238 » était lu 0,238 point au lieu de 23,8.
test('Commissions CSV : "0,238" vaut 23,8 (même motif ×100 que partPct)', () => {
  const w = boot();
  const p = w.yassirParseCommissionRows;
  assert.ok(typeof p === 'function', 'yassirParseCommissionRows non exposé');
  // Chaînes CSV (synchro Kool) : « 0,238 » = 23,8 %, « 0,1 » = 10 %.
  const rowsKool = p([
    ['Restaurant', 'Commission', 'APP'],
    ['Resto Alpha', '0,238', 'Kool'],
    ['Resto Beta', '0,1', 'Kool'],
    ['Resto Gamma', '23,8', 'Kool'],
    ['Resto Delta', '0', 'Kool'],
    ['Resto Epsilon', '25', 'Kool'],
    ['Resto Zeta', '20%', 'Kool']
  ], 'Kool');
  assert.equal(rowsKool.count, 5, '5 taux lus (le taux 0 est exclu)');
  assert.equal(rowsKool.map['resto alpha'], 23.8, '"0,238" doit valoir 23,8');
  assert.equal(rowsKool.map['resto beta'], 10, '"0,1" doit valoir 10');
  assert.equal(rowsKool.map['resto gamma'], 23.8, '"23,8" inchangé');
  assert.equal(rowsKool.map['resto epsilon'], 25, '"25" inchangé');
  assert.equal(rowsKool.map['resto zeta'], 20, '"20%" inchangé');
  assert.equal(rowsKool.map['resto delta'], undefined, 'taux 0 exclu');
  // Nombres (XLSX Yassir) : comportement inchangé.
  const rowsYassir = p([
    ['Restaurant', 'Commission', 'APP'],
    ['Resto Alpha', 0.238, 'Yassir'],
    ['Resto Beta', 23.8, 'Yassir']
  ], 'Yassir');
  assert.equal(rowsYassir.count, 2, '2 taux Yassir');
  assert.equal(rowsYassir.map['resto alpha'], 23.8, '0.238 (nombre) = 23,8');
  assert.equal(rowsYassir.map['resto beta'], 23.8, '23.8 (nombre) inchangé');
  // « 17,017 » reste 17.017 : une seule virgule suivie de 3 chiffres est
  // une décimale dans les vraies feuilles (45 taux), pas 17 017.
  const rowsM = p([['Restaurant', 'Commission', 'APP'], ['Resto M', '17,017', 'Yassir']], 'Yassir');
  assert.equal(rowsM.map['resto m'], 17.017, '"17,017" doit valoir 17.017');
  assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
});

test('Kool : partPct CSV "0,1" — chiffres W47 reproduits (plateforme 3 707,65, restaurant 27 309,77)', async () => {
  const w = bootKool({ data: koolCsvDataW47, items: koolCsvItemsW47, offre: koolCsvOffreW47 });
  await login(w, 'proprio', 'Proprio-Test-123');
  await w.yassirSyncKoolSheets(true);
  w.yassirSwitchBrand('kool');
  await wait(600);
  w.yassirApplyDatePreset('ALL');
  await wait(600);

  // Vue « Toute la carte » : brut 37 076,50, remise 31 017,42, règle 10 points.
  // Plateforme = min(10 % × 37 076,50 ; 31 017,42) = 3 707,65 ; restaurant = 27 309,77.
  w.yassirSwitchTab('participation');
  await wait(600);
  assert.equal(w.document.getElementById('partKpiOffres').textContent, '1', 'Total Offres W47');
  assert.equal(w.document.getElementById('partKpiRemise').textContent, '31017.42 TND', 'Remise totale W47');
  assert.equal(w.document.getElementById('partKpiPlateforme').textContent, '3707.65 TND', 'Plateforme W47 (10 % du brut, pas 0,1 %)');
  assert.equal(w.document.getElementById('partKpiResto').textContent, '27309.77 TND', 'Restaurant W47');
  // KPI budget « Participation Offres » (coût restaurant) : même montant.
  assert.equal(w.yassirCalculerCoutParticipationOffresLivrees(w.yassirGetDeliveredRecords()), 27309.77, 'KPI budget W47 (coût restaurant)');
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
  // La synchro auto à la connexion charge les lignes mock par tranches
  // (intervalle 1,5 s). Le GMV est filtré par la période courante : la
  // synchro applique la semaine par défaut S47, qui exclut YAF-1 (octobre).
  // On attend la semaine S47 (synchro terminée), puis on passe en période
  // « Tout » pour compter toutes les livrées, et on attend le GMV complet.
  // (Avant, l'assertion passait par une course : elle tombait avant que la
  // semaine S47 ne soit appliquée.)
  await waitFor(() => w.document.getElementById('filterWeekSelect').value.endsWith('|S47'));
  w.yassirApplyDatePreset('ALL');
  await waitFor(() => w.document.getElementById('kpiGmvLivrees').textContent === '490,00 TND');

  // Carte GMV (Export Offres, 2026-11-28) : GMV livrées = somme « item total »
  // (100 + 50 + 80 + 60 + 40 = 330 pour le fichier importé) + 160 des lignes
  // mock YAF-1 (100) et YAF-2 (60) chargées par la synchro auto à la connexion
  // — le GMV compte toutes les livrées, pas seulement les offres (YAF-1/YAF-2
  // n'ont ni remise ni Discount Type, donc la Participation ne les compte pas).
  assert.equal(w.document.getElementById('kpiGmvLivrees').textContent, '490,00 TND', 'GMV Yassir (item total livrées)');

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
// Dates décalées : ces données ont été écrites le 26/11/2026, avec une
// dernière donnée le 22/11 (donc « 4 jours » d'ancienneté). Sans décalage,
// l'alerte « données anciennes » affiche 5 jours le 27/11, 6 le 28/11…
// et le test casse dès minuit. Le décalage garde la position relative
// exacte (dernière donnée = aujourd'hui − 4 jours, fin d'offre =
// aujourd'hui − 3 jours) ; toutes les dates du test sont décalées ensemble.
const _notifDecalageJours = Math.max(0, Math.floor((Date.now() - new Date(2026, 10, 26).getTime()) / 86400000));
const _notifDate = (s) => {
  const [jj, mm, aaaa] = s.split('/').map(Number);
  const d = new Date(aaaa, mm - 1, jj + _notifDecalageJours);
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
};
const notifDataRows = [notifHeader];
{
  let oid = 5000;
  const addDeliv = (date, resto, n) => { for (let i = 0; i < n; i++) notifDataRows.push(notifRow(_notifDate(date), String(++oid), resto, '20.00', '3', '0')); };
  ['16/11/2026', '17/11/2026', '18/11/2026', '19/11/2026', '20/11/2026', '21/11/2026', '22/11/2026'].forEach((d) => addDeliv(d, 'Resto Alpha', 1));
  addDeliv('16/11/2026', 'Resto Beta', 1);
  addDeliv('17/11/2026', 'Resto Beta', 1);
  addDeliv('20/11/2026', 'Resto Gamma', 5);
  addDeliv('21/11/2026', 'Resto Gamma', 3);
  addDeliv('22/11/2026', 'Resto Gamma', 1);
  ['16/11/2026', '17/11/2026', '18/11/2026', '19/11/2026', '20/11/2026', '21/11/2026', '22/11/2026'].forEach((d) => addDeliv(d, 'Resto Delta', 1));
  ['18/11/2026', '19/11/2026', '20/11/2026'].forEach((d) => notifDataRows.push(notifRow(_notifDate(d), String(++oid), 'Resto Delta', '20.00', '3', '0', 'oui', 'Client absent')));
}
const notifCsvComm = toCsv([['Restaurant', 'Commission'], ['Resto Alpha', '20'], ['Resto Beta', '15'], ['Resto Gamma', '20'], ['Resto Delta', '20']]);
const notifCsvPort = toCsv([['Restaurant', 'Ville', 'AM'], ['Resto Alpha', 'Tunis', 'Omar Beldi'], ['Resto Beta', 'Ariana', 'Nour Ali'], ['Resto Gamma', 'Tunis', 'Omar Beldi'], ['Resto Delta', 'Sfax', 'Omar Beldi']]);
const notifCsvOffre = toCsv([['Restaurant', 'Participation', 'Tag', 'Période'], ['Resto Alpha', '10', 'Toute la carte', _notifDate('01/11/2026') + ' - ' + _notifDate('23/11/2026')]]);

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
  // Les clics passent par l'écouteur délégué (data-action) : un vrai clic
  // jsdom le déclenche, contrairement aux anciens onclick inline.
  const betaCard = groupCards().find((d) => d.textContent.includes('Resto Beta'));
  const traiteBtn = [...betaCard.querySelectorAll('button')].find((b) => b.textContent.includes('Traité'));
  assert.ok(traiteBtn, 'bouton Traité de Beta absent');
  assert.equal(traiteBtn.getAttribute('data-action'), 'treat-alert', 'câblage Traité de Beta incorrect');
  assert.equal(traiteBtn.getAttribute('data-key'), 'kool|ZERO_3D|resto beta|Nour Ali', 'clé Traité de Beta incorrecte');
  traiteBtn.click();
  assert.equal(bell(), '4', 'cloche : 4 après avoir traité Beta');
  assert.ok(!listTxt().includes('Resto Beta'), 'Beta disparaît de la liste');
  // L'alerte traitée ne réapparaît pas au recalcul (la situation existe toujours).
  w.yassirRecalculerNotifications();
  assert.equal(bell(), '4', 'cloche : toujours 4 après recalcul (Beta reste traitée)');

  // Clic sur la carte Gamma : onglet Analyse Restaurant, Gamma sélectionné.
  const gammaCard = groupCards().find((d) => d.textContent.includes('Resto Gamma'));
  const gammaItem = gammaCard.querySelector('[data-action="open-alert"]');
  assert.ok(gammaItem, 'carte Gamma sans câblage de navigation');
  assert.equal(gammaItem.getAttribute('data-key'), 'resto gamma', 'clé clic Gamma incorrecte');
  assert.equal(gammaItem.getAttribute('data-type'), 'DROP_3D', 'type clic Gamma incorrect');
  gammaItem.click();
  await wait(400);
  assert.equal(w.document.getElementById('panelRestoAnalytics').classList.contains('hidden'), false, 'clic Gamma : onglet Analyse Restaurant');
  assert.equal(w.document.getElementById('selectRestoAnalytics').value, 'resto gamma', 'clic Gamma : restaurant sélectionné');

  // Clic sur la carte Alpha (fin d'offre) : section Participation.
  w.yassirSetNotifCategoryFilter('ALL');
  const alphaCard = groupCards().find((d) => d.textContent.includes('Resto Alpha'));
  const alphaItem = alphaCard.querySelector('[data-action="open-alert"]');
  assert.ok(alphaItem, 'carte Alpha sans câblage de navigation');
  assert.equal(alphaItem.getAttribute('data-key'), 'resto alpha', 'clé clic Alpha incorrecte');
  assert.equal(alphaItem.getAttribute('data-type'), 'OFFER_END', 'type clic Alpha incorrect');
  alphaItem.click();
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
  clearSheetCache();
  googleFailTabs.clear();
  googleFailAllValues = false;
  installGoogleMock();
  // La feuille Budget simulée est rendue illisible : le budget préréglé en
  // localStorage doit survivre à la synchro automatique (ancien comportement :
  // la lecture Google directe échouait en test, la synchro ne touchait pas
  // au budget local).
  googleFailTabs.add('Budget');
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

// ---- Carte profil du menu latéral : budget jamais négatif ----
// Bug signalé (capture Ahmed Marrouki, 27/11/2026) : Budget AM 0.00 TND,
// Reste Budget -99 915,79 TND — des dépenses réelles comparées à un budget
// absent (synchro Budget non chargée, ou AM sans ligne dans la feuille).
// Règle : budget du périmètre connu -> périmètre tel quel ; sinon, pour un
// compte qui voit tout (proprio / lecture), budget global face aux dépenses
// globales ; sinon « — », jamais 0 ni un reste négatif.
test('Carte profil : budget global pour un compte sans budget personnel, « — » si aucun budget', async () => {
  // Dates relatives (jamais de date absolue figée : la CI casse sinon).
  const fmtFR = (d) => String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
  const ilYAJours = (n) => fmtFR(new Date(Date.now() - n * 86400000));

  const build = async (budgetStore, user, pwd, rowsSpec) => {
    clearSheetCache();
    installGoogleMock();
    // Comme bootYassirWithBudget : toutes les feuilles simulées sont
    // illisibles — les données préréglées en localStorage (budgets, règles
    // Offre, portefeuilles) survivent à la synchro automatique, comme avant
    // la migration quand la lecture Google directe échouait en test.
    googleFailAllValues = true;
    const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window;
    w.__PULSE_API__ = 'https://api.test';
    w.localStorage.setItem('yassir_vf_budget_v1', JSON.stringify(budgetStore));
    // Au moins une règle Offre Participation : sans aucune règle, le coût de
    // participation des livrées vaut 0 (comportement existant) ; les remises
    // sans règle sont alors comptées à 100 % restaurant (règle Yassir).
    w.localStorage.setItem('yassir_vf_offre_participation_v1', JSON.stringify([
      { area: '', restaurant: 'resto test omar', restaurantNorm: 'resto test omar', cPct: 10, tag: 'Toute la carte', am: 'Omar Beldi', partPct: 10, details: '', startDate: '', endDate: '', periode: '' }
    ]));
    w.localStorage.setItem('yassir_vf_am_portfolios_v9', JSON.stringify({
      'resto test omar': { am: 'Omar Beldi', displayName: 'Resto Test Omar', ville: 'Tunis', segment: 'Top Performer' },
      'resto test nour': { am: 'Nour Ali', displayName: 'Resto Test Nour', ville: 'Tunis', segment: 'Top Performer' },
      'resto test eya': { am: 'Eya Majdoub', displayName: 'Resto Test Eya', ville: 'Tunis', segment: 'Top Performer' }
    }));
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
    await login(w, user, pwd);
    const makeXlsxFile = (aoa, sheetName, fileName) => {
      const wb = w.XLSX.utils.book_new();
      w.XLSX.utils.book_append_sheet(wb, w.XLSX.utils.aoa_to_sheet(aoa), sheetName);
      const buf = w.XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      return new w.File([buf], fileName, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    };
    const idxOrigDeliv = TARGET_HEADERS_TEST.indexOf('original delivery amount');
    const idxDeliv = TARGET_HEADERS_TEST.indexOf('delivery amount');
    const idxAmtRest = TARGET_HEADERS_TEST.indexOf('amount to restaurant');
    const dataAoa = [TARGET_HEADERS_TEST.slice()];
    rowsSpec.forEach((spec, i) => {
      const r = yassirRow(ilYAJours(spec.jours), 'YAF-90' + (10 + i), spec.resto, spec.itemTot, spec.remise, '', '');
      r[idxOrigDeliv] = spec.origDeliv; r[idxDeliv] = spec.deliv; r[idxAmtRest] = spec.itemTot;
      dataAoa.push(r);
    });
    const dataFile = makeXlsxFile(dataAoa, 'Data exp', 'data-exp.xlsx');
    w.yassirOnMainFileChange({ target: { files: [dataFile], value: 'x' } });
    await wait(1200);
    return w;
  };
  const cardTxt = (w, id) => w.document.getElementById(id).textContent;
  // Dépenses simulées : Omar LR&LG 15 + offres 0 = 15 ; Nour 0 + 5 = 5 ;
  // Eya 0 + 20 = 20 ; global LR&LG 15, offres 25, total 40.
  const rowsStd = [
    { jours: 3, resto: 'Resto Test Omar', itemTot: 100, remise: 0, origDeliv: 20, deliv: 5 },
    { jours: 3, resto: 'Resto Test Nour', itemTot: 50, remise: 5, origDeliv: 10, deliv: 10 },
    { jours: 2, resto: 'Resto Test Eya', itemTot: 200, remise: 20, origDeliv: 0, deliv: 0 }
  ];
  const budgets = { byAm: { 'Omar Beldi': 1000, 'Nour Ali': 500 }, global: 1500 };

  // (a) Lecture seule, filtre sur Eya (sans ligne de budget) -> budget global.
  const wA = await build(budgets, 'ahmed.marrouki', 'Ahmed-Test-12345', rowsStd);
  wA.yassirSelectAmFilter('Eya Majdoub');
  assert.equal(wA.document.getElementById('lmdProfileBudgetCard').classList.contains('hidden'), false, 'carte cachée (a)');
  assert.equal(cardTxt(wA, 'profileBudgetLabel'), 'Budget global :', 'libellé (a)');
  assert.equal(cardTxt(wA, 'profileBudgetTnd'), '1500.00 TND', 'budget global (a)');
  assert.equal(cardTxt(wA, 'profileLrLgTnd'), '15.00 TND (1.0%)', 'LR&LG global (a)');
  assert.equal(cardTxt(wA, 'profileOfferPartTnd'), '25.00 TND (1.7%)', 'offres global (a)');
  assert.equal(cardTxt(wA, 'profileLrLgVsBudgetAmPct'), '2.7%', '% global (a)');
  assert.equal(cardTxt(wA, 'profileRemainingBudgetTnd'), '1460.00 TND', 'reste global (a)');

  // (b) AM avec sa propre ligne de budget -> son budget, comportement inchangé.
  const wB = await build(budgets, 'omar.beldi', 'Omar-Test-12345', rowsStd);
  assert.equal(wB.document.getElementById('lmdProfileBudgetCard').classList.contains('hidden'), false, 'carte cachée (b)');
  assert.equal(cardTxt(wB, 'profileBudgetLabel'), 'Budget AM :', 'libellé (b)');
  assert.equal(cardTxt(wB, 'profileBudgetTnd'), '1000.00 TND', 'budget Omar (b)');
  assert.equal(cardTxt(wB, 'profileLrLgTnd'), '15.00 TND (1.5%)', 'LR&LG Omar (b)');
  assert.equal(cardTxt(wB, 'profileOfferPartTnd'), '0.00 TND (0.0%)', 'offres Omar (b)');
  assert.equal(cardTxt(wB, 'profileLrLgVsBudgetAmPct'), '1.5%', '% Omar (b)');
  assert.equal(cardTxt(wB, 'profileRemainingBudgetTnd'), '985.00 TND', 'reste Omar (b)');

  // (c) Aucun budget chargé -> « — » partout, jamais de reste négatif.
  const wC = await build({ byAm: {}, global: 0 }, 'ahmed.marrouki', 'Ahmed-Test-12345', rowsStd);
  wC.yassirSelectAmFilter('Omar Beldi');
  assert.equal(cardTxt(wC, 'profileBudgetTnd'), '—', 'budget « — » (c)');
  assert.equal(cardTxt(wC, 'profileLrLgVsBudgetAmPct'), '—', '% « — » (c)');
  assert.equal(cardTxt(wC, 'profileRemainingBudgetTnd'), '—', 'reste « — » (c)');
  assert.equal(cardTxt(wC, 'profileLrLgTnd'), '15.00 TND', 'LR&LG sans % (c)');
  assert.ok(!wC.document.getElementById('lmdProfileBudgetCard').textContent.includes('-'), 'signe négatif présent (c)');

  // (c2) Cas exact de la capture : dépenses 57 278,79 + 42 637,00, budget 0
  // -> plus jamais -99 915,79. (Resto sans règle : remise à 100 % restaurant.)
  const wD = await build({ byAm: {}, global: 0 }, 'ahmed.marrouki', 'Ahmed-Test-12345', [
    { jours: 2, resto: 'Resto Test Nour', itemTot: 42637, remise: 42637, origDeliv: 57278.79, deliv: 0 }
  ]);
  wD.yassirSelectAmFilter('Nour Ali');
  assert.equal(cardTxt(wD, 'profileLrLgTnd'), '57278.79 TND', 'LR&LG capture (c2)');
  assert.equal(cardTxt(wD, 'profileOfferPartTnd'), '42637.00 TND', 'offres capture (c2)');
  assert.equal(cardTxt(wD, 'profileRemainingBudgetTnd'), '—', 'reste « — » capture (c2)');
  assert.ok(!wD.document.getElementById('lmdProfileBudgetCard').textContent.includes('-99915.79'), 'reste -99915.79 toujours présent (c2)');

  assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
});

// ---- Cartes Portefeuilles : même correctif budget que la carte profil ----
// Mêmes données que le test de la carte profil (Omar LR&LG 15 + offres 0 = 15 ;
// Nour 0 + 5 = 5 ; Eya 0 + 20 = 20 ; global LR&LG 15, offres 25, total 40).
// Budgets : Omar 1000, Nour 500, global 1500 ; Eya n'a pas de ligne.
// Attendu : AM avec ligne -> son budget ; AM sans ligne vu par un compte qui
// voit tout -> budget global ; aucun budget connu -> « — » partout, jamais
// 0,00 ni reste négatif. Les montants restent ceux de l'AM, seul le budget
// vient du résolveur (Budget AM / Budget global).
test('Cartes Portefeuilles : budget AM, budget global, « — » si aucun budget', async () => {
  const fmtFR = (d) => String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
  const ilYAJours = (n) => fmtFR(new Date(Date.now() - n * 86400000));

  const build = async (budgetStore, user, pwd, rowsSpec) => {
    clearSheetCache();
    installGoogleMock();
    googleFailAllValues = true;
    const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window;
    w.__PULSE_API__ = 'https://api.test';
    w.localStorage.setItem('yassir_vf_budget_v1', JSON.stringify(budgetStore));
    w.localStorage.setItem('yassir_vf_offre_participation_v1', JSON.stringify([
      { area: '', restaurant: 'resto test omar', restaurantNorm: 'resto test omar', cPct: 10, tag: 'Toute la carte', am: 'Omar Beldi', partPct: 10, details: '', startDate: '', endDate: '', periode: '' }
    ]));
    w.localStorage.setItem('yassir_vf_am_portfolios_v9', JSON.stringify({
      'resto test omar': { am: 'Omar Beldi', displayName: 'Resto Test Omar', ville: 'Tunis', segment: 'Top Performer' },
      'resto test nour': { am: 'Nour Ali', displayName: 'Resto Test Nour', ville: 'Tunis', segment: 'Top Performer' },
      'resto test eya': { am: 'Eya Majdoub', displayName: 'Resto Test Eya', ville: 'Tunis', segment: 'Top Performer' }
    }));
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
    await login(w, user, pwd);
    const makeXlsxFile = (aoa, sheetName, fileName) => {
      const wb = w.XLSX.utils.book_new();
      w.XLSX.utils.book_append_sheet(wb, w.XLSX.utils.aoa_to_sheet(aoa), sheetName);
      const buf = w.XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      return new w.File([buf], fileName, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    };
    const idxOrigDeliv = TARGET_HEADERS_TEST.indexOf('original delivery amount');
    const idxDeliv = TARGET_HEADERS_TEST.indexOf('delivery amount');
    const idxAmtRest = TARGET_HEADERS_TEST.indexOf('amount to restaurant');
    const dataAoa = [TARGET_HEADERS_TEST.slice()];
    rowsSpec.forEach((spec, i) => {
      const r = yassirRow(ilYAJours(spec.jours), 'YAF-90' + (10 + i), spec.resto, spec.itemTot, spec.remise, '', '');
      r[idxOrigDeliv] = spec.origDeliv; r[idxDeliv] = spec.deliv; r[idxAmtRest] = spec.itemTot;
      dataAoa.push(r);
    });
    const dataFile = makeXlsxFile(dataAoa, 'Data exp', 'data-exp.xlsx');
    w.yassirOnMainFileChange({ target: { files: [dataFile], value: 'x' } });
    await wait(1200);
    w.yassirSwitchTab('portefeuilles');
    await wait(600);
    return w;
  };
  const carte = (w, am) => {
    const el = w.document.querySelector('#amSummaryCardsGrid [data-key="' + am + '"]');
    assert.ok(el, 'carte ' + am + ' absente');
    return el;
  };
  const rowsStd = [
    { jours: 3, resto: 'Resto Test Omar', itemTot: 100, remise: 0, origDeliv: 20, deliv: 5 },
    { jours: 3, resto: 'Resto Test Nour', itemTot: 50, remise: 5, origDeliv: 10, deliv: 10 },
    { jours: 2, resto: 'Resto Test Eya', itemTot: 200, remise: 20, origDeliv: 0, deliv: 0 }
  ];
  const budgets = { byAm: { 'Omar Beldi': 1000, 'Nour Ali': 500 }, global: 1500 };

  // (a) Lecture seule : Omar et Nour ont leur budget, Eya (sans ligne) -> global.
  const wA = await build(budgets, 'ahmed.marrouki', 'Ahmed-Test-12345', rowsStd);
  const omarA = carte(wA, 'Omar Beldi');
  assert.ok(omarA.textContent.includes('Budget AM (TND)'), 'libellé Omar (a)');
  assert.ok(omarA.textContent.includes('1000.00 TND'), 'budget Omar (a)');
  assert.ok(omarA.textContent.includes('985.00 TND'), 'reste Omar (a)');
  assert.ok(omarA.textContent.includes('15.00 TND (1.5%)'), 'LR&LG Omar (a)');
  assert.ok(omarA.textContent.includes('0.00 TND (0.0%)'), 'offres Omar (a)');
  assert.ok(omarA.textContent.includes('1.5 %'), '% Omar (a)');
  const nourA = carte(wA, 'Nour Ali');
  assert.ok(nourA.textContent.includes('Budget AM (TND)'), 'libellé Nour (a)');
  assert.ok(nourA.textContent.includes('500.00 TND'), 'budget Nour (a)');
  assert.ok(nourA.textContent.includes('495.00 TND'), 'reste Nour (a)');
  assert.ok(nourA.textContent.includes('5.00 TND (1.0%)'), 'offres Nour (a)');
  const eyaA = carte(wA, 'Eya Majdoub');
  assert.ok(eyaA.textContent.includes('Budget global (TND)'), 'libellé Eya = global (a) : ' + eyaA.textContent.slice(0, 400));
  assert.ok(eyaA.textContent.includes('1500.00 TND'), 'budget global Eya (a)');
  assert.ok(eyaA.textContent.includes('1480.00 TND'), 'reste Eya = global − ses 20 (a)');
  assert.ok(eyaA.textContent.includes('20.00 TND (1.3%)'), 'offres Eya (a)');
  assert.ok(eyaA.textContent.includes('1.3 %'), '% Eya (a)');
  assert.ok(!wA.document.getElementById('amSummaryCardsGrid').textContent.includes('-'), 'signe négatif dans les cartes (a)');

  // (b) Aucun budget chargé -> « — » partout, jamais 0,00 ni reste négatif.
  const wB = await build({ byAm: {}, global: 0 }, 'ahmed.marrouki', 'Ahmed-Test-12345', rowsStd);
  const gridB = wB.document.getElementById('amSummaryCardsGrid');
  assert.ok(gridB.textContent.includes('—'), '« — » absent (b)');
  assert.ok(!gridB.textContent.includes('-'), 'signe négatif présent (b)');
  ['Omar Beldi', 'Nour Ali', 'Eya Majdoub'].forEach(function (am) {
    const c = carte(wB, am);
    assert.ok(/Budget AM \(TND\)<\/span><strong[^>]*>—<\/strong>/.test(c.innerHTML), 'budget « — » pour ' + am + ' (b)');
    assert.ok(/Reste Budget \(TND\)<\/span><strong[^>]*>—<\/strong>/.test(c.innerHTML), 'reste « — » pour ' + am + ' (b)');
    assert.ok(/% Budget Utilisé \(LR\/LG \+ Offres\)<\/span><strong[^>]*>—<\/strong>/.test(c.innerHTML), '% « — » pour ' + am + ' (b)');
  });

  // (c) AM avec sa propre ligne -> son budget, comportement inchangé.
  const wC = await build(budgets, 'omar.beldi', 'Omar-Test-12345', rowsStd);
  const cardsC = wC.document.querySelectorAll('#amSummaryCardsGrid > div');
  assert.equal(cardsC.length, 1, 'un AM ne voit que sa carte (c)');
  const omarC = carte(wC, 'Omar Beldi');
  assert.ok(omarC.textContent.includes('Budget AM (TND)'), 'libellé Omar (c)');
  assert.ok(omarC.textContent.includes('1000.00 TND'), 'budget Omar (c)');
  assert.ok(omarC.textContent.includes('985.00 TND'), 'reste Omar (c)');

  // (d) AM sans ligne de budget -> « — » (le budget global ne se montre
  // qu'à ceux qui voient tout, jamais à l'AM lui-même).
  const wD = await build({ byAm: { 'Nour Ali': 500 }, global: 1500 }, 'omar.beldi', 'Omar-Test-12345', rowsStd);
  const omarD = carte(wD, 'Omar Beldi');
  assert.ok(!omarD.textContent.includes('1500.00 TND'), 'budget global montré à un AM sans ligne (d)');
  assert.ok(/Budget AM \(TND\)<\/span><strong[^>]*>—<\/strong>/.test(omarD.innerHTML), 'budget « — » pour Omar sans ligne (d)');
  assert.ok(/Reste Budget \(TND\)<\/span><strong[^>]*>—<\/strong>/.test(omarD.innerHTML), 'reste « — » pour Omar sans ligne (d)');
  assert.ok(!omarD.textContent.includes('-'), 'signe négatif présent (d)');

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

  // Les anciens lecteurs directs Google (classeur XLSX, gviz, JSONP) n'existent
  // plus : le Worker ne lit que les onglets AM pour les portefeuilles (l'onglet
  // Budget ne peut plus injecter de restaurants 'Yassir'/'Kool').
  assert.equal(typeof w.yassirExtrairePortefeuillesDepuisClasseur, 'undefined', 'extracteur de classeur encore présent');
  assert.equal(typeof w.yassirLireClasseurToutesFeuilles, 'undefined', 'lecteur multi-onglets direct encore présent');
  assert.equal(typeof w.yassirFetchGoogleWorkbookXlsx, 'undefined', 'téléchargement XLSX direct encore présent');

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

// ---- Multi-onglets : la fusion est désormais côté Worker (G3 suite) ----
// Les onglets journaliers sont fusionnés par /api/sheets/:source ; les tests
// G3 plus bas couvrent la pagination, la garde manuelle et l'échec isolé.

test('G3 : lecture par tranches — toutes les tranches fusionnées, en-têtes une seule fois', async () => {
  const w = bootKool();
  await login(w, 'proprio', 'Proprio-Test-123');
  // Data Kool simulée : 5 commandes (1001-1005). Grosses sources = tranches
  // (plan gratuit, correctif 2026-11-28), plus de pages : ?tabs=1 puis
  // ?slice=0&sliceSize=1000 — le Worker doit transmettre ces paramètres
  // (route /api/sheets/:source) sinon la boucle ne termine jamais.
  const callsBefore = w.__sheetApiCalls.length;
  const rows = await w.yassirLireFeuilleViaApi('data-kool', { brand: 'kool' });
  assert.equal(rows.length, 6, '1 en-tête + 5 lignes attendues, obtenu ' + rows.length);
  assert.equal(rows[0][4], 'N° commande', '1re ligne = en-têtes');
  assert.equal(rows.filter((r) => String(r[4] || '') === 'N° commande').length, 1, 'en-têtes répétés entre les tranches');
  const oids = rows.slice(1).map((r) => String(r[4] || '').trim()).sort();
  // Comparaison par join : les lignes alignées par le chemin tranches sont
  // des tableaux du realm jsdom — deepEqual strict les rejetterait alors que
  // le contenu est identique.
  assert.equal(oids.join(','), '1001,1002,1003,1004,1005', 'commandes fusionnées : ' + oids.join(','));
  const newCalls = w.__sheetApiCalls.slice(callsBefore);
  assert.ok(newCalls.some((u) => u.includes('/api/sheets/data-kool') && u.includes('tabs=1')), 'tabs=1 non appelé');
  assert.ok(newCalls.some((u) => u.includes('/api/sheets/data-kool') && u.includes('slice=0')), 'tranche 0 non appelée');
  assert.ok(!newCalls.some((u) => u.includes('page=')), 'le chemin tranches ne doit pas paginer');
  assert.ok(!newCalls.some((u) => u.includes('fresh=1')), 'lecture par tranches sans fresh=1');
  assert.ok(!sheetCalls.some((u) => u.includes('docs.google.com')), 'appel Google direct pendant la lecture par tranches');
  assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));

  // Chemin historique (petites sources) : la pagination est toujours en place.
  // Commissions simulées : 2 lignes de données → pageSize=1 donne 2 pages
  // (totalRows ne compte que les données, l'en-tête est répété sur chaque page).
  const callsBefore2 = w.__sheetApiCalls.length;
  const commRows = await w.yassirLireFeuilleViaApi('commissions', { brand: 'kool', pageSize: 1 });
  assert.equal(commRows.length, 3, 'commissions : 1 en-tête + 2 lignes, obtenu ' + commRows.length);
  assert.equal(commRows.filter((r) => String(r[0] || '') === 'Restaurant').length, 1, 'en-têtes commissions répétés');
  const newCalls2 = w.__sheetApiCalls.slice(callsBefore2);
  assert.ok(newCalls2.some((u) => u.includes('/api/sheets/commissions') && u.includes('page=0')), 'commissions page 0 non appelée');
  assert.ok(newCalls2.some((u) => u.includes('page=1')), 'commissions page 1 non appelée');
});

test('G3 : garde synchro manuelle proprio + échec d’une source isolé des autres', async () => {
  // Synchro manuelle par un AM : bloquée avant tout appel (pas de fresh=1).
  const wAm = bootKool();
  await login(wAm, 'omar.beldi', 'Omar-Test-12345');
  const labelBefore = wAm.document.getElementById('labelSyncKoolSheets').textContent;
  wAm.yassirSyncKoolSheets(true);
  assert.equal(wAm.document.getElementById('labelSyncKoolSheets').textContent, labelBefore, 'synchro manuelle Kool lancée par un AM');
  assert.ok(!wAm.__sheetApiCalls.some((u) => u.includes('fresh=1')), 'un AM a déclenché une lecture fresh=1');

  // Échec d'une source (onglet Statuts illisible) : Statuts en échec, Budget OK.
  const w = boot();
  await login(w, 'proprio', 'Proprio-Test-123');
  googleFailTabs.add('Statuts');
  try {
    await w.yassirSyncRestoStatusSheet(true);
    assert.equal(w.yassirStatutSynchroParSource()['Statut Active/Inactive'], false, 'Statuts non marqué en échec');
    await w.yassirSyncBudgetSheet(true);
    assert.equal(w.yassirStatutSynchroParSource()['Budget'], true, 'Budget en échec alors que sa feuille est lisible');
  } finally {
    googleFailTabs.delete('Statuts');
  }
  assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
});

test('G3 : synchro Budget via /api/sheets — budgets Yassir et Kool séparés', async () => {
  const w = boot();
  await login(w, 'proprio', 'Proprio-Test-123');
  await w.yassirSyncBudgetSheet(true);
  // Feuille simulée : Omar 100 000 (Yassir) + Eya 50 000 (Yassir), Omar 80 000 (Kool).
  const stored = JSON.parse(w.localStorage.getItem('yassir_vf_budget_v1') || '{}');
  assert.equal(stored.byAm['Omar Beldi'], 100000, 'budget Yassir Omar : ' + JSON.stringify(stored));
  assert.equal(stored.byAm['Eya Majdoub'], 50000, 'budget Yassir Eya');
  const storedKool = JSON.parse(w.localStorage.getItem('kool_vf_budget_v1') || '{}');
  assert.equal(storedKool.byAm['Omar Beldi'], 80000, 'budget Kool Omar : ' + JSON.stringify(storedKool));
  assert.equal(w.yassirStatutSynchroParSource()['Budget'], true, 'Budget non marqué OK');
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
  // Onglet journalier Détails articles : colonnes dans un ordre différent.
  const dailyItemsAoa = [
    ['Article', 'Order ID', 'Date', 'Restaurant', 'Category', 'Quantity', 'Unit Price', 'Discount Price', 'Original Price', 'Type'],
    ['Pizza Quatre Fromages', '1006', '19/11/2026', 'Resto Alpha', 'Pizza', 1, 14, 0, 14, 'Food'],
    ['Tiramisu', '1006', '19/11/2026', 'Resto Alpha', 'Dessert', 1, 6, 0, 6, 'Food'],
    ['Salade César', '1007', '20/11/2026', 'Resto Beta', 'Salade', 2, 8, 0, 8, 'Food']
  ];
  // Onglets journaliers ajoutés au mock Google (le Worker les fusionne et
  // ignore l'onglet invalide « Portefeuilles ») ; la synchro manuelle
  // (fresh=1) les relit.
  setGoogleMockTabs(DATA_KOOL, {
    '2026-11-19': dailyDataAoa,
    Portefeuilles: [['Ville', 'Segment', 'Restaurant'], ['Tunis', 'Top', 'Resto X']]
  });
  setGoogleMockTabs(DETAILS, { '2026-11-19': dailyItemsAoa });
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
    store.set('config', JSON.stringify({ ...testConfigBase, live: { ...testConfigBase.live, HISTORICAL_MONTHS: [
      { label: 'Octobre (Google Sheets)', sheetId: octId, gid: '0', tab: 'Data exp' },
      { label: 'Novembre (Google Sheets)', sheetId: novId, gid: '0', tab: 'Data exp' }
    ] } }));
    const w = boot();
    const mkRow = (date, oid, resto, itemTot) => yassirRow(date, oid, resto, itemTot, 0, '', '');
    // Octobre : onglet principal (1 commande) + onglet journalier aux colonnes
    // mélangées (2 commandes).
    const octMainAoa = [TARGET_HEADERS_TEST.slice(), mkRow('16/10/2026', 'YAF-9001', 'Resto Yassir A', 100)];
    const octDailyHeaders = [...TARGET_HEADERS_TEST].reverse();
    const octDailyAoa = [octDailyHeaders,
      [...mkRow('17/10/2026', 'YAF-9002', 'Resto Yassir B', 50)].reverse(),
      [...mkRow('20/11/2026', 'YAF-9004', 'Resto Yassir C', 40)].reverse()];
    // Novembre : un seul onglet (comportement inchangé).
    const novMainAoa = [TARGET_HEADERS_TEST.slice(), mkRow('16/11/2026', 'YAF-9003', 'Resto Yassir A', 60)];
    // Onglets dans le mock Google (le Worker les fusionne par mois).
    setGoogleMockTabs(octId, { 'Data exp': octMainAoa, '2026-10-17': octDailyAoa });
    setGoogleMockTabs(novId, { 'Data exp': novMainAoa });
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
  // Feuille Budget illisible : le budget préréglé survit à la synchro auto.
  googleFailTabs.add('Budget');
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
  clearJournal();
  const w = boot();
  await login(w, 'omar.beldi', 'Omar-Test-12345');
  w.yassirJournaliser('export', 'Export Excel : Test.xlsx');
  await wait(400);
  // La connexion AM (côté Worker) + l'export sont journalisés.
  let entries = await journalEntries();
  assert.ok(entries.some((e) => e.type === 'login' && e.user === 'omar.beldi'), 'connexion AM absente du journal');
  assert.ok(entries.some((e) => e.type === 'export' && e.user === 'omar.beldi' && e.detail.includes('Test.xlsx')), 'export AM absent du journal');
  // Déconnexion journalisée.
  w.yassirLogout();
  await wait(400);
  entries = await journalEntries();
  assert.ok(entries.some((e) => e.type === 'logout' && e.user === 'omar.beldi'), 'déconnexion AM absente du journal');
  // Le proprio n'est jamais journalisé : ni sa connexion, ni ses appels à l'aide.
  const before = entries.length;
  const w2 = boot();
  await login(w2, 'proprio', 'Proprio-Test-123');
  w2.yassirJournaliser('export', 'Export Excel : Proprio.xlsx');
  await wait(400);
  entries = await journalEntries();
  assert.equal(entries.length, before, 'le proprio ne doit rien ajouter au journal');
  assert.ok(!entries.some((e) => e.user === 'proprio'), 'aucune entrée proprio dans le journal');
});

// ---- Déconnexion côté serveur (audit 2026-11-27, item 8) ----
test("déconnexion côté serveur : l'ancien jeton meurt, la reconnexion fonctionne", async () => {
  const w = boot();
  await login(w, 'omar.beldi', 'Omar-Test-12345');
  const token = w.sessionStorage.getItem('pulse_token_v1');
  assert.ok(token, 'jeton présent après connexion');
  // Déconnexion explicite (bouton Déconnexion) : le jeton est invalidé côté serveur.
  w.yassirLogout({ server: true });
  await wait(600);
  const me = await w.fetch('https://api.test/api/me', { headers: { Origin: 'http://localhost', Authorization: 'Bearer ' + token } });
  assert.equal(me.status, 401, 'ancien jeton toujours accepté après déconnexion serveur');
  // Le jeton est effacé du navigateur et la déconnexion est journalisée.
  assert.equal(w.sessionStorage.getItem('pulse_token_v1'), null, 'jeton non effacé');
  const entries = await journalEntries();
  assert.ok(entries.some((e) => e.type === 'logout' && e.user === 'omar.beldi'), 'déconnexion AM absente du journal');
  // Reconnexion possible avec le même mot de passe.
  await login(w, 'omar.beldi', 'Omar-Test-12345');
  assert.equal(w.document.getElementById('appWrapper').classList.contains('hidden'), false, 'reconnexion après déconnexion impossible');
  assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
});

test("déconnexion 401 (gardien de session) : locale seulement, le jeton reste valable côté serveur", async () => {
  const w = boot();
  await login(w, 'omar.beldi', 'Omar-Test-12345');
  const token = w.sessionStorage.getItem('pulse_token_v1');
  assert.ok(token, 'jeton présent après connexion');
  // Chemin 401 : le jeton est déjà rejeté par l'API, /api/logout est inutile.
  w.yassirLogout();
  await wait(400);
  const me = await w.fetch('https://api.test/api/me', { headers: { Origin: 'http://localhost', Authorization: 'Bearer ' + token } });
  assert.equal(me.status, 200, 'la déconnexion locale ne doit pas invalider le jeton côté serveur');
  assert.equal(w.sessionStorage.getItem('pulse_token_v1'), null, 'jeton non effacé');
  assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
});

test("déconnexion : l'échec de /api/logout ne bloque pas la déconnexion locale", async () => {
  const w = boot();
  await login(w, 'omar.beldi', 'Omar-Test-12345');
  const origFetch = w.fetch;
  w.fetch = async (url, opts = {}) => {
    if (String(url).includes('/api/logout')) throw new Error('réseau coupé');
    return origFetch(url, opts);
  };
  w.yassirLogout({ server: true });
  await wait(400);
  assert.equal(w.sessionStorage.getItem('pulse_token_v1'), null, 'jeton non effacé malgré l\'échec serveur');
  assert.equal(w.document.getElementById('loginScreen').classList.contains('hidden'), false, 'écran de connexion non affiché');
  assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
});

test("journal d'activité : échec de connexion AM journalisé côté Worker", async () => {
  clearJournal();
  const w = boot();
  await login(w, 'omar.beldi', 'mauvais-mot-de-passe');
  await wait(300);
  const entries = await journalEntries();
  assert.equal(entries.length, 1, 'un seul échec attendu');
  assert.equal(entries[0].type, 'login_fail');
  assert.equal(entries[0].user, 'omar.beldi');
  assert.ok(!JSON.stringify(entries).includes('mauvais-mot-de-passe'), 'jamais de mot de passe dans le journal');
});

test("journal d'activité : le proprio voit le journal et ses filtres, l'AM ne voit pas le bouton", async () => {
  clearJournal(); // vider aussi les clés activity:* des tests précédents (fusionnées en lecture)
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
  clearJournal();
  const w = boot();
  await login(w, 'omar.beldi', 'Omar-Test-12345');
  w.yassirTraiterAlerte('test|key');
  await wait(400);
  const entries = await journalEntries();
  assert.ok(entries.some((e) => e.type === 'alerte' && e.detail.includes('test|key')), 'alerte traitée absente du journal');
});

test('thème : bouton de bascule présent dans l\'en-tête, visible par tous les comptes', async () => {
  const w = boot();
  const btn = w.document.getElementById('btnBasculerTheme');
  assert.ok(btn, 'bouton thème absent');
  assert.equal(btn.getAttribute('onclick'), 'window.yassirBasculerTheme()', 'bouton non câblé sur yassirBasculerTheme');
  assert.equal(btn.classList.contains('hidden'), false, 'bouton thème masqué');
  assert.ok(w.document.getElementById('iconTheme').classList.contains('fa-moon'), 'icône lune attendue en mode clair');
  // Même visible pour un AM (préférence d'affichage, pas une fonction admin).
  await login(w, 'omar.beldi', 'Omar-Test-12345');
  assert.equal(w.document.getElementById('btnBasculerTheme').classList.contains('hidden'), false, 'bouton thème masqué pour un AM');
});

test('thème : mode clair par défaut, bascule clair → sombre → clair mémorisée', async () => {
  const w = boot();
  assert.equal(w.document.documentElement.classList.contains('dark'), false, 'mode sombre actif par défaut');
  assert.notEqual(w.localStorage.getItem('yassir_pulse_theme_v1'), 'sombre', 'stockage sombre par défaut');
  // Bascule vers le sombre.
  w.yassirBasculerTheme();
  assert.equal(w.document.documentElement.classList.contains('dark'), true, 'classe dark non posée');
  assert.equal(w.localStorage.getItem('yassir_pulse_theme_v1'), 'sombre', 'choix sombre non mémorisé');
  assert.ok(w.document.getElementById('iconTheme').classList.contains('fa-sun'), 'icône soleil attendue en mode nuit');
  assert.ok(!w.document.getElementById('iconTheme').classList.contains('fa-moon'), 'icône lune encore présente en mode nuit');
  // Retour au clair.
  w.yassirBasculerTheme();
  assert.equal(w.document.documentElement.classList.contains('dark'), false, 'classe dark non retirée');
  assert.equal(w.localStorage.getItem('yassir_pulse_theme_v1'), 'clair', 'choix clair non mémorisé');
  assert.ok(w.document.getElementById('iconTheme').classList.contains('fa-moon'), 'icône lune attendue après retour au clair');
});

test('thème : le choix mémorisé est réappliqué au chargement', async () => {
  const w = boot();
  w.localStorage.setItem('yassir_pulse_theme_v1', 'sombre');
  w.yassirAppliquerTheme();
  assert.equal(w.document.documentElement.classList.contains('dark'), true, 'thème sombre mémorisé non réappliqué');
  w.localStorage.setItem('yassir_pulse_theme_v1', 'clair');
  w.yassirAppliquerTheme();
  assert.equal(w.document.documentElement.classList.contains('dark'), false, 'thème clair mémorisé non réappliqué');
  // Argument explicite prioritaire.
  w.yassirAppliquerTheme('sombre');
  assert.equal(w.document.documentElement.classList.contains('dark'), true, 'yassirAppliquerTheme(sombre) sans effet');
  assert.equal(w.localStorage.getItem('yassir_pulse_theme_v1'), 'sombre', 'argument explicite non mémorisé');
});

test('thème : script anti-flash dans le <head> et darkMode par classe', () => {
  assert.ok(html.includes('yassir_pulse_theme_v1'), 'clé de thème absente de index.html');
  assert.ok(html.includes("classList.add('dark')"), 'script anti-flash absent du <head>');
  assert.ok(html.includes('id="btnBasculerTheme"'), 'bouton thème absent de index.html');
  const twConfig = readFileSync('tailwind.config.js', 'utf8');
  assert.ok(twConfig.includes("darkMode: 'class'"), 'darkMode class absent de tailwind.config.js');
  assert.ok(!twConfig.includes("darkMode: 'media'"), 'darkMode media interdit (le choix manuel doit gagner)');
  assert.ok(existsSync('src/styles/theme-sombre.css'), 'couche CSS sombre absente');
  const cssSombre = readFileSync('src/styles/theme-sombre.css', 'utf8');
  assert.ok(cssSombre.includes('.dark .bg-white'), 'règle de surface sombre absente');
  assert.ok(cssSombre.includes('.dark .text-\\[\\#1A1A2E\\]'), 'règle de texte sombre absente');
});

test('thème : couleurs des graphiques adaptées en mode nuit, inchangées en mode clair', async () => {
  const w = boot();
  assert.equal(w.yassirCouleurGraphique('#6C2BD9'), '#6C2BD9', 'couleur graphique modifiée en mode clair');
  assert.equal(w.yassirCouleurGraphique('#E2E8F0'), '#E2E8F0', 'grille modifiée en mode clair');
  w.yassirAppliquerTheme('sombre');
  assert.equal(w.yassirCouleurGraphique('#6C2BD9'), '#C4B5FD', 'graduation non adaptée en mode nuit');
  assert.equal(w.yassirCouleurGraphique('#5B21B6'), '#C4B5FD', 'graduation violette non adaptée en mode nuit');
  assert.equal(w.yassirCouleurGraphique('#E2E8F0'), '#334155', 'grille non adaptée en mode nuit');
  assert.equal(w.yassirCouleurGraphique('#1A1A2E'), '#F1F5F9', 'texte graphique non adapté en mode nuit');
  assert.equal(w.yassirCouleurGraphique('#FFD100'), '#FFD100', 'couleur de série modifiée (les courbes ne doivent pas changer)');
  w.yassirAppliquerTheme('clair');
  assert.equal(w.yassirCouleurGraphique('#6C2BD9'), '#6C2BD9', 'couleur graphique non restaurée en mode clair');
});

// ---- XSS (audit 2026-11-27, item 2) : valeurs interpolées dans onclick ----
test('XSS : Test d\'essai, charge alert(1), raison piégée — Modifier/Supprimer fonctionnels, rien ne s\'exécute', async () => {
  const w = boot();
  await login(w, 'proprio', 'Proprio-Test-123');
  // alert() piégé : si une charge s'exécute, le drapeau se lève.
  w.alert = () => { w.__ALERT__ = true; };

  const nameInput = w.document.getElementById('inputNewRestName');
  const rateInput = w.document.getElementById('inputNewRestRate');
  assert.ok(nameInput && rateInput, 'formulaire commission absent');
  const tbody = w.document.getElementById('commTableBody');
  const boutonSupprimer = (nom) => [...tbody.querySelectorAll('[data-action="remove-commission"]')].find((b) => b.getAttribute('data-key') === nom);
  // Espion sur la suppression : le clic délégué doit appeler la fonction avec le nom exact.
  let removed = null;
  const origRemove = w.yassirRemoveCommission;
  w.yassirRemoveCommission = (k) => { removed = k; return origRemove(k); };
  const ajouterCommission = (nom, taux) => {
    nameInput.value = nom;
    rateInput.value = String(taux);
    w.yassirAddCommission({ preventDefault() {} });
  };

  // 1. Restaurant « Test d'essai » (apostrophe réelle) : Supprimer fonctionne,
  // y compris en cliquant sur l'icône <i> à l'intérieur du bouton (closest()).
  ajouterCommission("Test d'essai", 15);
  removed = null;
  const btnEssai = boutonSupprimer("test d'essai");
  assert.ok(btnEssai, 'bouton Supprimer (Test d\'essai) absent');
  assert.equal(btnEssai.getAttribute('onclick'), null, 'onclick inline présent (Test d\'essai)');
  btnEssai.querySelector('i').click();
  assert.equal(removed, "test d'essai", 'la suppression ne reçoit pas le nom exact (Test d\'essai)');
  assert.ok(!tbody.textContent.includes("test d'essai"), 'le restaurant est toujours là après suppression');

  // 2. Charge de l'audit : ');alert(1);// — rien ne doit s'exécuter, la suppression reçoit le nom exact.
  const charge = "');alert(1);//";
  ajouterCommission(charge, 12);
  removed = null;
  const btnCharge = boutonSupprimer(charge);
  assert.ok(btnCharge, 'bouton Supprimer (charge) absent');
  assert.equal(btnCharge.getAttribute('onclick'), null, 'onclick inline présent (charge)');
  assert.ok(!tbody.innerHTML.includes('yassirRemoveCommission('), 'appel interpolé présent dans le HTML');
  btnCharge.click();
  assert.equal(removed, charge, 'la suppression ne reçoit pas le nom exact (charge)');
  assert.equal(w.__ALERT__, undefined, 'la charge alert(1) s\'est exécutée !');
  assert.ok(!tbody.textContent.includes(charge), 'la charge est toujours là après suppression');

  // 3. Autre charge (audit) : x');window.__xss__=1;//
  const charge2 = "x');window.__xss__=1;//";
  ajouterCommission(charge2, 10);
  removed = null;
  const btnCharge2 = boutonSupprimer(charge2.toLowerCase());
  assert.ok(btnCharge2, 'bouton Supprimer (charge 2) absent');
  btnCharge2.click();
  assert.equal(removed, charge2.toLowerCase(), 'la suppression ne reçoit pas le nom exact (charge 2)');
  assert.equal(w.__xss__, undefined, 'la charge window.__xss__ s\'est exécutée !');

  // 4. Bouton Modifier du portefeuille : le clic délégué ouvre la modale avec le bon restaurant.
  w.document.getElementById('inputAmRestName').value = "Test d'essai";
  w.document.getElementById('selectAmAgent').value = 'Omar Beldi';
  w.document.getElementById('inputAmRestVille').value = 'Tunis';
  w.yassirAddRestoToAm({ preventDefault() {} });
  // La table n'affiche que les 120 premiers restaurants par défaut : tout
  // afficher pour retrouver « Test d'essai » (tri alphabétique).
  w._amTableShowAll = true;
  w.yassirRenderAmTable();
  const btnModifier = [...w.document.querySelectorAll('[data-action="open-edit-resto"]')].find((b) => b.getAttribute('data-key') === "test d'essai");
  assert.ok(btnModifier, 'bouton Modifier (Test d\'essai) absent');
  assert.equal(btnModifier.getAttribute('onclick'), null, 'onclick inline présent (Modifier)');
  btnModifier.click();
  assert.equal(w.document.getElementById('editRestoModal').classList.contains('hidden'), false, 'la modale d\'édition ne s\'ouvre pas');
  assert.equal(w.document.getElementById('editRestoName').value, "Test d'essai", 'la modale n\'affiche pas le bon restaurant');
  w.yassirCloseEditRestoModal();

  // 5. Raison d'annulation piégée (+ type piégé) : le clic délégué transmet la valeur exacte sans l'exécuter.
  let raisonRecue = null;
  const origRaison = w.yassirSetCancReasonFilter;
  w.yassirSetCancReasonFilter = (r) => { raisonRecue = r; };
  let typeRecu = null;
  const origType = w.yassirSetCancTypeFilter;
  w.yassirSetCancTypeFilter = (t) => { typeRecu = t; };
  const raisonPiegee = "raison piégée');window.__XSS2__=1;//";
  const trRaison = w.document.createElement('tr');
  trRaison.setAttribute('data-action', 'set-canc-reason');
  trRaison.setAttribute('data-key', raisonPiegee);
  w.document.body.appendChild(trRaison);
  trRaison.click();
  assert.equal(raisonRecue, raisonPiegee, 'le filtre raison ne reçoit pas la valeur exacte');
  assert.equal(w.__XSS2__, undefined, 'la raison piégée s\'est exécutée !');
  const trType = w.document.createElement('tr');
  trType.setAttribute('data-action', 'set-canc-type');
  trType.setAttribute('data-key', "type piégé');alert(1);//");
  w.document.body.appendChild(trType);
  trType.click();
  assert.equal(typeRecu, "type piégé');alert(1);//", 'le filtre type ne reçoit pas la valeur exacte');
  assert.equal(w.__ALERT__, undefined, 'la charge alert(1) du type s\'est exécutée !');
  w.yassirSetCancReasonFilter = origRaison;
  w.yassirSetCancTypeFilter = origType;

  assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
});

// ---- G1 (2e audit) : les deux onchange de 22-growth-drop.js ----
test("G1 : onchange motif/CRM piégés — data-key + getAttribute, rien ne s'exécute, la saisie est enregistrée", async () => {
  const w = boot();
  await login(w, 'proprio', 'Proprio-Test-123');
  w.alert = () => { w.__ALERT__ = true; };

  const makeXlsxFile = (aoa, sheetName, fileName) => {
    const wb = w.XLSX.utils.book_new();
    w.XLSX.utils.book_append_sheet(wb, w.XLSX.utils.aoa_to_sheet(aoa), sheetName);
    const buf = w.XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    return new w.File([buf], fileName, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  };

  // Resto piégé avec commandes W46 (1 livrée) puis W47 (2 livrées) -> en croissance sur W47.
  const charge = "');window.__xss__=1;//";
  const restoPiege = "Resto " + charge;
  const dataAoa = [TARGET_HEADERS_TEST.slice(),
    yassirRow('09/11/2026', 'YAF-4001', restoPiege, 100, 0, '', ''),
    yassirRow('16/11/2026', 'YAF-4002', restoPiege, 100, 0, '', ''),
    yassirRow('17/11/2026', 'YAF-4003', restoPiege, 100, 0, '', '')
  ];
  const dataFile = makeXlsxFile(dataAoa, 'Data exp', 'data-exp.xlsx');
  w.yassirOnMainFileChange({ target: { files: [dataFile], value: 'x' } });
  await wait(1200);

  // Resto à 0 commande (portefeuille seul, sans commande) -> input commentaire CRM.
  w.document.getElementById('inputAmRestName').value = "Zero " + charge;
  w.document.getElementById('selectAmAgent').value = 'Omar Beldi';
  w.document.getElementById('inputAmRestVille').value = 'Tunis';
  w.yassirAddRestoToAm({ preventDefault() {} });

  w.yassirRenderRestaurantAnalysis();
  await wait(300);

  // 1. Select du motif : data-key présent, pas de charge interpolée dans le onchange.
  const sel = w.document.querySelector('#growthTableBody select, #dropTableBody select');
  assert.ok(sel, 'select du motif absent');
  const cleMotif = sel.getAttribute('data-key');
  assert.ok(cleMotif && cleMotif.startsWith('w47_'), 'data-key du motif absente ou mal formée : ' + cleMotif);
  assert.ok(!sel.getAttribute('onchange').includes(charge), 'la charge est interpolée dans le onchange du motif');
  assert.ok(sel.getAttribute('onchange').includes("getAttribute('data-key')"), 'le onchange ne relit pas data-key');
  // Note : le harnais jsdom tourne en runScripts 'outside-only' : les gestionnaires
  // inline ne sont jamais compilés (sel.onchange === null). On exécute donc le
  // contenu LITTÉRAL de l'attribut onchange avec `this` = l'élément, exactement
  // comme le ferait le navigateur : si la charge était interpolée dans le code,
  // elle s'exécuterait ici.
  const handlerMotif = new w.Function(sel.getAttribute('onchange'));
  sel.value = 'Promo active';
  handlerMotif.call(sel);
  assert.equal(w.__xss__, undefined, 'la charge du motif s\'est exécutée !');
  assert.equal(w.__ALERT__, undefined, 'alert(1) du motif s\'est exécutée !');
  // Re-rendu : le motif choisi persiste (clé exacte retrouvée).
  w.yassirRenderRestaurantAnalysis();
  const sel2 = w.document.querySelector('#growthTableBody select, #dropTableBody select');
  assert.equal(sel2.value, 'Promo active', 'le motif choisi n\'a pas été enregistré');

  // 2. Input commentaire CRM : même protection.
  const input = w.document.querySelector('#zeroOrdersWeekTableBody input[type="text"]');
  assert.ok(input, 'input commentaire CRM absent');
  const cleCrm = input.getAttribute('data-key');
  assert.ok(cleCrm && cleCrm.startsWith('crm_w47_'), 'data-key CRM absente : ' + cleCrm);
  assert.ok(!input.getAttribute('onchange').includes(charge), 'la charge est interpolée dans le onchange CRM');
  const handlerCrm = new w.Function(input.getAttribute('onchange'));
  input.value = 'Appelé, relance semaine prochaine';
  handlerCrm.call(input);
  assert.equal(w.__xss__, undefined, 'la charge CRM s\'est exécutée !');
  w.yassirRenderRestaurantAnalysis();
  const input2 = w.document.querySelector('#zeroOrdersWeekTableBody input[type="text"]');
  assert.equal(input2.value, 'Appelé, relance semaine prochaine', 'le commentaire CRM n\'a pas été enregistré');

  assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
});

// ---- I2 (audit 2026-11-27) : exports/imports en attente des bibliothèques lourdes ----
test('I2 : export Excel avec bibliothèques pas encore chargées — attend puis fonctionne', async () => {
  const w = boot();
  await login(w, 'proprio', 'Proprio-Test-123');
  const xlsxMod = w.XLSX;
  const chartMod = w.Chart;
  assert.ok(xlsxMod && chartMod, 'libs lourdes chargées après connexion');
  const dataAoa = [TARGET_HEADERS_TEST.slice(),
    yassirRow('09/11/2026', 'YAF-5001', 'Resto Test I2', 100, 0, '', ''),
    yassirRow('10/11/2026', 'YAF-5002', 'Resto Test I2', 120, 0, '', '')
  ];
  const wb0 = xlsxMod.utils.book_new();
  xlsxMod.utils.book_append_sheet(wb0, xlsxMod.utils.aoa_to_sheet(dataAoa), 'Data exp');
  const buf0 = xlsxMod.write(wb0, { bookType: 'xlsx', type: 'array' });
  const dataFile = new w.File([buf0], 'data-exp.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  w.yassirOnMainFileChange({ target: { files: [dataFile], value: 'x' } });
  await wait(1200);

  // Simuler un bloc lent (réseau mobile) : les libs sont retirées, le
  // chargement simulé les remet après 50 ms. L'export doit attendre.
  // (Le module XLSX est en lecture seule : on l'enveloppe pour espionner
  // writeFile au lieu de le modifier.)
  const ecrits = [];
  const wrapperXlsx = Object.assign(Object.create(null), xlsxMod, { writeFile: (wb, name) => { ecrits.push(name); } });
  delete w.XLSX;
  delete w.Chart;
  w.yassirLibsLourdesPretes = () => new Promise((res) => setTimeout(() => {
    w.XLSX = wrapperXlsx;
    w.Chart = chartMod;
    res(true);
  }, 50));
  await w.yassirExportExcelComplet();
  assert.equal(ecrits.length, 1, 'export non effectué après attente des libs');
  assert.ok(ecrits[0].startsWith('YASSIR_VF_Data_Offres_Global_'), 'nom de fichier inattendu : ' + ecrits[0]);
  assert.ok(w.document.getElementById('toastContainer').textContent.includes('Chargement des bibliothèques'), 'message « Chargement… » absent');
  assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
});

test('I2 : import de fichier avec bibliothèques pas encore chargées — attend puis fonctionne', async () => {
  const w = boot();
  await login(w, 'proprio', 'Proprio-Test-123');
  const xlsxMod = w.XLSX;
  const chartMod = w.Chart;
  const dataAoa = [TARGET_HEADERS_TEST.slice(),
    yassirRow('09/11/2026', 'YAF-5101', 'Resto Test I2 import', 100, 0, '', '')
  ];
  const wb0 = xlsxMod.utils.book_new();
  xlsxMod.utils.book_append_sheet(wb0, xlsxMod.utils.aoa_to_sheet(dataAoa), 'Data exp');
  const buf0 = xlsxMod.write(wb0, { bookType: 'xlsx', type: 'array' });
  const dataFile = new w.File([buf0], 'data-exp.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  delete w.XLSX;
  delete w.Chart;
  w.yassirLibsLourdesPretes = () => new Promise((res) => setTimeout(() => {
    w.XLSX = xlsxMod;
    w.Chart = chartMod;
    res(true);
  }, 50));
  w.yassirOnMainFileChange({ target: { files: [dataFile], value: 'x' } });
  await wait(1200);
  // L'import est confirmé par son propre toast (durable), pas par mainFileName :
  // la synchro automatique (déclenchée à la connexion) écrit aussi mainFileName
  // à sa fin, et son ordre d'arrivée dépend du débit des tranches (2/s depuis
  // le correctif quota 2026-11-28) — le libellé est donc une course, pas une
  // preuve de l'import. Le toast, lui, n'est jamais écrasé par la synchro.
  assert.ok(w.document.getElementById('toastContainer').textContent.includes('nouvelles lignes'), 'toast d\'import absent : ' + w.document.getElementById('toastContainer').textContent);
  assert.ok(w.document.getElementById('toastContainer').textContent.includes('enregistrées automatiquement'), 'import non effectué après attente des libs');
  assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
});

test('I2 : échec de chargement du bloc — message d\'erreur clair, pas d\'échec silencieux', async () => {
  const w = boot();
  await login(w, 'proprio', 'Proprio-Test-123');
  const xlsxMod = w.XLSX;
  const dataAoa = [TARGET_HEADERS_TEST.slice(),
    yassirRow('09/11/2026', 'YAF-5201', 'Resto Test I2 echec', 100, 0, '', '')
  ];
  const wb0 = xlsxMod.utils.book_new();
  xlsxMod.utils.book_append_sheet(wb0, xlsxMod.utils.aoa_to_sheet(dataAoa), 'Data exp');
  const buf0 = xlsxMod.write(wb0, { bookType: 'xlsx', type: 'array' });
  const dataFile = new w.File([buf0], 'data-exp.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  w.yassirOnMainFileChange({ target: { files: [dataFile], value: 'x' } });
  await wait(1200);

  delete w.XLSX;
  delete w.Chart;
  w.yassirLibsLourdesPretes = () => Promise.resolve(false);
  await w.yassirExportExcelComplet();
  assert.ok(w.document.getElementById('toastContainer').textContent.includes('Impossible de charger les bibliothèques'), 'message d\'erreur clair absent');
  assert.ok(!w.document.getElementById('toastContainer').textContent.includes('Classeur Excel complet exporté'), 'export effectué malgré l\'échec de chargement');
  assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
});

// ---- Semaines (audit 2026-11-27, item 6) : générées en JavaScript ----
test('Semaines : options générées en JavaScript, 2026 inchangées, 2027 présentes', () => {
  const w = boot();
  const sel = w.document.getElementById('filterWeekSelect');
  const prev = w.document.getElementById('filterPrevWeekSelect');
  assert.ok(sel && prev, 'sélecteurs de semaine absents');
  const values = [...sel.options].map((o) => o.value);
  const labels = [...sel.options].map((o) => o.textContent);
  // Plus aucune option en dur dans le HTML.
  assert.ok(!html.includes('2025-12-29|2026-01-04|S01'), 'options 2026 encore en dur dans index.html');
  assert.ok(!html.includes('2026-12-28|2027-01-03|S53'), 'options 2026 encore en dur dans index.html');
  // 2026 strictement identique à l'ancienne liste en dur (valeurs inchangées ;
  // libellés avec l'année depuis M3 : « S47 2026 (16/11 → 22/11) »).
  assert.ok(values.includes('2025-12-29|2026-01-04|S01'), 'S01 2026 absente');
  assert.ok(labels.includes('S01 2026 (29/12 → 04/01)'), 'libellé S01 2026 incorrect');
  assert.ok(values.includes('2026-12-28|2027-01-03|S53'), 'S53 2026 absente');
  assert.ok(labels.includes('S53 2026 (28/12 → 03/01)'), 'libellé S53 2026 incorrect');
  // Année suivante présente : le filtre fonctionne en janvier 2027 et après.
  assert.ok(values.includes('2027-01-04|2027-01-10|S01'), 'S01 2027 absente');
  assert.ok(labels.includes('S01 2027 (04/01 → 10/01)'), 'libellé S01 2027 incorrect');
  // M3 : groupement par année (<optgroup>) et année dans chaque libellé —
  // c'est ce qui a fait choisir S47 2027 au lieu de S47 2026.
  const annee = new Date().getFullYear();
  const groupes = [...sel.querySelectorAll('optgroup')].map((g) => g.getAttribute('label'));
  assert.deepEqual(groupes, [String(annee - 1), String(annee), String(annee + 1)], 'groupes par année incorrects : ' + JSON.stringify(groupes));
  [...sel.options].forEach(function (o) {
    if (!o.value) return;
    // L'année du libellé est l'année ISO de la semaine (celle du groupe),
    // pas celle du lundi : S01 2026 commence le 29/12/2025.
    assert.equal(o.parentElement.tagName, 'OPTGROUP', 'option hors groupe : ' + o.textContent);
    var anneeGroupe = o.parentElement.getAttribute('label');
    assert.ok(o.textContent.includes(' ' + anneeGroupe + ' ('), 'libellé sans année du groupe : ' + o.textContent);
    assert.ok(/^S\d{2} \d{4} \(\d{2}\/\d{2} → \d{2}\/\d{2}\)$/.test(o.textContent), 'format de libellé inattendu : ' + o.textContent);
  });
  // La semaine qui a piégé l'utilisateur : S47 2026 (16→22/11) et S47 2027
  // (22→28/11) ont des valeurs et des libellés différents.
  assert.ok(values.includes('2026-11-16|2026-11-22|S47'), 'S47 2026 absente');
  assert.ok(labels.includes('S47 2026 (16/11 → 22/11)'), 'libellé S47 2026 incorrect');
  assert.ok(values.includes('2027-11-22|2027-11-28|S47'), 'S47 2027 absente');
  assert.ok(labels.includes('S47 2027 (22/11 → 28/11)'), 'libellé S47 2027 incorrect');
  // Les deux sélecteurs ont exactement les mêmes options.
  assert.equal(prev.options.length, sel.options.length, 'les deux sélecteurs diffèrent');
  assert.deepEqual([...prev.options].map((o) => o.value), values, 'options du sélecteur précédent différentes');
  assert.deepEqual([...prev.querySelectorAll('optgroup')].map((g) => g.getAttribute('label')), groupes, 'groupes du sélecteur précédent différents');
  // Nombre d'options : 1 vide + semaines ISO (année-1, année, année+1).
  // Nombre de semaines ISO d'une année (52 ou 53), calculé indépendamment :
  // le jeudi de la semaine du 28 décembre donne le numéro de la dernière semaine.
  const nbSemainesISO = (a) => {
    const d28 = new Date(a, 11, 28);
    const jeudi = new Date(d28);
    jeudi.setDate(d28.getDate() - ((d28.getDay() + 6) % 7) + 3);
    const jourAnnee = Math.round((jeudi - new Date(jeudi.getFullYear(), 0, 1)) / 86400000) + 1;
    return Math.ceil(jourAnnee / 7);
  };
  assert.equal(values.length, 1 + nbSemainesISO(annee - 1) + nbSemainesISO(annee) + nbSemainesISO(annee + 1), 'nombre d\'options incorrect');
  assert.equal(values[1].split('|')[2], 'S01', 'première semaine incorrecte');
  assert.ok(values[values.length - 1].endsWith('|S' + String(nbSemainesISO(annee + 1)).padStart(2, '0')), 'dernière semaine incorrecte');
});

// ---- Item 4 (audit 2026-11-27) : bouton « Recharger depuis Google Sheets » ----
test('Item 4 : le bouton relit la vraie feuille (pas l\u2019instantané KV), échec = grille conservée', async () => {
  const w = boot();
  await login(w, 'proprio', 'Proprio-Test-123');
  w.yassirRenderCommTable(); // la table n'est rendue qu'à l'ouverture de l'onglet
  const corps = () => w.document.getElementById('commTableBody').textContent;
  // Marqueur dans la grille actuelle (instantané) : il doit disparaître après relecture.
  // (Ne pas supposer le contenu de la grille initiale : il vient de private/seed.json en local, du repli simulé en CI.)
  w.document.getElementById('inputNewRestName').value = 'marqueur test unique';
  w.document.getElementById('inputNewRestRate').value = '42';
  w.yassirAddCommission();
  assert.ok(corps().includes('marqueur test unique'), 'marqueur non ajouté à la grille');
  // La feuille simulée renvoie 2 taux, dont un nouveau restaurant : le mock
  // Google change, la relecture manuelle (fresh=1) relit la feuille.
  setGoogleMockData({ comm: 'Restaurant,Commission,APP\nResto Test,23.5,Yassir\nResto Deux,10,Yassir\n' });
  const ok = await w.yassirSyncDefaultCommissions();
  assert.equal(ok, true, 'la relecture a échoué');
  assert.ok(corps().includes('resto test'), 'le nouveau taux de la feuille n\u2019est pas dans la grille');
  assert.ok(corps().includes('23.50'), 'le taux relu (23.50) est absent');
  assert.ok(!corps().includes('marqueur test unique'), 'l\u2019ancienne grille (instantané KV) est toujours là');
  assert.ok(w.document.body.innerHTML.includes('Recharger depuis Google Sheets'), 'libellé du bouton incorrect');
  assert.ok(!w.document.body.innerHTML.includes('Restaurer grille Sheet'), 'ancien libellé trompeur toujours présent');
  // Échec de lecture (onglet Commissions illisible) : la grille actuelle est
  // conservée, jamais vidée.
  googleFailTabs.add('Commissions');
  const ok2 = await w.yassirSyncDefaultCommissions();
  googleFailTabs.delete('Commissions');
  assert.equal(ok2, false, 'la relecture en échec devrait renvoyer false');
  assert.ok(corps().includes('resto test'), 'la grille a été vidée après un échec de lecture');
  assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
});

// Correctif 2 (diagnostic 2026-11-27, semaine figée) : données Kool qui
// s'arrêtent le 22/11/2026 (W47), puis jusqu'au 26/11/2026 (W48).
const koolCsvDataW47fin = toCsv([
  ['Annulé', '', 'Raison annulation', 'Date', 'N° commande', '', 'Restaurant', '', '', 'Montant HT', 'Frais livraison', 'Remise'],
  ['', '', '', '16/11/2026', '1001', '', 'Resto Alpha', '', '', '25.50', '3', '0'],
  ['', '', '', '22/11/2026', '1002', '', 'Resto Alpha', '', '', '40.00', '6', '0'],
]);
const koolCsvDataW48fin = toCsv([
  ['Annulé', '', 'Raison annulation', 'Date', 'N° commande', '', 'Restaurant', '', '', 'Montant HT', 'Frais livraison', 'Remise'],
  ['', '', '', '23/11/2026', '1003', '', 'Resto Alpha', '', '', '25.50', '3', '0'],
  ['', '', '', '26/11/2026', '1004', '', 'Resto Alpha', '', '', '40.00', '6', '0'],
]);

test('Kool : après une synchro fraîche, la semaine par défaut suit les données (W48)', async () => {
  const w = bootKool({ data: koolCsvDataW47fin });
  await login(w, 'proprio', 'Proprio-Test-123');
  await w.yassirSyncKoolSheets(true);
  await wait(600);
  w.yassirSwitchBrand('kool');
  await wait(600);
  await w.yassirSyncKoolSheets(true);
  await wait(600);
  let sel = w.document.getElementById('filterWeekSelect');
  assert.ok(sel.value.endsWith('|S47'), 'semaine par défaut = S47 avant données fraîches, pas ' + sel.value);
  // Données fraîches jusqu'au 26/11/2026 (W48) : le mock Google change, la
  // synchro manuelle (fresh=1) relit la feuille.
  setGoogleMockData({ data: koolCsvDataW48fin });
  await w.yassirSyncKoolSheets(true);
  await wait(600);
  sel = w.document.getElementById('filterWeekSelect');
  assert.ok(sel.value.endsWith('|S48'), 'semaine par défaut = S48 après synchro fraîche, pas ' + sel.value);
  assert.equal(w.document.getElementById('filterDateStart').value, '2026-11-23', 'début W48');
  assert.equal(w.document.getElementById('filterDateEnd').value, '2026-11-29', 'fin W48');
  const hint = w.document.getElementById('dateRangeBoundsHint').textContent;
  assert.ok(hint.includes('26/11/2026'), 'fraîcheur absente : ' + hint);
  assert.equal(errors.length, 0, 'erreurs JS inattendues : ' + errors.join(' | '));
});

// Correctif 4b : la semaine par défaut appliquée après synchro est persistée
// dans le cache de la marque active — sinon une bascule de marque restaure
// l'ancienne semaine (S47 au lieu de S48, ou aucune).
test('Cache de marque : bascule → synchro → la semaine est re-sauvegardée', async () => {
  // Kool : W47 puis W48 frais — le cache Kool doit contenir S48, pas S47.
  const w = bootKool({ data: koolCsvDataW47fin });
  await login(w, 'proprio', 'Proprio-Test-123');
  await w.yassirSyncKoolSheets(true);
  await wait(600);
  w.yassirSwitchBrand('kool');
  await wait(600);
  await w.yassirSyncKoolSheets(true);
  await wait(600);
  assert.ok(w.document.getElementById('filterWeekSelect').value.endsWith('|S47'), 'semaine par défaut = S47 avant données fraîches, pas ' + w.document.getElementById('filterWeekSelect').value);
  setGoogleMockData({ data: koolCsvDataW48fin });
  await w.yassirSyncKoolSheets(true);
  await wait(600);
  assert.ok(w.document.getElementById('filterWeekSelect').value.endsWith('|S48'), 'semaine par défaut = S48 après synchro fraîche, pas ' + w.document.getElementById('filterWeekSelect').value);
  const cacheKool = w.yassirGetDatesCacheMarque('kool');
  assert.equal(cacheKool.dateStart, '2026-11-23', 'cache Kool : début S48, pas ' + JSON.stringify(cacheKool));
  assert.equal(cacheKool.dateEnd, '2026-11-29', 'cache Kool : fin S48, pas ' + JSON.stringify(cacheKool));

  // Yassir : données jusqu'au 16/11 (S47) à la connexion, puis une commande
  // du 26/11/2026 (S48, comme la fixture Kool W48) dans Novembre — le cache
  // Yassir doit contenir S48. (Une date future serait rejetée par
  // parseOrderDayToIsoDate, d'où le 26/11 et non début décembre.)
  const wY = boot();
  await login(wY, 'proprio', 'Proprio-Test-123');
  // La synchro auto à la connexion charge les données par tranches
  // (intervalle 1,5 s) : on attend la semaine S47 plutôt qu'un délai fixe.
  await waitFor(() => wY.document.getElementById('filterWeekSelect').value.endsWith('|S47'));
  assert.ok(wY.document.getElementById('filterWeekSelect').value.endsWith('|S47'), 'semaine Yassir = S47 avant données fraîches, pas ' + wY.document.getElementById('filterWeekSelect').value);
  setGoogleMockTabs(NOV, { 'Data exp': [TARGET_HEADERS_TEST.slice(), yassirRow('16/11/2026', 'YAF-2', 'Resto Yassir A', 60, 0, '', ''), yassirRow('26/11/2026', 'YAF-3', 'Resto Yassir A', 60, 0, '', '')] });
  await wY.yassirSyncHistoricalSheets(true);
  await wait(600);
  assert.ok(wY.document.getElementById('filterWeekSelect').value.endsWith('|S48'), 'semaine Yassir = S48 après synchro fraîche, pas ' + wY.document.getElementById('filterWeekSelect').value);
  const cacheYassir = wY.yassirGetDatesCacheMarque('yassir');
  assert.equal(cacheYassir.dateStart, '2026-11-23', 'cache Yassir : début S48, pas ' + JSON.stringify(cacheYassir));
  assert.equal(cacheYassir.dateEnd, '2026-11-29', 'cache Yassir : fin S48, pas ' + JSON.stringify(cacheYassir));
  assert.equal(errors.length, 0, 'erreurs JS inattendues : ' + errors.join(' | '));
});

test('Kool : un choix manuel de semaine (W47) n\'est jamais écrasé par une synchro fraîche', async () => {
  const w = bootKool({ data: koolCsvDataW47fin });
  await login(w, 'proprio', 'Proprio-Test-123');
  await w.yassirSyncKoolSheets(true);
  await wait(600);
  w.yassirSwitchBrand('kool');
  await wait(600);
  await w.yassirSyncKoolSheets(true);
  await wait(600);
  const sel = w.document.getElementById('filterWeekSelect');
  assert.ok(sel.value.endsWith('|S47'), 'semaine par défaut = S47, pas ' + sel.value);
  // Choix manuel de W47 (la semaine déjà affichée, choisie exprès).
  w.yassirOnWeekSelectChange(sel.value);
  await wait(300);
  assert.equal(w.document.getElementById('filterDateStart').value, '2026-11-16', 'début W47 choisi');
  // Données fraîches jusqu'au 26/11/2026 (W48) : la synchro ne doit rien changer.
  setGoogleMockData({ data: koolCsvDataW48fin });
  await w.yassirSyncKoolSheets(true);
  await wait(600);
  assert.ok(w.document.getElementById('filterWeekSelect').value.endsWith('|S47'), 'semaine manuelle W47 écrasée : ' + w.document.getElementById('filterWeekSelect').value);
  assert.equal(w.document.getElementById('filterDateStart').value, '2026-11-16', 'début W47 perdu');
  assert.equal(w.document.getElementById('filterDateEnd').value, '2026-11-22', 'fin W47 perdue');
  assert.equal(errors.length, 0, 'erreurs JS inattendues : ' + errors.join(' | '));
});

// Correctif 4 (diagnostic 2026-11-27, KPI figés) : les cartes affichaient
// toujours le global — quand la période choisie ne contient aucune commande
// (ex. une semaine 2027 choisie par erreur, le libellé n'affiche pas l'année),
// le moteur sortait sans invalider le cache des stats.
// Données : S43 (19/10) = 2 commandes, J = 150 ; S47 (16-22/11) = 4 commandes,
// J = 375. Resto Alpha, commission 20 % → CA = 20 % × J (30 / 75 / 105 TND).
const koolCsvDataKpi = toCsv([
  ['Annulé', '', 'Raison annulation', 'Date', 'N° commande', '', 'Restaurant', '', '', 'Montant HT', 'Frais livraison', 'Remise'],
  ['', '', '', '19/10/2026', '3001', '', 'Resto Alpha', '', '', '100.00', '3', '0'],
  ['', '', '', '19/10/2026', '3002', '', 'Resto Alpha', '', '', '50.00', '3', '0'],
  ['', '', '', '16/11/2026', '3004', '', 'Resto Alpha', '', '', '200.00', '3', '0'],
  ['', '', '', '16/11/2026', '3005', '', 'Resto Alpha', '', '', '100.00', '3', '0'],
  ['', '', '', '22/11/2026', '3006', '', 'Resto Alpha', '', '', '50.00', '3', '0'],
  ['', '', '', '22/11/2026', '3007', '', 'Resto Alpha', '', '', '25.00', '3', '0'],
]);

test('KPI : les cartes suivent la semaine choisie (S47 puis S43), jamais le global figé', async () => {
  const w = bootKool({ data: koolCsvDataKpi });
  await login(w, 'proprio', 'Proprio-Test-123');
  await w.yassirSyncKoolSheets(true);
  await wait(600);
  w.yassirSwitchBrand('kool');
  await wait(600);
  const kpi = (id) => w.document.getElementById(id).textContent;
  // Toute la période : 6 commandes, CA 105,00 TND (20 % × 525).
  assert.equal(kpi('kpiTotalOrders'), '6', 'total global');
  assert.equal(kpi('kpiTotalCa'), '105,00 TND', 'CA global');
  // GMV livrées (item total = Montant HT + Remise, Remise 0 ici) : 525,00.
  assert.equal(kpi('kpiGmvLivrees'), '525,00 TND', 'GMV global');
  // S47 (16→22 nov.) : 4 commandes, CA 75,00 TND.
  w.yassirOnWeekSelectChange('2026-11-16|2026-11-22|S47');
  await wait(300);
  assert.equal(kpi('kpiTotalOrders'), '4', 'total S47');
  assert.equal(kpi('kpiFoodOrders'), '4', 'food S47');
  assert.equal(kpi('kpiTotalCa'), '75,00 TND', 'CA S47');
  assert.equal(kpi('kpiGmvLivrees'), '375,00 TND', 'GMV S47');
  // S43 (19→25 oct.) : 2 commandes, CA 30,00 TND.
  w.yassirOnWeekSelectChange('2026-10-19|2026-10-25|S43');
  await wait(300);
  assert.equal(kpi('kpiTotalOrders'), '2', 'total S43');
  assert.equal(kpi('kpiTotalCa'), '30,00 TND', 'CA S43');
  assert.equal(kpi('kpiGmvLivrees'), '150,00 TND', 'GMV S43');
  // Semaine vide (S47 2027, choisie par erreur — le libellé n'affiche pas
  // l'année) : plus aucun chiffre figé du global, la section se masque et
  // les compteurs sont à 0.
  w.yassirOnWeekSelectChange('2027-11-22|2027-11-28|S47');
  await wait(300);
  assert.ok(w.document.getElementById('kpiSection').classList.contains('hidden'), 'la section KPI doit se masquer sur une période vide');
  assert.equal(kpi('kpiTotalOrders'), '0', 'total période vide (global figé !)');
  assert.equal(kpi('kpiTotalCa'), '0,00 TND', 'CA période vide (global figé !)');
  assert.equal(kpi('kpiGmvLivrees'), '0,00 TND', 'GMV période vide (global figé !)');
  // Retour à toute la période : les totaux globaux reviennent.
  w.yassirOnWeekSelectChange('');
  await wait(300);
  assert.equal(kpi('kpiTotalOrders'), '6', 'total global après retour');
  assert.equal(kpi('kpiTotalCa'), '105,00 TND', 'CA global après retour');
  assert.equal(kpi('kpiGmvLivrees'), '525,00 TND', 'GMV global après retour');
  assert.equal(errors.length, 0, 'erreurs JS inattendues : ' + errors.join(' | '));
});

test('KPI : les cartes suivent un changement de date jour par jour et les préréglages', async () => {
  const w = bootKool({ data: koolCsvDataKpi });
  await login(w, 'proprio', 'Proprio-Test-123');
  await w.yassirSyncKoolSheets(true);
  await wait(600);
  w.yassirSwitchBrand('kool');
  await wait(600);
  const kpi = (id) => w.document.getElementById(id).textContent;
  assert.equal(kpi('kpiTotalOrders'), '6', 'total global');
  assert.equal(kpi('kpiGmvLivrees'), '525,00 TND', 'GMV global');
  // Un seul jour (16/11) : 2 commandes, CA 60,00 TND (20 % × 300).
  w.document.getElementById('filterDateStart').value = '2026-11-16';
  w.document.getElementById('filterDateEnd').value = '2026-11-16';
  w.yassirOnDateRangeChange();
  await wait(300);
  assert.equal(kpi('kpiTotalOrders'), '2', 'total 16/11');
  assert.equal(kpi('kpiTotalCa'), '60,00 TND', 'CA 16/11');
  assert.equal(kpi('kpiGmvLivrees'), '300,00 TND', 'GMV 16/11');
  // Préréglage 7 jours (depuis la date max 22/11 → 16→22/11) : 4 commandes, CA 75,00 TND.
  w.yassirApplyDatePreset('LAST_7');
  await wait(300);
  assert.equal(kpi('kpiTotalOrders'), '4', 'total 7 derniers jours');
  assert.equal(kpi('kpiTotalCa'), '75,00 TND', 'CA 7 derniers jours');
  assert.equal(kpi('kpiGmvLivrees'), '375,00 TND', 'GMV 7 derniers jours');
  // Préréglage Tout : retour au global.
  w.yassirApplyDatePreset('ALL');
  await wait(300);
  assert.equal(kpi('kpiTotalOrders'), '6', 'total global après Tout');
  assert.equal(kpi('kpiTotalCa'), '105,00 TND', 'CA global après Tout');
  assert.equal(kpi('kpiGmvLivrees'), '525,00 TND', 'GMV global après Tout');
  assert.equal(errors.length, 0, 'erreurs JS inattendues : ' + errors.join(' | '));
});

test('Item 4 : avertissement « modifications temporaires » visible pour le proprio, masqué pour les AM', async () => {
  const w = boot();
  await login(w, 'proprio', 'Proprio-Test-123');
  const warn = w.document.getElementById('commTempWarning');
  assert.ok(warn, 'bandeau d\u2019avertissement commissions absent');
  assert.equal(warn.classList.contains('hidden'), false, 'avertissement masqué pour le proprio');
  assert.ok(warn.textContent.includes('temporaires'), 'texte d\u2019avertissement commissions incorrect');
  assert.ok(w.document.getElementById('ownerPortfolioAdminSection').textContent.includes('temporaires'), 'avertissement portefeuilles absent');
  assert.ok(w.document.getElementById('editRestoModal').textContent.includes('temporaire'), 'avertissement modale édition absent');
  const w2 = boot();
  await login(w2, 'omar.beldi', 'Omar-Test-12345');
  assert.equal(w2.document.getElementById('commTempWarning').classList.contains('hidden'), true, 'avertissement visible pour un AM');
  assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
});

// ---- Item 5a (audit 2026-11-27) : correspondance EXACTE article ↔ règle ----
test('Item 5a : association article-règle exacte, jamais par sous-chaîne, jamais de repli', () => {
  const w = boot();
  w.koolOrderItemsByOrderId = new Map([
    ['cmd-1', [
      { article: 'Pizza Margherita', category: 'Pizza', quantity: 1, unitPrice: 20, originalPrice: 20, discountPrice: 16 },
      { article: 'Pizza Margherita XL', category: 'Pizza', quantity: 1, unitPrice: 25, originalPrice: 25, discountPrice: 20 },
      { article: 'Tacos Poulet', category: 'Tacos', quantity: 2, unitPrice: 9, originalPrice: 9, discountPrice: 8 },
      { article: 'Burger Classic', category: 'Super Promo', quantity: 1, unitPrice: 15, originalPrice: 15, discountPrice: 12 }
    ]]
  ]);
  const regles = [
    { restaurant: 'Resto Test', details: 'Pizza Margherita', tag: 'Discount', partPct: 10 },
    { restaurant: 'Resto Test', details: 'Super Promo', tag: 'Pack', partPct: 0 }
  ];
  const res = w.yassirCalculerParticipationArticlesKool('CMD-1', regles);
  // Pizza Margherita : règle exacte (plateforme 10 % × 20 = 2.00, resto 4.00 − 2.00 = 2.00).
  // Burger Classic (catégorie Super Promo) : règle « Super Promo » à 0 % (resto 3.00).
  assert.equal(res.matchedItemsCount, 2, 'articles rattachés : ' + JSON.stringify(res.breakdown));
  assert.equal(res.costTnd, 5, 'part restaurant : ' + res.costTnd);
  assert.equal(res.discountTotalTnd, 7, 'remise rattachée : ' + res.discountTotalTnd);
  // « Pizza Margherita XL » n'est PAS « Pizza Margherita » (5.00) et « Tacos Poulet »
  // n'a aucune règle (2.00) : tous deux « non attribués », jamais rattachés à une règle.
  assert.equal(res.unattributedTnd, 7, 'montant non attribué : ' + res.unattributedTnd);
  assert.equal(res.unattributedCount, 3, 'articles non attribués : ' + res.unattributedCount);
  assert.equal(res.unattributedBreakdown.length, 2, 'détail non attribué incomplet');
  // Sous-chaîne interdite : une règle « Pizza » ne doit PAS s'appliquer à « Pizza Margherita ».
  const res2 = w.yassirCalculerParticipationArticlesKool('CMD-1', [{ restaurant: 'Resto Test', details: 'Pizza', tag: 'Discount', partPct: 50 }]);
  assert.equal(res2.matchedItemsCount, 0, 'la règle « Pizza » a attrapé des articles par sous-chaîne');
  assert.equal(res2.unattributedTnd, 14, 'tout doit être non attribué : ' + res2.unattributedTnd);
  assert.equal(res2.unattributedCount, 5, 'tous les articles doivent être non attribués');
  // Sans aucune règle : tout est non attribué (l'ancien repli sur articleRules[0] est supprimé).
  const res3 = w.yassirCalculerParticipationArticlesKool('CMD-1', []);
  assert.equal(res3.matchedItemsCount, 0, 'sans règle, rien ne doit être rattaché');
  assert.equal(res3.unattributedTnd, 14, 'sans règle, tout est non attribué');
  assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
});

// Correctif 3 (décision utilisateur 2026-11-27, assouplissement Pack/BOGOF) :
// les libellés de règles sont des phrases, jamais égales au nom de l'article —
// en octobre, 0 TND rattaché, 100 % « non attribué ». Pour une règle Pack/BOGOF,
// l'article se rattache quand son nom normalisé est CONTENU dans le libellé.
test('Pack/BOGOF : un article se rattache quand son nom est contenu dans le libellé de la règle', () => {
  const w = boot();
  w.koolOrderItemsByOrderId = new Map([
    ['cmd-2', [
      { article: 'Makloub viande hachée', category: 'Sandwich', quantity: 1, unitPrice: 20, originalPrice: 20, discountPrice: 10 },
      { article: 'Pizza Margherita', category: 'Pizza', quantity: 1, unitPrice: 12, originalPrice: 12, discountPrice: 6 },
      { article: 'Tacos Poulet', category: 'Tacos', quantity: 1, unitPrice: 9, originalPrice: 9, discountPrice: 8 }
    ]]
  ]);
  const regles = [
    { restaurant: 'Resto Test', details: '1 Makloub viande hachée achetée 20 dt = 1 makloub offerte', tag: 'Pack', partPct: 10 },
    { restaurant: 'Resto Test', details: 'Offre BOGOF Pizza Margherita', tag: 'BOGOF', partPct: 10 },
    { restaurant: 'Resto Test', details: 'Pack Burger Classic : 2 achetés = 1 offert', tag: 'Pack', partPct: 10 }
  ];
  const res = w.yassirCalculerParticipationArticlesKool('CMD-2', regles);
  // Makloub : rattaché par le tag Pack + nom dans le libellé (remise 10, plateforme 10 % × 20 = 2, resto 8).
  // Pizza Margherita : rattachée par le libellé BOGOF (remise 6, plateforme 10 % × 12 = 1,2, resto 4,8).
  assert.equal(res.matchedItemsCount, 2, 'articles rattachés : ' + JSON.stringify(res.breakdown));
  assert.equal(res.costTnd, 12.8, 'part restaurant : ' + res.costTnd);
  assert.equal(res.discountTotalTnd, 16, 'remise rattachée : ' + res.discountTotalTnd);
  // Tacos Poulet : aucun libellé ne contient son nom → « non attribué », jamais rattaché.
  assert.equal(res.unattributedTnd, 1, 'montant non attribué : ' + res.unattributedTnd);
  assert.equal(res.unattributedCount, 1, 'articles non attribués : ' + res.unattributedCount);
  // Pas de repli sur la première règle : avec la seule règle « Pack Burger Classic »,
  // aucun des trois articles ne doit être rattaché.
  const res2 = w.yassirCalculerParticipationArticlesKool('CMD-2', [regles[2]]);
  assert.equal(res2.matchedItemsCount, 0, 'la règle Pack Burger a attrapé des articles par repli');
  assert.equal(res2.unattributedTnd, 17, 'tout doit être non attribué : ' + res2.unattributedTnd);
  assert.equal(res2.unattributedCount, 3, 'tous les articles doivent être non attribués');
  assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
});

// ---- Item 5b (audit 2026-11-27) : règles de secours lues depuis /api/bootstrap ----
test('Item 5b : règles de secours depuis la config KV (plus rien en dur) + bandeau d\u2019avertissement', async () => {
  const prevConfig = store.get('config');
  const reglesSecours = [{ area: 'Test', restaurant: 'resto secours', cPct: 100, tag: 'Discount', am: 'Test AM', partPct: 10, startDate: '2026-11-01', endDate: '2026-11-30', periode: 'Secours Test' }];
  try {
    const cfg = JSON.parse(prevConfig);
    cfg.defaultOffreRules = reglesSecours;
    store.set('config', JSON.stringify(cfg));
    const w = boot();
    // La feuille Offre Participation simulée est illisible : la synchro
    // échoue, les règles de secours du bootstrap restent utilisées.
    googleFailTabs.add('Offre Participation');
    await login(w, 'proprio', 'Proprio-Test-123');
    // Les règles de secours arrivent par le bootstrap, pas par le dépôt.
    const lues = w.yassirGetDefaultOffreParticipationRules();
    assert.equal(lues.length, 1, 'règles de secours non lues depuis le bootstrap');
    assert.equal(lues[0].restaurant, 'resto secours', 'règle de secours incorrecte');
    // Aucune règle en dur ne reste dans le code source ni dans le bundle construit.
    const etatSrc = readFileSync('src/js/04-state.js', 'utf8');
    assert.ok(!etatSrc.includes('route 66 menzah 6'), 'règle Black Friday encore en dur dans 04-state.js');
    assert.ok(!etatSrc.includes('tacos chaneb nabeul'), 'règle Black Friday encore en dur dans 04-state.js');
    assert.ok(!etatSrc.includes('DEFAULT_OFFRE_PARTICIPATION_RULES = ['), 'tableau de règles encore en dur dans 04-state.js');
    assert.ok(!bundle.includes('route 66 menzah 6'), 'règle Black Friday encore dans le bundle');
    // Le panneau Participation affiche l'avertissement « règles de secours ».
    w.yassirSetParticipationView('article');
    const fb = w.document.getElementById('partFallbackBanner');
    assert.ok(fb, 'bandeau règles de secours absent');
    assert.equal(fb.classList.contains('hidden'), false, 'bandeau règles de secours masqué alors que le repli est utilisé');
    assert.ok(fb.textContent.includes('EXPIRÉES'), 'le bandeau ne dit pas que les règles sont expirées : ' + fb.textContent);
    assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
  } finally {
    googleFailTabs.delete('Offre Participation');
    store.set('config', prevConfig);
  }
});

// ---- G3 suite (2026-11-27) : /api/bootstrap restreint pour les non-proprio ----
test('G3 bootstrap restreint : un AM ne reçoit ni les IDs des classeurs ni les règles de secours', async () => {
  const prevConfig = store.get('config');
  const reglesSecours = [{ area: 'Test', restaurant: 'resto secours', cPct: 100, tag: 'Discount', am: 'Test AM', partPct: 10, startDate: '2026-11-01', endDate: '2026-11-30', periode: 'Secours Test' }];
  try {
    const cfg = JSON.parse(prevConfig);
    cfg.defaultOffreRules = reglesSecours;
    store.set('config', JSON.stringify(cfg));
    const w = boot();
    await login(w, 'omar.beldi', 'Omar-Test-12345');
    // L'AM ne reçoit pas les règles de secours : le repli ne s'applique pas.
    assert.equal(w.yassirGetDefaultOffreParticipationRules().length, 0, 'un AM ne doit pas recevoir les règles de secours du bootstrap');
    // Le front fonctionne quand même : écran applicatif visible, pas d'erreur JS.
    assert.equal(w.document.getElementById('appWrapper').classList.contains('hidden'), false, 'application non affichée après connexion AM');
    assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
  } finally {
    store.set('config', prevConfig);
  }
});

// ---- Item 5c (audit 2026-11-27) : purgerNombre, le dernier séparateur est décimal ----
test('Item 5c : purgerNombre lit le dernier séparateur comme décimal', () => {
  const w = boot();
  const pn = w.yassirPurgerNombre;
  assert.equal(pn('1,234.50'), 1234.5, 'format US 1,234.50');
  assert.equal(pn('1.234,50'), 1234.5, 'format FR 1.234,50');
  assert.equal(pn('1 234,50'), 1234.5, 'format FR avec espace 1 234,50');
  assert.equal(pn('1 234 567,89'), 1234567.89, 'grands nombres avec espaces');
  assert.equal(pn('42'), 42, 'entier simple');
  assert.equal(pn('10.5'), 10.5, 'décimal simple point');
  assert.equal(pn('10,5'), 10.5, 'décimal simple virgule');
  assert.equal(pn('1,234'), 1.234, 'une seule virgule = décimale');
  assert.equal(pn(123), 123, 'nombre déjà numérique');
  assert.equal(pn(''), 0, 'chaîne vide');
  assert.equal(pn(null), 0, 'null');
  assert.equal(pn('abc'), 0, 'texte non numérique');
  assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
});

// ---- Item 10a : SUPPRIMÉ (G3 suite) — le téléchargement XLSX direct du
// classeur n'existe plus : le Worker lit les feuilles et sert les pages via
// /api/sheets/:source (cache KV 5 min côté serveur). Remplacé par les tests
// G3 (lecture paginée, garde manuelle, échec isolé, Budget) plus haut.

// ---- Item 10b/10c (audit 2026-11-27) : marque active seulement + statut par source ----
test('Item 10b/10c : à la connexion, seules les synchros de la marque active + statut par source', async () => {
  const w = boot();
  const calls = [];
  const stubOk = (name) => () => { calls.push(name); w.yassirNoterStatutSynchro(name, true); return Promise.resolve(); };
  const stubKo = (name) => () => { calls.push(name); w.yassirNoterStatutSynchro(name, false); return Promise.resolve(); };
  w.yassirSyncAllFromGoogleSheets = stubOk('Portefeuilles & Comm.');
  w.yassirSyncHistoricalSheets = stubOk('Octobre & Novembre');
  w.yassirSyncBudgetSheet = stubKo('Budget');
  w.yassirSyncRestoStatusSheet = stubOk('Statut Active/Inactive');
  w.yassirSyncOffreParticipationSheet = stubOk('Participation Offres');
  w.yassirSync2025Sheet = stubOk('Données 2025 (YoY)');
  w.yassirSyncKoolSheets = () => { calls.push('Kool'); return Promise.resolve(); };
  await login(w, 'proprio', 'Proprio-Test-123');
  await wait(1200);
  assert.deepEqual(calls, ['Portefeuilles & Comm.', 'Octobre & Novembre', 'Budget', 'Statut Active/Inactive', 'Participation Offres', 'Données 2025 (YoY)'], 'synchros lancées à la connexion (Yassir) : Kool ne doit pas tourner en mode Yassir');
  const lbl = w.document.getElementById('footerLastSyncLabel').textContent;
  assert.ok(lbl.includes('Sync partielle'), 'le pied de page annonce un succès alors que Budget est en échec : ' + lbl);
  assert.ok(lbl.includes('5/6 OK'), 'compteur OK incorrect : ' + lbl);
  assert.ok(lbl.includes('Budget'), 'la source en échec n’est pas nommée : ' + lbl);
  assert.ok(!lbl.includes('Données synchronisées à'), 'ancien message de succès inconditionnel toujours présent : ' + lbl);
  // Marque Kool : seules Kool + Budget sont lancées.
  w.yassirSyncKoolSheets = stubOk('Kool');
  w.yassirSyncBudgetSheet = stubOk('Budget');
  w.yassirSwitchBrand('kool');
  await wait(600);
  calls.length = 0;
  await w.yassirSyncConnexion();
  assert.deepEqual(calls, ['Kool', 'Budget'], 'synchros lancées à la connexion (Kool) : les 6 synchros Yassir ne doivent pas tourner en mode Kool');
  const lbl2 = w.document.getElementById('footerLastSyncLabel').textContent;
  assert.ok(lbl2.includes('Données synchronisées à'), 'succès complet non annoncé en Kool : ' + lbl2);
  assert.ok(lbl2.includes('2/2 sources OK'), 'compteur OK Kool incorrect : ' + lbl2);
  assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
});

// ---- Item 11a (audit 2026-11-27) : SheetJS + Chart.js chargés après la connexion ----
test('Item 11a : chargement différé — la connexion fonctionne même si les libs lourdes sont absentes', async () => {
  const w = boot();
  // Simule une page de connexion sans SheetJS ni Chart.js (chargement différé).
  delete w.XLSX;
  delete w.Chart;
  assert.equal(w.yassirChargerLibsLourdes && typeof w.yassirChargerLibsLourdes, 'function', 'chargeur différé absent');
  const pretes = await w.yassirLibsLourdesPretes();
  assert.equal(typeof pretes, 'boolean', 'le chargeur doit résoudre un booléen, jamais rejeter');
  // La connexion fonctionne quand même.
  await login(w, 'proprio', 'Proprio-Test-123');
  assert.equal(w.document.getElementById('appWrapper').classList.contains('hidden'), false, 'l’app ne s’ouvre pas sans les libs');
  assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
});


test('Garde anti-date (2026-11-27, bug CA/GMV) : purgerNombre rejette les dates complètes', () => {
  const w = boot();
  const pn = w.yassirPurgerNombre;
  // Les colonnes montant de Data Yassir contiennent des cellules date
  // (format « d.m ») : une date complète ne doit jamais être sommée comme
  // un montant (« 31.05.2026 » valait 3 105,20 ; « 2026-11-26 » valait 2 026 ;
  // CA semaine 48 à −76 618 611,24 TND).
  assert.equal(pn('31.05.2026'), 0, 'date jj.mm.aaaa');
  assert.equal(pn('31/05/2026'), 0, 'date jj/mm/aaaa');
  assert.equal(pn('2026-11-26'), 0, 'date ISO aaaa-mm-jj');
  assert.equal(pn('2026-11-26 / 00:36:36'), 0, 'horodatage');
  assert.equal(pn(new w.Date(2026, 4, 31)), 0, 'objet Date (ancien import XLSX cellDates:true)');
  // « 31.5 » (jour.mois sans année) reste ambigu : c'est aussi un montant.
  assert.equal(pn('31.5'), 31.5, 'jour.mois sans année : montant conservé');
  // Les montants normaux ne sont pas affectés.
  assert.equal(pn('1.234,50'), 1234.5, 'format FR intact');
  assert.equal(pn('1234.57'), 1234.57, 'décimal simple intact');
  assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
});


test('End Date lue (2026-11-27, simulation Participation) : une règle expire', () => {
  const w = boot();
  // Avant : le prédicat idxEnd contenait h.includes('au') et « restAUrant
  // name » (colonne 1) était pris pour End Date — endDate valait '' pour
  // TOUTES les règles, aucune n'expirait jamais (les Pack 01–15/11
  // s'appliquaient aussi après le 15/11).
  const rows = [
    ['Area', 'Restaurant Name', 'C %', 'TAG', 'Responsable Account', 'Répartition', 'Participation de C %', "Détails de l'offre", 'Start Date', 'End Date', 'Période', 'APP'],
    ['Tunis', 'Tacos Chaneb Bardo', '20', 'Pack', 'Aziza Souli', '', '0', 'Tacos poulet pané + Boisson + frite = 12,9 au lieu de 18,4', '01/11/2026', '15/11/2026', '', 'Yassir']
  ];
  const rules = w.yassirParseOffreParticipationRows(rows, 'Yassir');
  assert.equal(rules.length, 1);
  assert.equal(rules[0].startDate, '2026-11-01', 'Start Date lue');
  assert.equal(rules[0].endDate, '2026-11-15', 'End Date lue (pas le nom du restaurant)');
  assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
});


test('BOGOF classé offre article (2026-11-27, simulation Participation)', () => {
  const w = boot();
  const estCarte = w.yassirEstOffreTouteLaCarteKool;
  // « 1 pizza achetée = 1 offerte » est une offre article, pas « toute la
  // carte » : avant, le repli « true par défaut » la comptait en vue carte
  // et l'excluait de la vue article.
  assert.equal(estCarte({ tag: 'BOGOF', details: '1 pizza achetée = 1 offerte', periode: '' }), false, 'BOGOF = article');
  assert.equal(estCarte({ tag: 'Pack', details: 'Tacos + boisson', periode: '' }), false, 'Pack = article (déjà)');
  assert.equal(estCarte({ tag: 'Discount', details: '40% sur tt la carte', periode: '' }), true, 'Discount carte = carte');
  assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
});

// ---- Item 10a : SUPPRIMÉ (G3 suite) — le téléchargement XLSX direct du
// classeur n'existe plus : le Worker lit les feuilles et sert les pages via
// /api/sheets/:source (cache KV 5 min côté serveur). Remplacé par les tests
// G3 (lecture paginée, garde manuelle, échec isolé, Budget) plus haut.

// ---- Assistant IA (Gemini) dans le site ----
// Dates relatives à aujourd'hui (jamais figées) : mardi le plus récent,
// lundi de la semaine en cours, lundi de la semaine précédente.
const _asstDdmmyyyy = (d) => String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
const _asstIso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const _asstPlusJours = (d, n) => { const c = new Date(d); c.setDate(c.getDate() + n); return c; };
const _asstSemaineCle = (d) => {
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
  const annee = dt.getUTCFullYear();
  const debut = new Date(Date.UTC(annee, 0, 1));
  return annee + '-S' + String(Math.ceil((((dt - debut) / 86400000) + 1) / 7)).padStart(2, '0');
};
const _asstDates = () => {
  const auj = new Date();
  const mardi = _asstPlusJours(auj, -((auj.getDay() + 5) % 7));
  const lundiSem = _asstPlusJours(auj, -((auj.getDay() + 6) % 7));
  const lundiPrec = _asstPlusJours(lundiSem, -7);
  return { auj, mardi, lundiSem, lundiPrec };
};

test('Assistant IA : contexte — Babke mardi (jour) et Oishi semaine vs semaine dernière', async () => {
  const w = boot();
  await login(w, 'proprio', 'Proprio-Test-123');
  const { mardi, lundiSem, lundiPrec } = _asstDates();
  const makeXlsxFile = (aoa, sheetName, fileName) => {
    const wb = w.XLSX.utils.book_new();
    w.XLSX.utils.book_append_sheet(wb, w.XLSX.utils.aoa_to_sheet(aoa), sheetName);
    const buf = w.XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    return new w.File([buf], fileName, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  };
  // Babke : 3 commandes mardi (100 + 50 + 30), 1 lundi ; Oishi : 5 cette
  // semaine (lundi), 2 la semaine dernière (lundi) ; un resto témoin mardi.
  const dataAoa = [TARGET_HEADERS_TEST.slice(),
    yassirRow(_asstDdmmyyyy(mardi), 'YAF-9001', 'Babke Kebab Sousse', 100, 0, '', ''),
    yassirRow(_asstDdmmyyyy(mardi), 'YAF-9002', 'Babke Kebab Sousse', 50, 0, '', ''),
    yassirRow(_asstDdmmyyyy(mardi), 'YAF-9003', 'Babke Kebab Sousse', 30, 0, '', ''),
    yassirRow(_asstDdmmyyyy(lundiSem), 'YAF-9004', 'Babke Kebab Sousse', 40, 0, '', ''),
    yassirRow(_asstDdmmyyyy(lundiSem), 'YAF-9011', 'Oishi', 20, 0, '', ''),
    yassirRow(_asstDdmmyyyy(lundiSem), 'YAF-9012', 'Oishi', 20, 0, '', ''),
    yassirRow(_asstDdmmyyyy(lundiSem), 'YAF-9013', 'Oishi', 20, 0, '', ''),
    yassirRow(_asstDdmmyyyy(lundiSem), 'YAF-9014', 'Oishi', 20, 0, '', ''),
    yassirRow(_asstDdmmyyyy(lundiSem), 'YAF-9015', 'Oishi', 20, 0, '', ''),
    yassirRow(_asstDdmmyyyy(lundiPrec), 'YAF-9021', 'Oishi', 20, 0, '', ''),
    yassirRow(_asstDdmmyyyy(lundiPrec), 'YAF-9022', 'Oishi', 20, 0, '', ''),
    yassirRow(_asstDdmmyyyy(mardi), 'YAF-9031', 'Resto Temoin', 10, 0, '', '')
  ];
  w.yassirOnMainFileChange({ target: { files: [makeXlsxFile(dataAoa, 'Data exp', 'data-exp.xlsx')], value: 'x' } });
  await wait(1200);

  // Question 1 (cas de test utilisateur) : Babke mardi.
  const ctxBabke = w.yassirConstruireContexteAssistant('restaurant Babke, 9adech amal men commande nhar ethleth ?', Date.now());
  assert.ok(ctxBabke.includes('Babke'), 'Babke absent du contexte');
  assert.ok(ctxBabke.includes(_asstIso(mardi) + ' (mardi) : 3 reçues, 3 livrées, CA 180.00 TND'), 'ligne mardi de Babke inattendue : ' + ctxBabke);
  // Le resto témoin n'est pas détaillé quand on demande Babke (il peut
  // apparaître au TOP 10, jamais dans « RESTAURANTS DEMANDÉS »).
  const apresDemandes = ctxBabke.split('RESTAURANTS DEMANDÉS :')[1] || '';
  assert.ok(!apresDemandes.includes('Resto Temoin'), 'le resto témoin ne doit pas être détaillé pour Babke');
  // Contexte borné (jamais de lignes brutes).
  assert.ok(ctxBabke.length < 12000, 'contexte trop grand : ' + ctxBabke.length);

  // Question 2 (cas de test utilisateur) : Oishi, cette semaine vs la dernière.
  const ctxOishi = w.yassirConstruireContexteAssistant('restaurant Oishi, 9adech amal e jem3a hethi par rapport e jem3a elli fetet ?', Date.now());
  const semCour = _asstSemaineCle(lundiSem);
  const semPrec = _asstSemaineCle(lundiPrec);
  assert.ok(ctxOishi.includes('Oishi'), 'Oishi absent du contexte');
  assert.ok(ctxOishi.includes(semCour + ' : 5 reçues, 5 livrées, CA 100.00 TND'), 'semaine en cours d\'Oishi inattendue : ' + ctxOishi);
  assert.ok(ctxOishi.includes(semPrec + ' : 2 reçues, 2 livrées, CA 40.00 TND'), 'semaine précédente d\'Oishi inattendue : ' + ctxOishi);
  assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
});

test('Assistant IA : panneau — bouton après connexion, envoi, réponse insérée en texte (XSS impossible)', async () => {
  const w = boot();
  // Avant connexion : bouton caché.
  assert.equal(w.document.getElementById('btnAssistantIA').classList.contains('hidden'), true);
  await login(w, 'proprio', 'Proprio-Test-123');
  // Après connexion : bouton visible.
  const btn = w.document.getElementById('btnAssistantIA');
  assert.equal(btn.classList.contains('hidden'), false, 'bouton assistant caché après connexion');
  // Micro absent sous jsdom (pas de SpeechRecognition) : bouton micro caché à l'ouverture.
  btn.click();
  await wait(200);
  const panel = w.document.getElementById('assistantIAPanel');
  assert.equal(panel.classList.contains('hidden'), false, 'panneau non ouvert');
  assert.ok(w.document.getElementById('assistantIABrand').textContent.includes('Yassir'), 'marque active absente de l\'en-tête');
  assert.equal(w.document.getElementById('assistantIAMic').classList.contains('hidden'), true, 'micro visible sans SpeechRecognition');

  // Gemini simulé : la réponse contient une balise piégée.
  // Clé Gemini de test : sans elle, le Worker répond 503 (comportement
  // voulu en production). La vraie clé n'est jamais écrite ici.
  // On utilise l'env du fichier (ligne 111), celui que le harnais passe
  // à handle() — worker/src/index.js n'exporte pas `env`.
  env.GEMINI_API_KEY = 'CLE_TEST_SIMULEE';
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('generativelanguage.googleapis.com')) {
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'Babke a fait 3 commandes mardi. <img src=x onerror=alert(1)>' }] } }] }) };
    }
    return prevFetch(url, opts);
  };
  try {
    w.document.getElementById('assistantIAInput').value = 'Babke, combien de commandes mardi ?';
    w.document.getElementById('assistantIAEnvoyer').click();
    await wait(800);
    const zone = w.document.getElementById('assistantIAMessages');
    assert.ok(zone.textContent.includes('Babke a fait 3 commandes mardi.'), 'réponse absente : ' + zone.textContent);
    // La balise piégée est du TEXTE, jamais un élément : aucune img créée, aucune erreur.
    assert.equal(zone.querySelectorAll('img').length, 0, 'la réponse Gemini a créé un élément img (XSS)');
    assert.ok(zone.textContent.includes('<img src=x onerror=alert(1)>'), 'la réponse doit rester du texte littéral');
    assert.equal(errors.length, 0, 'erreurs JS : ' + JSON.stringify(errors));
  } finally {
    globalThis.fetch = prevFetch;
    delete env.GEMINI_API_KEY;
  }
});
