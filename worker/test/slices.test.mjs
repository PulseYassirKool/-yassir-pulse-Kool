// Tests du chargement par tranches (plan gratuit, 10 ms CPU / invocation).
// Google Sheets est simulé (jeton + métadonnées + valeurs) ; les données
// sont simulées (jamais private/seed.json) ; aucune date absolue figée.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { getSheetsSlice, getSheetsTabs, getSheetsData, SLICE_MAX_ROWS, clearSliceHeadersCache } from '../src/sheets.js';
import { clearGoogleTokenCache } from '../src/google-sheets.js';
import { handle, hashPassword } from '../src/index.js';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const saJson = JSON.stringify({
  type: 'service_account',
  client_email: 'test@projet-factures-483821.iam.gserviceaccount.com',
  private_key: privateKeyPem
});

const UNIQUE = 'UNIQUE00000000000000000000000001';
const DETAILS = 'DET000000000000000000000000000001';

const HEADERS = ['Order_id', 'date', 'Restaurant', 'Category', 'Article', 'Quantity', 'Unit price', 'Discount Price', 'Original Price', 'Type'];
function detailsRow(i, resto) {
  return [`ORD-${String(i).padStart(5, '0')}`, 'nov. 20, 2026, 12:00:00', resto, 'Sandwichs', 'Sandwich ' + (i % 7), 1, 10, 0, 10, 'Food'];
}
function cannedTabs() {
  const articles = [HEADERS];
  for (let i = 0; i < 300; i++) articles.push(detailsRow(i, 'Resto Octobre'));
  const feuille3 = [HEADERS];
  for (let i = 0; i < 2500; i++) feuille3.push(detailsRow(1000 + i, i % 3 === 0 ? 'Resto A' : 'Resto B'));
  return {
    [UNIQUE]: {
      omar: [
        ['Ville', 'Segment', 'restaurant Name', 'APP'],
        ['Tunis', 'A', 'Resto A', 'Kool'],
        ['Tunis', 'A', 'Resto B', 'Kool']
      ]
    },
    [DETAILS]: { 'Articles': articles, 'Feuille 3': feuille3 }
  };
}

function makeEnv(configObj, tabs) {
  const kv = new Map();
  const env = {
    GOOGLE_SERVICE_ACCOUNT_JSON: saJson,
    PULSE_KV: {
      async get(key, type) { const v = kv.get(key); if (v === undefined) return null; return type === 'json' ? JSON.parse(v) : v; },
      async put(key, value) { kv.set(key, typeof value === 'string' ? value : JSON.stringify(value)); }
    }
  };
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com/token')) return { ok: true, json: async () => ({ access_token: 'fake', expires_in: 3600 }) };
    if (u.includes('/v4/spreadsheets/') && u.includes('fields=sheets.properties')) {
      const id = u.split('/v4/spreadsheets/')[1].split('?')[0];
      const names = Object.keys(tabs[decodeURIComponent(id)] || {});
      return { ok: true, json: async () => ({ sheets: names.map((t, i) => ({ properties: { sheetId: i, title: t } })) }) };
    }
    if (u.includes('/v4/spreadsheets/') && u.includes('/values/')) {
      const dec = decodeURIComponent(u);
      const id = dec.split('/v4/spreadsheets/')[1].split('/values/')[0];
      const titleMatch = dec.match(/\/values\/'((?:[^']|'')+)'!/);
      const title = titleMatch ? titleMatch[1].replace(/''/g, "'") : '';
      const m = dec.match(/!A(\d+):ZZ(\d+)/);
      const start = m ? parseInt(m[1], 10) : 1;
      const end = m ? parseInt(m[2], 10) : start;
      const rows = (tabs[decodeURIComponent(id)] || {})[title] || [];
      return { ok: true, json: async () => ({ values: rows.slice(start - 1, end) }) };
    }
    throw new Error('URL non mockee: ' + u);
  };
  return { env, fetchImpl, kv };
}

const CONFIG = {
  live: {
    PORTFOLIOS_SHEET_ID: UNIQUE,
    PORTFOLIOS_TABS: [{ tab: 'omar', am: 'Omar Beldi', gid: 1 }]
  },
  kool: { ORDER_ITEMS_SHEET_ID: DETAILS }
};
const OWNER = { username: 'proprio', role: 'owner', amName: null };
const AM_OMAR = { username: 'omar.beldi', role: 'am', amName: 'Omar Beldi' };

test('tranches : ?tabs=1 liste les onglets dans l\u2019ordre', async () => {
  clearGoogleTokenCache();
  const { env, fetchImpl } = makeEnv(CONFIG, cannedTabs());
  await env.PULSE_KV.put('config', JSON.stringify(CONFIG));
  const t = await getSheetsTabs(env, OWNER, 'details-kool', 'kool', fetchImpl);
  assert.deepEqual(t.tabs, ['Articles', 'Feuille 3']);
});

test('tranches : enchaînement complet d\u2019un onglet (2500 lignes, tranche 1000)', async () => {
  clearGoogleTokenCache();
  const { env, fetchImpl } = makeEnv(CONFIG, cannedTabs());
  await env.PULSE_KV.put('config', JSON.stringify(CONFIG));
  const s0 = await getSheetsSlice(env, OWNER, 'details-kool', 'kool', { tab: 'Feuille 3', slice: 0, sliceSize: 1000 }, fetchImpl);
  assert.deepEqual(s0.headers, HEADERS);
  assert.equal(s0.rows.length, 999); // 1000 lignes de feuille - 1 en-tête
  assert.equal(s0.done, false);
  assert.equal(s0.skipped, false);
  const s1 = await getSheetsSlice(env, OWNER, 'details-kool', 'kool', { tab: 'Feuille 3', slice: 1, sliceSize: 1000 }, fetchImpl);
  assert.equal(s1.rows.length, 1000);
  assert.equal(s1.done, false);
  const s2 = await getSheetsSlice(env, OWNER, 'details-kool', 'kool', { tab: 'Feuille 3', slice: 2, sliceSize: 1000 }, fetchImpl);
  assert.equal(s2.rows.length, 501);
  assert.equal(s2.done, true);
  // Aucune ligne perdue, aucune en double (chemin sans déduplication).
  assert.equal(s0.rows.length + s1.rows.length + s2.rows.length, 2500);
  assert.equal(s0.rows[0][0], 'ORD-01000');
  assert.equal(s2.rows[s2.rows.length - 1][0], 'ORD-03499');
});

test('tranches : un onglet vide en premier est ignoré (skipped:true), les autres se chargent', async () => {
  // Diagnostic 2026-11-28 : la synchro Kool ne renvoyait plus d'erreur
  // Worker mais les détails restaient à 0. Cause : le premier onglet de
  // ?tabs=1 était vide ; sa tranche 0 répondait skipped:false +
  // headers:[] et le front en faisait les en-têtes de référence — ensuite
  // l'alignement vidait toutes les lignes des autres onglets. Un onglet
  // vide doit être marqué ignoré.
  clearGoogleTokenCache();
  clearSliceHeadersCache();
  const tabs = cannedTabs();
  tabs[DETAILS] = { 'Feuille 1': [], 'Articles': tabs[DETAILS]['Articles'], 'Feuille 3': tabs[DETAILS]['Feuille 3'] };
  const { env, fetchImpl } = makeEnv(CONFIG, tabs);
  await env.PULSE_KV.put('config', JSON.stringify(CONFIG));
  const t = await getSheetsTabs(env, OWNER, 'details-kool', 'kool', fetchImpl);
  assert.deepEqual(t.tabs, ['Feuille 1', 'Articles', 'Feuille 3']);
  const sEmpty = await getSheetsSlice(env, OWNER, 'details-kool', 'kool', { tab: 'Feuille 1', slice: 0, sliceSize: 1000 }, fetchImpl);
  assert.equal(sEmpty.skipped, true, 'onglet vide doit être ignoré');
  assert.equal(sEmpty.rows.length, 0);
  const s0 = await getSheetsSlice(env, OWNER, 'details-kool', 'kool', { tab: 'Articles', slice: 0, sliceSize: 1000 }, fetchImpl);
  assert.equal(s0.skipped, false);
  assert.deepEqual(s0.headers, HEADERS);
  assert.ok(s0.rows.length > 0, 'Articles doit se charger après un onglet vide');
});

test('tranches : sliceSize plafonné à SLICE_MAX_ROWS ; onglet manquant -> 400', async () => {
  clearGoogleTokenCache();
  const { env, fetchImpl } = makeEnv(CONFIG, cannedTabs());
  await env.PULSE_KV.put('config', JSON.stringify(CONFIG));
  const s = await getSheetsSlice(env, OWNER, 'details-kool', 'kool', { tab: 'Feuille 3', slice: 0, sliceSize: 99999 }, fetchImpl);
  assert.equal(s.sliceSize, SLICE_MAX_ROWS);
  await assert.rejects(
    getSheetsSlice(env, OWNER, 'details-kool', 'kool', { slice: 0, sliceSize: 100 }, fetchImpl),
    (e) => e.status === 400
  );
});

test('tranches : AM filtré sur son portefeuille (colonne Restaurant)', async () => {
  clearGoogleTokenCache();
  const { env, fetchImpl } = makeEnv(CONFIG, cannedTabs());
  await env.PULSE_KV.put('config', JSON.stringify(CONFIG));
  // Portefeuille d'Omar : Resto A + Resto B (onglet « omar ») — on restreint
  // ici via un 2e cas : l'AM ne voit que les lignes de ses restaurants.
  const s = await getSheetsSlice(env, AM_OMAR, 'details-kool', 'kool', { tab: 'Feuille 3', slice: 0, sliceSize: 1000 }, fetchImpl);
  const restos = new Set(s.rows.map((r) => r[2]));
  assert.ok(restos.size > 0 && [...restos].every((r) => r === 'Resto A' || r === 'Resto B'));
  assert.equal(s.rows.length, 999); // les 999 lignes sont toutes dans son portefeuille
});

test('tranches : getSheetsData route ?slice= vers le chemin tranches', async () => {
  clearGoogleTokenCache();
  const { env, fetchImpl } = makeEnv(CONFIG, cannedTabs());
  await env.PULSE_KV.put('config', JSON.stringify(CONFIG));
  const s = await getSheetsData(env, OWNER, 'details-kool', 'kool', { tab: 'Feuille 3', slice: 0, sliceSize: 500 }, fetchImpl);
  assert.equal(s.slice, 0);
  assert.equal(s.rows.length, 499);
  assert.equal(s.tab, 'Feuille 3');
});

test('tranches : chemin historique (pages) inchangé', async () => {
  clearGoogleTokenCache();
  const { env, fetchImpl } = makeEnv(CONFIG, cannedTabs());
  await env.PULSE_KV.put('config', JSON.stringify(CONFIG));
  const p = await getSheetsData(env, OWNER, 'portfolios', 'kool', { page: 0, pageSize: 100 }, fetchImpl);
  assert.equal(p.totalRows, 2);
  assert.equal(p.rows.length, 3); // en-têtes + 2 lignes
});

test('tranches : cache des en-têtes — la tranche 0 remplit le cache, les suivantes ne sondent plus (1 lecture/tranche)', async () => {
  clearGoogleTokenCache();
  clearSliceHeadersCache();
  const { env, fetchImpl } = makeEnv(CONFIG, cannedTabs());
  await env.PULSE_KV.put('config', JSON.stringify(CONFIG));
  let valuesCalls = 0;
  const countingFetch = async (url) => {
    if (String(url).includes('/values/')) valuesCalls++;
    return fetchImpl(url);
  };
  const s0 = await getSheetsSlice(env, OWNER, 'details-kool', 'kool', { tab: 'Feuille 3', slice: 0, sliceSize: 1000 }, countingFetch);
  assert.equal(s0.rows.length, 999);
  assert.equal(valuesCalls, 1); // tranche 0 : le morceau lui-même, pas de sonde
  const s1 = await getSheetsSlice(env, OWNER, 'details-kool', 'kool', { tab: 'Feuille 3', slice: 1, sliceSize: 1000 }, countingFetch);
  assert.equal(s1.rows.length, 1000);
  assert.deepEqual(s1.headers, HEADERS);
  assert.equal(valuesCalls, 2); // tranche 1 : le morceau seul, en-têtes depuis le cache
  const s2 = await getSheetsSlice(env, OWNER, 'details-kool', 'kool', { tab: 'Feuille 3', slice: 2, sliceSize: 1000 }, countingFetch);
  assert.equal(s2.rows.length, 501);
  assert.equal(valuesCalls, 3); // tranche 2 : idem — sans cache ce serait 5
});

test('tranches : cache des en-têtes — sans cache, la sonde a lieu (repli)', async () => {
  clearGoogleTokenCache();
  clearSliceHeadersCache();
  const { env, fetchImpl } = makeEnv(CONFIG, cannedTabs());
  await env.PULSE_KV.put('config', JSON.stringify(CONFIG));
  let valuesCalls = 0;
  const countingFetch = async (url) => {
    if (String(url).includes('/values/')) valuesCalls++;
    return fetchImpl(url);
  };
  // Tranche 1 seule, cache vide : sonde (lignes 1-12) + morceau = 2 lectures.
  const s1 = await getSheetsSlice(env, OWNER, 'details-kool', 'kool', { tab: 'Feuille 3', slice: 1, sliceSize: 1000 }, countingFetch);
  assert.equal(s1.rows.length, 1000);
  assert.equal(valuesCalls, 2);
});

// ---------------------------------------------------------------------------
// Sécurité — faille « tab » (audit Claude, 2026-11-28) : un AM pouvait lire
// n'importe quel onglet du classeur unique via le chemin par tranches
// (?tab=… repris tel quel, sans validation), contournant le filtrage
// (portefeuilles, Budget, commissions). Preuve de l'audit : Omar obtient
// le portefeuille de Nour, les 3 lignes de Budget et la grille de
// commissions en demandant un autre onglet. Ces tests reproduisent la
// preuve : ils doivent ÉCHOUER avant le correctif et PASSER après.
// ---------------------------------------------------------------------------
const AUDIT_UNIQUE = 'AUDIT00000000000000000000000001';
function auditTabs() {
  return {
    [AUDIT_UNIQUE]: {
      'omar': [
        ['Ville', 'Segment', 'restaurant Name', 'APP'],
        ['Tunis', 'A', 'Resto A', 'Kool'],
        ['Tunis', 'A', 'Resto B', 'Kool'],
        ['Tunis', 'A', 'Resto C', 'Kool']
      ],
      'nour': [
        ['Ville', 'Segment', 'restaurant Name', 'APP'],
        ['Sousse', 'B', 'Resto de Nour', 'Kool']
      ],
      'Budget': [
        ['AM', 'Budget', 'APP'],
        ['Omar Beldi', 5000, 'Yassir'],
        ['Nour Ali', 9000, 'Yassir'],
        ['Global', 90000, 'Yassir']
      ],
      'Commissions': [
        ['Restaurant', 'Taux', 'APP'],
        ['Resto A', 17, 'Kool'],
        ['Resto de Nour', 20, 'Kool']
      ],
      '2025 Yassir': [
        ['Indicateur', 'W 07', 'W 08', 'W 09'],
        ['GMV', 100, 110, 120]
      ],
      '2025 Kool': [
        ['Indicateur', 'W 07', 'W 08', 'W 09'],
        ['GMV', 50, 55, 60]
      ],
      'Offre Participation': [
        ['Restaurant', 'C%', 'Article'],
        ['Resto A', 10, 'Pizza']
      ]
    },
    [DETAILS]: cannedTabs()[DETAILS]
  };
}
const AUDIT_CONFIG = {
  live: {
    PORTFOLIOS_SHEET_ID: AUDIT_UNIQUE,
    PORTFOLIOS_TABS: [
      { tab: 'omar', am: 'Omar Beldi', gid: 1 },
      { tab: 'nour', am: 'Nour Ali', gid: 2 }
    ],
    BUDGET_SHEET_ID: AUDIT_UNIQUE, BUDGET_TAB: 'Budget', BUDGET_GID: 3,
    HISTORICAL_2025_SHEET_ID: AUDIT_UNIQUE, HISTORICAL_2025_GID: 4,
    COMMISSIONS_SHEET_ID: AUDIT_UNIQUE, COMMISSIONS_TAB: 'Commissions', COMMISSIONS_GID: 5,
    OFFRE_PARTICIPATION_SHEET_ID: AUDIT_UNIQUE, OFFRE_PARTICIPATION_GID: 6,
    BOGOF_GID: 7
  },
  kool: { ORDER_ITEMS_SHEET_ID: DETAILS, COMMISSION_SHEET_ID: AUDIT_UNIQUE, COMMISSION_TAB: 'Commissions', COMMISSION_GID: 5 }
};
const AM_NOUR = { username: 'nour.ali', role: 'am', amName: 'Nour Ali' };

test('sécurité tab : un AM demandant un onglet non autorisé → 403 (preuve audit)', async () => {
  clearGoogleTokenCache();
  clearSliceHeadersCache();
  const { env, fetchImpl } = makeEnv(AUDIT_CONFIG, auditTabs());
  await env.PULSE_KV.put('config', JSON.stringify(AUDIT_CONFIG));
  const is403 = (e) => e && e.status === 403;
  // Portefeuilles : onglet d'un autre AM.
  await assert.rejects(
    getSheetsSlice(env, AM_OMAR, 'portfolios', 'kool', { tab: 'nour', slice: 0, sliceSize: 100 }, fetchImpl), is403);
  // Portefeuilles : onglet partagé Budget (3 lignes : Omar 5000, Nour 9000, Global 90000).
  await assert.rejects(
    getSheetsSlice(env, AM_OMAR, 'portfolios', 'yassir', { tab: 'Budget', slice: 0, sliceSize: 100 }, fetchImpl), is403);
  // Portefeuilles : grille de commissions.
  await assert.rejects(
    getSheetsSlice(env, AM_OMAR, 'portfolios', 'kool', { tab: 'Commissions', slice: 0, sliceSize: 100 }, fetchImpl), is403);
  // hist2025 : onglet Budget (même classeur unique).
  await assert.rejects(
    getSheetsSlice(env, AM_OMAR, 'hist2025', 'yassir', { tab: 'Budget', slice: 0, sliceSize: 100 }, fetchImpl), is403);
  // Source nommée : commissions ne peut pas lire Budget, budget ne peut pas lire Commissions.
  await assert.rejects(
    getSheetsSlice(env, AM_OMAR, 'commissions', 'yassir', { tab: 'Budget', slice: 0, sliceSize: 100 }, fetchImpl), is403);
  await assert.rejects(
    getSheetsSlice(env, AM_OMAR, 'budget', 'yassir', { tab: 'Commissions', slice: 0, sliceSize: 100 }, fetchImpl), is403);
  // L'autre AM est bloqué symétriquement.
  await assert.rejects(
    getSheetsSlice(env, AM_NOUR, 'portfolios', 'kool', { tab: 'omar', slice: 0, sliceSize: 100 }, fetchImpl), is403);
});

test('sécurité tab : onglets autorisés pour un AM → 200, et proprio non restreint', async () => {
  clearGoogleTokenCache();
  clearSliceHeadersCache();
  const { env, fetchImpl } = makeEnv(AUDIT_CONFIG, auditTabs());
  await env.PULSE_KV.put('config', JSON.stringify(AUDIT_CONFIG));
  // Son propre onglet de portefeuille.
  const s = await getSheetsSlice(env, AM_OMAR, 'portfolios', 'kool', { tab: 'omar', slice: 0, sliceSize: 100 }, fetchImpl);
  assert.deepEqual(s.rows.map((r) => r[2]), ['Resto A', 'Resto B', 'Resto C']);
  // hist2025 : son onglet de marque (matrice agrégée YoY, sans dimension restaurant).
  const h = await getSheetsSlice(env, AM_OMAR, 'hist2025', 'yassir', { tab: '2025 Yassir', slice: 0, sliceSize: 100 }, fetchImpl);
  assert.equal(h.rows.length, 1);
  assert.equal(h.rows[0][0], 'GMV');
  // Offres : son onglet nommé. (Marque Kool : le portefeuille d'Omar est
  // Kool dans ce mock, donc le filtre par portefeuille le voit.)
  const o = await getSheetsSlice(env, AM_OMAR, 'offres', 'kool', { tab: 'Offre Participation', slice: 0, sliceSize: 100 }, fetchImpl);
  assert.equal(o.rows.length, 1);
  // Le proprio n'est pas restreint par la validation des onglets.
  const p = await getSheetsSlice(env, OWNER, 'portfolios', 'yassir', { tab: 'Budget', slice: 0, sliceSize: 100 }, fetchImpl);
  assert.equal(p.rows.length, 3);
});

test('sécurité tab : portefeuilles filtré par lignes (défense en profondeur)', async () => {
  clearGoogleTokenCache();
  clearSliceHeadersCache();
  const { env, fetchImpl } = makeEnv(AUDIT_CONFIG, auditTabs());
  await env.PULSE_KV.put('config', JSON.stringify(AUDIT_CONFIG));
  // Manifeste portefeuilles partiel en KV (ex. cache pas encore à jour) :
  // le portefeuille d'Omar n'y contient que Resto A. La tranche de son
  // propre onglet (Resto A, B, C) ne doit renvoyer que Resto A.
  await env.PULSE_KV.put('sheetcache:omar.beldi:kool:portfolios', JSON.stringify({
    version: 1,
    headers: ['Ville', 'Segment', 'restaurant Name', 'APP'],
    totalRows: 1, chunkCount: 0,
    _memoryRows: [['Tunis', 'A', 'Resto A', 'Kool']]
  }));
  const s = await getSheetsSlice(env, AM_OMAR, 'portfolios', 'kool', { tab: 'omar', slice: 0, sliceSize: 100 }, fetchImpl);
  assert.deepEqual(s.rows.map((r) => r[2]), ['Resto A']);
});

// ---------------------------------------------------------------------------
// Quota Google (diagnostic 2026-11-28) : details-kool échouait en 502 à
// chaque synchro Kool — le 429 quota était invisible (le Worker le
// transformait en 502), le front réessayait après 2 s/5 s, toujours dans
// la même fenêtre de 60 s, et la source tombait à 0. Ces tests doivent
// ÉCHOUER avant le correctif (429 -> 502) et PASSER après (429 -> 429).
// ---------------------------------------------------------------------------
test('quota Google : un 429 sur une tranche est préservé (429, pas 502)', async () => {
  clearGoogleTokenCache();
  clearSliceHeadersCache();
  const { env, fetchImpl } = makeEnv(CONFIG, cannedTabs());
  await env.PULSE_KV.put('config', JSON.stringify(CONFIG));
  const quotaFetch = async (url) => {
    if (String(url).includes('/values/')) {
      return { ok: false, status: 429, json: async () => ({ error: { code: 429, message: 'Quota exceeded' } }) };
    }
    return fetchImpl(url);
  };
  await assert.rejects(
    getSheetsSlice(env, OWNER, 'details-kool', 'kool', { tab: 'Feuille 3', slice: 0, sliceSize: 1000 }, quotaFetch),
    (e) => e.status === 429
  );
  // ?tabs=1 (métadonnées) en 429 aussi.
  const metaQuotaFetch = async (url) => {
    if (String(url).includes('fields=sheets.properties')) {
      return { ok: false, status: 429, json: async () => ({}) };
    }
    return fetchImpl(url);
  };
  await assert.rejects(
    getSheetsTabs(env, OWNER, 'details-kool', 'kool', metaQuotaFetch),
    (e) => e.status === 429
  );
});

test('quota Google : la route /api/sheets renvoie 429 (pas 502) et le diagnostic l\'enregistre', async () => {
  clearGoogleTokenCache();
  clearSliceHeadersCache();
  const kv2 = new Map();
  const env2 = {
    GOOGLE_SERVICE_ACCOUNT_JSON: saJson,
    JWT_SECRET: 'x'.repeat(40),
    LEGACY_SALT: 'SEL_HERITE::',
    ALLOWED_ORIGIN: 'https://app.test',
    PULSE_KV: {
      async get(key, type) { const v = kv2.get(key); if (v === undefined) return null; return type === 'json' ? JSON.parse(v) : v; },
      async put(key, value) { kv2.set(key, typeof value === 'string' ? value : JSON.stringify(value)); },
      async delete(key) { kv2.delete(key); }
    }
  };
  kv2.set('accounts', JSON.stringify([
    { username: 'proprio', hash: await hashPassword('Secret-Proprio-1'), role: 'owner', displayName: 'P', amName: null, protected: true }
  ]));
  kv2.set('config', JSON.stringify(CONFIG));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'fake', expires_in: 3600 }) };
    if (u.includes('/values/')) return { ok: false, status: 429, json: async () => ({ error: { code: 429, message: 'Quota exceeded' } }) };
    throw new Error('URL non mockee: ' + u);
  };
  try {
    const login = await handle(new Request('https://api.test/api/login', {
      method: 'POST', body: JSON.stringify({ username: 'proprio', password: 'Secret-Proprio-1' }),
      headers: { Origin: 'https://app.test', 'Content-Type': 'application/json' }
    }), env2);
    const token = (await login.json()).token;
    assert.ok(token, 'jeton proprio attendu');
    const r = await handle(new Request('https://api.test/api/sheets/details-kool?brand=kool&tab=Feuille%203&slice=0&sliceSize=1000', {
      method: 'GET', headers: { Origin: 'https://app.test', Authorization: 'Bearer ' + token }
    }), env2);
    assert.equal(r.status, 429);
    const lastError = JSON.parse(kv2.get('sheets:lastError'));
    assert.equal(lastError.source, 'details-kool');
    assert.equal(lastError.status, '429');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
