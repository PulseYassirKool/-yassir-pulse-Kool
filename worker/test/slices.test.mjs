// Tests du chargement par tranches (plan gratuit, 10 ms CPU / invocation).
// Google Sheets est simulé (jeton + métadonnées + valeurs) ; les données
// sont simulées (jamais private/seed.json) ; aucune date absolue figée.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { getSheetsSlice, getSheetsTabs, getSheetsData, SLICE_MAX_ROWS } from '../src/sheets.js';
import { clearGoogleTokenCache } from '../src/google-sheets.js';

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
