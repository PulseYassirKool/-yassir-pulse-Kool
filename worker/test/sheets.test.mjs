// Tests G3 (suite) : endpoints GET /api/sheets/:source filtrés par rôle/AM.
// Google Sheets est simulé (jeton + métadonnées + valeurs) ; les données sont
// simulées (jamais private/seed.json) ; aucune date absolue figée.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { handle, hashPassword } from '../src/index.js';
import { clearGoogleTokenCache } from '../src/google-sheets.js';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const serviceAccount = {
  type: 'service_account',
  project_id: 'projet-factures-483821',
  client_email: 'yassir-pulse@projet-factures-483821.iam.gserviceaccount.com',
  private_key: privateKeyPem
};

// Identifiants de classeurs simulés (format valide, jamais les vrais IDs).
const UNIQUE = 'UNIQUE00000000000000000000000001';
const OCT = 'OCT000000000000000000000000000001';
const NOV = 'NOV000000000000000000000000000001';
const DATA_KOOL = 'KOOL0000000000000000000000000001';
const DETAILS = 'DET000000000000000000000000000001';

// Données simulées par classeur et par onglet.
function cannedSheets() {
  return {
    [UNIQUE]: {
      omar: [
        ['Ville', 'Segment', 'restaurant Name', 'APP'],
        ['Tunis', 'A', 'Resto Omar 1', 'Yassir'],
        ['Tunis', 'A', 'Resto Omar Kool', 'Kool'],
        ['Sousse', 'B', 'Resto Commun', '']
      ],
      Eya: [
        ['Ville', 'Segment', 'restaurant Name', 'APP'],
        ['Tunis', 'A', 'Resto Eya 1', 'Yassir'],
        ['Tunis', 'A', 'Resto Eya Kool', 'Kool']
      ],
      Commissions: [
        ['Restaurant', 'Commission %', 'APP'],
        ['Resto Omar 1', '10', 'Yassir'],
        ['Resto Eya 1', '12', 'Yassir'],
        ['Resto Omar Kool', '8', 'Kool'],
        ['Resto Autre', '15', 'Yassir']
      ],
      'Offre Participation': [
        ['Area', 'Restaurant', 'C %', 'Tag', 'AM', 'Participation de C %', 'APP'],
        ['Tunis', 'Resto Omar 1', '30', 'Discount', 'Omar Beldi', '10', 'Yassir'],
        ['Tunis', 'Resto Omar Kool', '20', 'Discount', 'Omar Beldi', '10', 'Kool'],
        ['Tunis', 'Resto Eya 1', '25', 'Discount', 'Eya Majdoub', '10', 'Yassir']
      ],
      Budget: [
        ['AM', 'Budget', 'APP'],
        ['Omar Beldi', '100000', 'Yassir'],
        ['Eya Majdoub', '50000', 'Yassir'],
        ['Omar Beldi', '80000', 'Kool'],
        ['Global', '200000', 'Yassir']
      ],
      Statuts: [
        ['id', 'Restaurant Name', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10', 'Status'],
        ['1', 'Resto Omar 1', '', '', '', '', '', '', '', '', 'Active'],
        ['2', 'Resto Eya 1', '', '', '', '', '', '', '', '', 'Inactive'],
        ['3', 'Resto Autre', '', '', '', '', '', '', '', '', 'Active']
      ],
      '2025 Yassir': [
        ['Mois', 'Commandes', 'GMV'],
        ['2025-01', '100', '5000'],
        ['2025-02', '120', '6000']
      ],
      '2025 Kool': [
        ['Mois', 'Commandes', 'GMV'],
        ['2025-01', '50', '2500']
      ]
    },
    [OCT]: {
      'Data exp': [
        ['order id', 'order day', 'restaurant name', 'total'],
        ['1001', '2026-10-05', 'Resto Omar 1', '40'],
        ['1002', '2026-10-06', 'Resto Eya 1', '50'],
        ['1003', '2026-10-07', 'Resto Autre', '30']
      ],
      'Data 02-10': [
        ['order id', 'order day', 'restaurant name', 'total'],
        ['1002', '2026-10-06', 'Resto Eya 1', '55'],
        ['1004', '2026-10-08', 'Resto Omar 1', '25']
      ]
    },
    [NOV]: {
      'Data exp': [
        ['order id', 'order day', 'restaurant name', 'total'],
        ['2001', '2026-11-02', 'Resto Omar 1', '44']
      ]
    },
    [DATA_KOOL]: {
      Data: [
        ['Date', 'N° commande', 'Restaurant', 'Montant'],
        ['2026-11-02', 'CMD-1', 'Resto Omar Kool', '40'],
        ['2026-11-02', 'CMD-2', 'Resto Eya Kool', '50'],
        ['2026-11-03', 'CMD-3', 'Resto Autre', '30']
      ],
      'Data 02-11': [
        ['Date', 'N° commande', 'Restaurant', 'Montant'],
        ['2026-11-03', 'CMD-2', 'Resto Eya Kool', '55'],
        ['2026-11-04', 'CMD-4', 'Resto Omar Kool', '25']
      ]
    },
    [DETAILS]: {
      Articles: [
        ['N° commande', 'Article', 'Quantité', 'Prix'],
        ['CMD-1', 'Pizza', '1', '20'],
        ['CMD-1', 'Burger', '2', '20'],
        ['CMD-2', 'Salade', '1', '15'],
        ['CMD-3', 'Tacos', '1', '30'],
        ['CMD-9', 'Inconnu', '1', '9']
      ],
      'Articles 02-11': [
        ['N° commande', 'Article', 'Quantité', 'Prix'],
        ['CMD-1', 'Pizza', '1', '20'],
        ['CMD-4', 'Frites', '1', '10']
      ]
    }
  };
}
const GIDS = {
  [UNIQUE]: { omar: 1, Nour: 2, Eya: 3, Aziza: 4, Commissions: 9, 'Offre Participation': 10, Budget: 11, Statuts: 12, '2025 Yassir': 13, '2025 Kool': 14 },
  [OCT]: { 'Data exp': 0, 'Data 02-10': 5 },
  [NOV]: { 'Data exp': 1826888592 },
  [DATA_KOOL]: { Data: 0, 'Data 02-11': 6 },
  [DETAILS]: { Articles: 0, 'Articles 02-11': 7 }
};

let sheetsData = cannedSheets();
let failTabs = new Set(); // titres d'onglets dont la lecture échoue (403 simulé)
let failAllValues = false;

function mockGoogleFetch() {
  const calls = [];
  const fetchMock = async (url, opts) => {
    calls.push(String(url));
    if (String(url).includes('oauth2.googleapis.com/token')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'ya29.test-token', expires_in: 3600, token_type: 'Bearer' }) };
    }
    const m = String(url).match(/spreadsheets\/([A-Za-z0-9_-]+)(?:\/values\/([^?]+))?/);
    if (!m) throw new Error('URL inattendue : ' + url);
    const id = m[1];
    if (!m[2]) {
      // Métadonnées du classeur.
      const tabs = Object.keys(sheetsData[id] || {});
      return { ok: true, status: 200, json: async () => ({ sheets: tabs.map((t) => ({ properties: { sheetId: GIDS[id][t], title: t } })) }) };
    }
    // Lecture de valeurs : 'Titre'!A<début>:ZZ<fin>
    const range = decodeURIComponent(m[2]);
    const rm = range.match(/^'((?:[^']|'')+)'!A(\d+):ZZ(\d+)$/);
    if (!rm) throw new Error('Plage inattendue : ' + range);
    const title = rm[1].replace(/''/g, "'");
    if (failAllValues || failTabs.has(title)) {
      return { ok: false, status: 403, json: async () => ({ error: { code: 403, message: 'Forbidden' } }) };
    }
    const rows = (sheetsData[id] || {})[title] || [];
    const slice = rows.slice(Number(rm[2]) - 1, Number(rm[3]));
    return { ok: true, status: 200, json: async () => ({ range, majorDimension: 'ROWS', values: slice }) };
  };
  return { fetchMock, calls };
}

// KV simulé (get/put/delete, options ignorées sauf stockage de la valeur).
const kvStore = new Map();
const kv = {
  get: async (k, t) => (kvStore.has(k) ? (t === 'json' ? JSON.parse(kvStore.get(k)) : kvStore.get(k)) : null),
  put: async (k, v) => void kvStore.set(k, v),
  delete: async (k) => void kvStore.delete(k)
};
const env = { PULSE_KV: kv, JWT_SECRET: 'x'.repeat(40), LEGACY_SALT: 'SEL_HERITE::', ALLOWED_ORIGIN: 'https://app.test', GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount) };
const call = (method, path, body, token) => handle(new Request('https://api.test' + path, {
  method, body: body ? JSON.stringify(body) : undefined,
  headers: { Origin: 'https://app.test', ...(token ? { Authorization: 'Bearer ' + token } : {}) }
}), env).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})), headers: r.headers }));

const CONFIG = {
  live: {
    PORTFOLIOS_SHEET_ID: UNIQUE,
    PORTFOLIOS_MASTER_GIDS: [],
    PORTFOLIOS_TABS: [
      { tab: 'omar', altTabs: ['Omar', 'Omar Beldi', 'OMAR'], gid: '1', am: 'Omar Beldi' },
      { tab: 'Eya', altTabs: ['eya', 'Eya Majdoub', 'EYA'], gid: '3', am: 'Eya Majdoub' }
    ],
    COMMISSIONS_SHEET_ID: UNIQUE, COMMISSIONS_TAB: 'Commissions', COMMISSIONS_GID: '9',
    BUDGET_SHEET_ID: UNIQUE, BUDGET_GID: '11', BUDGET_TAB: 'Budget',
    RESTO_STATUS_SHEET_ID: UNIQUE, RESTO_STATUS_GID: '12',
    OFFRE_PARTICIPATION_SHEET_ID: UNIQUE, OFFRE_PARTICIPATION_GID: '10',
    HISTORICAL_2025_SHEET_ID: UNIQUE, HISTORICAL_2025_GID: '13',
    HISTORICAL_MONTHS: [
      { label: 'Octobre', sheetId: OCT, gid: '0', tab: 'Data exp' },
      { label: 'Novembre', sheetId: NOV, gid: '1826888592', tab: 'Data exp' }
    ]
  },
  kool: {
    DATA_SHEET_ID: DATA_KOOL, DATA_GID: '0',
    COMMISSION_SHEET_ID: UNIQUE, COMMISSION_TAB: 'Commissions', COMMISSION_ALT_TABS: ['Commissions'], COMMISSION_GID: '9',
    PORTFOLIOS_SHEET_ID: UNIQUE, PORTFOLIOS_GID: '1',
    OFFRE_PARTICIPATION_SHEET_ID: UNIQUE, OFFRE_PARTICIPATION_GID: '10',
    ORDER_ITEMS_SHEET_ID: DETAILS, ORDER_ITEMS_GID: '0',
    BUDGET_SHEET_ID: UNIQUE, BUDGET_GID: '11',
    HISTORICAL_2025_SHEET_ID: UNIQUE, HISTORICAL_2025_GID: '14'
  }
};

test.before(async () => {
  kvStore.set('accounts', JSON.stringify([
    { username: 'proprio', hash: await hashPassword('Secret-Proprio-1'), role: 'owner', displayName: 'P', amName: null, protected: true },
    { username: 'omar.beldi', hash: await hashPassword('Omar-Password-2'), role: 'am', displayName: 'Omar Beldi', amName: 'Omar Beldi', protected: false },
    { username: 'eya.majdoub', hash: await hashPassword('Eya-Password-2'), role: 'market_am', displayName: 'Eya Majdoub', amName: 'Eya Majdoub', protected: false },
    { username: 'viewer', hash: await hashPassword('Viewer-Password-2'), role: 'viewer_all', displayName: 'Viewer', amName: null, protected: false }
  ]));
  kvStore.set('config', JSON.stringify(CONFIG));
});

test.beforeEach(() => {
  sheetsData = cannedSheets();
  failTabs = new Set();
  failAllValues = false;
  clearGoogleTokenCache();
  for (const k of [...kvStore.keys()]) {
    if (k.startsWith('sheetcache:') || k.startsWith('activity:') || k === 'activity_log') kvStore.delete(k);
  }
});

async function login(username, password) {
  const r = await call('POST', '/api/login', { username, password });
  assert.equal(r.status, 200, 'connexion ' + username);
  return r.json.token;
}
function installMock() {
  const { fetchMock, calls } = mockGoogleFetch();
  globalThis.fetch = fetchMock;
  return calls;
}
function restoreFetch(original) { globalThis.fetch = original; }
const restoNames = (rows) => rows.slice(1).map((r) => r[2]);

test('401 sans jeton ; 400 source inconnue, marque invalide, pagination invalide', async () => {
  const originalFetch = globalThis.fetch;
  installMock();
  try {
    assert.equal((await call('GET', '/api/sheets/portfolios')).status, 401);
    const owner = await login('proprio', 'Secret-Proprio-1');
    assert.equal((await call('GET', '/api/sheets/bidon', null, owner)).status, 400);
    assert.equal((await call('GET', '/api/sheets/portfolios?brand=xxx', null, owner)).status, 400);
    assert.equal((await call('GET', '/api/sheets/portfolios?page=-1', null, owner)).status, 400);
    assert.equal((await call('GET', '/api/sheets/portfolios?pageSize=0', null, owner)).status, 400);
    assert.equal((await call('GET', '/api/sheets/portfolios?pageSize=20000', null, owner)).status, 400);
  } finally { restoreFetch(originalFetch); }
});

test('portefeuilles : AM ne voit que son onglet, proprio tout, Eya rien en Kool', async () => {
  const originalFetch = globalThis.fetch;
  installMock();
  try {
    const owner = await login('proprio', 'Secret-Proprio-1');
    const omar = await login('omar.beldi', 'Omar-Password-2');
    const eya = await login('eya.majdoub', 'Eya-Password-2');
    // AM Omar, marque Yassir : ses 2 lignes Yassir (APP vide gardée) + colonne AM.
    const rOmar = await call('GET', '/api/sheets/portfolios?brand=yassir', null, omar);
    assert.equal(rOmar.status, 200);
    assert.deepEqual(restoNames(rOmar.json.rows), ['Resto Omar 1', 'Resto Commun']);
    assert.equal(rOmar.json.rows[0][rOmar.json.rows[0].length - 1], 'AM');
    assert.ok(rOmar.json.rows.slice(1).every((r) => r[r.length - 1] === 'Omar Beldi'));
    assert.equal(rOmar.json.filtered, true);
    // AM Omar, marque Kool : ses 2 lignes Kool.
    const rKool = await call('GET', '/api/sheets/portfolios?brand=kool', null, omar);
    assert.deepEqual(restoNames(rKool.json.rows), ['Resto Omar Kool', 'Resto Commun']);
    // Eya en Kool : réponse vide, sans accès.
    const rEyaKool = await call('GET', '/api/sheets/portfolios?brand=kool', null, eya);
    assert.equal(rEyaKool.status, 200);
    assert.equal(rEyaKool.json.totalRows, 0);
    assert.deepEqual(rEyaKool.json.rows, []);
    assert.equal(rEyaKool.json.access, 'none');
    // Proprio Yassir : Omar (2) + Eya (1) = 3 lignes, jamais celles d'un autre AM filtrées.
    const rOwner = await call('GET', '/api/sheets/portfolios?brand=yassir', null, owner);
    assert.equal(rOwner.json.totalRows, 3);
    assert.ok(restoNames(rOwner.json.rows).includes('Resto Eya 1'));
    // Aucun identifiant de classeur dans les réponses.
    for (const r of [rOmar, rKool, rOwner]) {
      assert.ok(!JSON.stringify(r.json).includes(UNIQUE), 'ID de classeur exposé !');
    }
  } finally { restoreFetch(originalFetch); }
});

test('commissions / offres / budget / statuts : filtrage par portefeuille et par marque', async () => {
  const originalFetch = globalThis.fetch;
  installMock();
  try {
    const owner = await login('proprio', 'Secret-Proprio-1');
    const omar = await login('omar.beldi', 'Omar-Password-2');
    // Commissions Yassir Omar : uniquement Resto Omar 1 (pas Eya, pas Resto Autre).
    const comm = await call('GET', '/api/sheets/commissions?brand=yassir', null, omar);
    assert.equal(comm.json.totalRows, 1);
    assert.equal(comm.json.rows[1][0], 'Resto Omar 1');
    const commKool = await call('GET', '/api/sheets/commissions?brand=kool', null, omar);
    assert.equal(commKool.json.totalRows, 1);
    assert.equal(commKool.json.rows[1][0], 'Resto Omar Kool');
    const commOwner = await call('GET', '/api/sheets/commissions?brand=yassir', null, owner);
    assert.equal(commOwner.json.totalRows, 3); // Omar 1 + Eya 1 + Resto Autre
    // Offres Yassir Omar : 1 règle (Resto Omar 1).
    const offres = await call('GET', '/api/sheets/offres?brand=yassir', null, omar);
    assert.equal(offres.json.totalRows, 1);
    assert.equal(offres.json.rows[1][1], 'Resto Omar 1');
    // Budget Yassir Omar : sa ligne + la ligne Global, jamais celle d'Eya.
    const budget = await call('GET', '/api/sheets/budget?brand=yassir', null, omar);
    assert.equal(budget.json.totalRows, 2);
    assert.ok(JSON.stringify(budget.json.rows).includes('Omar Beldi'));
    assert.ok(JSON.stringify(budget.json.rows).includes('Global'));
    assert.ok(!JSON.stringify(budget.json.rows).includes('Eya Majdoub'));
    const budgetOwner = await call('GET', '/api/sheets/budget?brand=yassir', null, owner);
    assert.equal(budgetOwner.json.totalRows, 3);
    // Statuts Yassir Omar : uniquement Resto Omar 1 ; Kool : vide (feuille Yassir).
    const statuts = await call('GET', '/api/sheets/statuts?brand=yassir', null, omar);
    assert.equal(statuts.json.totalRows, 1);
    assert.equal(statuts.json.rows[1][1], 'Resto Omar 1');
    const statutsKool = await call('GET', '/api/sheets/statuts?brand=kool', null, omar);
    assert.equal(statutsKool.json.totalRows, 0);
    assert.equal(statutsKool.json.access, 'none');
  } finally { restoreFetch(originalFetch); }
});

test('hist2025 : pas de filtre restaurant ; Eya voit Yassir, rien en Kool', async () => {
  const originalFetch = globalThis.fetch;
  installMock();
  try {
    const eya = await login('eya.majdoub', 'Eya-Password-2');
    const hY = await call('GET', '/api/sheets/hist2025?brand=yassir', null, eya);
    assert.equal(hY.json.totalRows, 2);
    const hK = await call('GET', '/api/sheets/hist2025?brand=kool', null, eya);
    assert.equal(hK.json.totalRows, 0);
    assert.equal(hK.json.access, 'none');
  } finally { restoreFetch(originalFetch); }
});

test('data-kool multi-onglets : dédupe (2e écrase 1re), filtre AM, pagination', async () => {
  const originalFetch = globalThis.fetch;
  installMock();
  try {
    const owner = await login('proprio', 'Secret-Proprio-1');
    const omar = await login('omar.beldi', 'Omar-Password-2');
    // Proprio : 4 commandes (CMD-2 dédupliquée, 2e version : montant 55).
    const all = await call('GET', '/api/sheets/data-kool?brand=kool', null, owner);
    assert.equal(all.status, 200);
    assert.equal(all.json.totalRows, 4);
    assert.deepEqual(all.json.tabs, ['Data', 'Data 02-11']);
    const cmd2 = all.json.rows.find((r) => r[1] === 'CMD-2');
    assert.equal(cmd2[3], '55', 'la 2e occurrence écrase la 1re');
    // Pagination pageSize=2 : 2 pages, en-têtes répétés sur chaque page.
    const p0 = await call('GET', '/api/sheets/data-kool?brand=kool&page=0&pageSize=2', null, owner);
    assert.equal(p0.json.totalPages, 2);
    assert.equal(p0.json.rows.length, 3); // en-têtes + 2 lignes
    assert.deepEqual(p0.json.rows.slice(1).map((r) => r[1]), ['CMD-1', 'CMD-2']);
    const p1 = await call('GET', '/api/sheets/data-kool?brand=kool&page=1&pageSize=2', null, owner);
    assert.deepEqual(p1.json.rows.slice(1).map((r) => r[1]), ['CMD-3', 'CMD-4']);
    assert.deepEqual(p1.json.rows[0], p0.json.rows[0], 'mêmes en-têtes sur chaque page');
    // AM Omar : uniquement CMD-1 et CMD-4 (ses restaurants Kool).
    const rOmar = await call('GET', '/api/sheets/data-kool?brand=kool', null, omar);
    assert.equal(rOmar.json.totalRows, 2);
    assert.deepEqual(rOmar.json.rows.slice(1).map((r) => r[1]), ['CMD-1', 'CMD-4']);
    assert.equal(rOmar.json.filtered, true);
  } finally { restoreFetch(originalFetch); }
});

test('data-oct multi-onglets : dédupe et filtre AM (même N° commande, 2 onglets)', async () => {
  const originalFetch = globalThis.fetch;
  installMock();
  try {
    const owner = await login('proprio', 'Secret-Proprio-1');
    const omar = await login('omar.beldi', 'Omar-Password-2');
    const all = await call('GET', '/api/sheets/data-oct?brand=yassir', null, owner);
    assert.equal(all.json.totalRows, 4); // 1001, 1002 (55), 1003, 1004
    const o1002 = all.json.rows.find((r) => r[0] === '1002');
    assert.equal(o1002[3], '55');
    const rOmar = await call('GET', '/api/sheets/data-oct?brand=yassir', null, omar);
    assert.deepEqual(rOmar.json.rows.slice(1).map((r) => r[0]), ['1001', '1004']);
  } finally { restoreFetch(originalFetch); }
});

test('details-kool : filtrés par les N° de commande de la Data Kool de l\'AM', async () => {
  const originalFetch = globalThis.fetch;
  installMock();
  try {
    const omar = await login('omar.beldi', 'Omar-Password-2');
    const owner = await login('proprio', 'Secret-Proprio-1');
    // Omar : CMD-1 (Pizza + Burger, 2 lignes du même N° gardées), CMD-4 Frites.
    // CMD-1 Pizza en double entre onglets = 1 seule ligne. CMD-2/CMD-3/CMD-9 exclus.
    const r = await call('GET', '/api/sheets/details-kool?brand=kool', null, omar);
    assert.equal(r.status, 200);
    assert.equal(r.json.totalRows, 3);
    assert.deepEqual(r.json.rows.slice(1).map((x) => `${x[0]}:${x[1]}`), ['CMD-1:Pizza', 'CMD-1:Burger', 'CMD-4:Frites']);
    // Proprio : tout (6 lignes uniques : 5 + 2, Pizza doublée une fois).
    const rOwner = await call('GET', '/api/sheets/details-kool?brand=kool', null, owner);
    assert.equal(rOwner.json.totalRows, 6);
  } finally { restoreFetch(originalFetch); }
});

test('cache : 2e appel sans nouvelle lecture Google ; fresh=1 ignoré pour un AM, appliqué pour le proprio', async () => {
  const originalFetch = globalThis.fetch;
  const calls = installMock();
  try {
    const omar = await login('omar.beldi', 'Omar-Password-2');
    const owner = await login('proprio', 'Secret-Proprio-1');
    const valuesCalls = () => calls.filter((u) => u.includes('/values/')).length;
    const r1 = await call('GET', '/api/sheets/commissions?brand=yassir', null, omar);
    assert.equal(r1.json.cached, false);
    const n1 = valuesCalls();
    assert.ok(n1 > 0, 'la 1re lecture touche Google');
    const r2 = await call('GET', '/api/sheets/commissions?brand=yassir', null, omar);
    assert.equal(r2.json.cached, true);
    assert.equal(valuesCalls(), n1, '2e appel servi depuis le cache KV');
    // fresh=1 pour un AM : ignoré (aucune nouvelle lecture).
    const r3 = await call('GET', '/api/sheets/commissions?brand=yassir&fresh=1', null, omar);
    assert.equal(r3.json.cached, true);
    assert.equal(valuesCalls(), n1, 'fresh ignoré pour un AM');
    // fresh=1 pour le proprio : rechargement (nouvelles lectures).
    const r4 = await call('GET', '/api/sheets/commissions?brand=yassir&fresh=1', null, owner);
    assert.equal(r4.json.cached, false);
    assert.ok(valuesCalls() > n1, 'fresh appliqué pour le proprio');
  } finally { restoreFetch(originalFetch); }
});

test('erreurs Sheets : tout illisible -> 502 ; un onglet illisible -> 200 partiel', async () => {
  const originalFetch = globalThis.fetch;
  installMock();
  try {
    const owner = await login('proprio', 'Secret-Proprio-1');
    // Tout illisible.
    failAllValues = true;
    const bad = await call('GET', '/api/sheets/data-kool?brand=kool&fresh=1', null, owner);
    assert.equal(bad.status, 502);
    assert.equal(typeof bad.json.error, 'string');
    assert.ok(!JSON.stringify(bad.json).includes('Forbidden'), 'le message Google n’est pas propagé');
    // Un seul onglet illisible : partiel, les autres passent.
    failAllValues = false;
    failTabs = new Set(['Data 02-11']);
    const partial = await call('GET', '/api/sheets/data-kool?brand=kool&fresh=1', null, owner);
    assert.equal(partial.status, 200);
    assert.equal(partial.json.partial, true);
    assert.ok(partial.json.skippedTabs.includes('Data 02-11'));
    assert.equal(partial.json.totalRows, 3); // onglet Data seul
    assert.deepEqual(partial.json.tabs, ['Data']);
  } finally { restoreFetch(originalFetch); }
});

test('viewer_all voit tout comme le proprio (lecture seule)', async () => {
  const originalFetch = globalThis.fetch;
  installMock();
  try {
    const viewer = await login('viewer', 'Viewer-Password-2');
    const r = await call('GET', '/api/sheets/commissions?brand=yassir', null, viewer);
    assert.equal(r.status, 200);
    assert.equal(r.json.totalRows, 3);
    assert.equal(r.json.filtered, false);
  } finally { restoreFetch(originalFetch); }
});
