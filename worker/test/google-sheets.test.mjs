// Tests G3 (tranche 1) : lecture Google Sheets via le compte de service.
// La clé RSA est générée ici, en mémoire, pour les tests uniquement —
// jamais la vraie clé du compte de service (qui vit dans le secret Worker).
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { handle, hashPassword } from '../src/index.js';
import {
  buildServiceAccountJwt, getAccessToken, readSheetRange, clearGoogleTokenCache
} from '../src/google-sheets.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const CLIENT_EMAIL = 'yassir-pulse@projet-factures-483821.iam.gserviceaccount.com';
const serviceAccount = {
  type: 'service_account',
  project_id: 'projet-factures-483821',
  client_email: CLIENT_EMAIL,
  private_key: privateKeyPem
};
const envSheets = { GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount) };

// Réponse simulée d'un endpoint Google.
const okJson = (body) => ({ ok: true, status: 200, json: async () => body });
const errJson = (status, body = {}) => ({ ok: false, status, json: async () => body });

// fetch mocké : enregistre les appels, répond jeton puis valeurs.
function mockGoogleFetch({ tokenStatus = 200, tokenBody = null, valuesStatus = 200, valuesBody = null } = {}) {
  const calls = [];
  const fetchMock = async (url, opts) => {
    calls.push({ url, opts });
    if (String(url).includes('oauth2.googleapis.com/token')) {
      if (tokenStatus !== 200) return errJson(tokenStatus, { error: 'invalid_grant' });
      return okJson(tokenBody || { access_token: 'ya29.test-token', expires_in: 3600, token_type: 'Bearer' });
    }
    if (String(url).includes('sheets.googleapis.com')) {
      if (valuesStatus !== 200) return errJson(valuesStatus, { error: { code: 403, message: 'Forbidden' } });
      return okJson(valuesBody || { range: 'A1:B2', majorDimension: 'ROWS', values: [['a', 'b'], ['1', '2']] });
    }
    throw new Error('URL inattendue : ' + url);
  };
  return { fetchMock, calls };
}

test('JWT compte de service : en-tête, claims et signature RS256 vérifiable', async () => {
  // buildServiceAccountJwt prend la forme parsée (comme parseServiceAccount la produit).
  const jwt = await buildServiceAccountJwt({ clientEmail: CLIENT_EMAIL, privateKeyPem }, Date.parse('2026-11-27T10:00:00Z'));
  const [h, p, s] = jwt.split('.');
  assert.equal(jwt.split('.').length, 3);
  const header = JSON.parse(Buffer.from(h, 'base64url').toString());
  assert.deepEqual(header, { alg: 'RS256', typ: 'JWT' });
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
  assert.equal(payload.iss, CLIENT_EMAIL);
  assert.equal(payload.scope, 'https://www.googleapis.com/auth/spreadsheets.readonly');
  assert.equal(payload.aud, 'https://oauth2.googleapis.com/token');
  assert.equal(payload.exp - payload.iat, 3600);
  assert.equal(payload.iat, Math.floor(Date.parse('2026-11-27T10:00:00Z') / 1000));
  // La signature se vérifie avec la clé publique correspondante.
  const verifier = createVerify('SHA256');
  verifier.update(`${h}.${p}`);
  assert.equal(verifier.verify(publicKey, Buffer.from(s, 'base64url')), true);
  // La clé privée ne sort jamais dans le JWT.
  assert.ok(!jwt.includes('PRIVATE KEY'));
});

test("jeton d'accès : échange puis réutilisation du cache (2e appel sans nouvel échange)", async () => {
  clearGoogleTokenCache();
  const { fetchMock, calls } = mockGoogleFetch();
  assert.equal(await getAccessToken(envSheets, fetchMock), 'ya29.test-token');
  assert.equal(await getAccessToken(envSheets, fetchMock), 'ya29.test-token');
  const tokenCalls = calls.filter((c) => String(c.url).includes('oauth2.googleapis.com/token'));
  assert.equal(tokenCalls.length, 1, 'un seul échange de jeton pour deux appels');
  // L'échange envoie bien le JWT en grant jwt-bearer.
  assert.ok(String(tokenCalls[0].opts.body).startsWith('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion='));
});

test("jeton d'accès : un jeton presque expiré est ré-échangé (marge de sécurité)", async () => {
  clearGoogleTokenCache();
  const { fetchMock, calls } = mockGoogleFetch({ tokenBody: { access_token: 'ya29.court', expires_in: 1, token_type: 'Bearer' } });
  assert.equal(await getAccessToken(envSheets, fetchMock), 'ya29.court');
  // expires_in: 1 s < marge de sécurité de 60 s : le 2e appel ré-échange.
  assert.equal(await getAccessToken(envSheets, fetchMock), 'ya29.court');
  assert.equal(calls.filter((c) => String(c.url).includes('oauth2.googleapis.com/token')).length, 2);
});

test('lecture de plage : valeurs renvoyées ; plage vide -> []', async () => {
  clearGoogleTokenCache();
  const { fetchMock, calls } = mockGoogleFetch();
  const r = await readSheetRange(envSheets, '1kT0c2YtIwrqh7rkvXGybapah3yC8sNRZejHmOUO-bhA', 'Budget!A1:B3', fetchMock);
  assert.deepEqual(r.values, [['a', 'b'], ['1', '2']]);
  // L'appel Sheets porte le jeton en Bearer.
  const sheetsCall = calls.find((c) => String(c.url).includes('sheets.googleapis.com'));
  assert.equal(sheetsCall.opts.headers.Authorization, 'Bearer ya29.test-token');
  assert.ok(String(sheetsCall.url).includes('/values/Budget!A1%3AB3') || String(sheetsCall.url).includes('/values/Budget%21A1%3AB3'));
  // Correctif 2026-11-27 (audit point 2 — montants lus tels qu'affichés) :
  // les valeurs doivent être demandées NON formatées (nombres exacts) avec
  // les dates en chaînes formatées, sinon une cellule affichée « 1 235 »
  // qui contient 1 234,57 est lue 1 235.
  assert.ok(String(sheetsCall.url).includes('valueRenderOption=UNFORMATTED_VALUE'), 'valueRenderOption=UNFORMATTED_VALUE attendu dans ' + String(sheetsCall.url));
  assert.ok(String(sheetsCall.url).includes('dateTimeRenderOption=FORMATTED_STRING'), 'dateTimeRenderOption=FORMATTED_STRING attendu dans ' + String(sheetsCall.url));

  clearGoogleTokenCache();
  const empty = mockGoogleFetch({ valuesBody: { range: 'A1:B1', majorDimension: 'ROWS' } });
  const r2 = await readSheetRange(envSheets, '1kT0c2YtIwrqh7rkvXGybapah3yC8sNRZejHmOUO-bhA', 'Budget!A1:B1', empty.fetchMock);
  assert.deepEqual(r2.values, []);
});

test('lecture de plage : identifiant et plage invalides -> 400', async () => {
  clearGoogleTokenCache();
  const { fetchMock } = mockGoogleFetch();
  await assert.rejects(() => readSheetRange(envSheets, 'court', 'A1:B2', fetchMock), (e) => e.status === 400);
  await assert.rejects(() => readSheetRange(envSheets, 'abc!def', 'A1:B2', fetchMock), (e) => e.status === 400);
  await assert.rejects(() => readSheetRange(envSheets, '1kT0c2YtIwrqh7rkvXGybapah3yC8sNRZejHmOUO-bhA', '', fetchMock), (e) => e.status === 400);
  await assert.rejects(() => readSheetRange(envSheets, '1kT0c2YtIwrqh7rkvXGybapah3yC8sNRZejHmOUO-bhA', 'A1/B2', fetchMock), (e) => e.status === 400);
});

test('quota Google : un 429 est préservé (pas transformé en 502) ; un 403 reste 502', async () => {
  // Diagnostic 2026-11-28 (details-kool en 502 à chaque synchro) : le 429
  // quota était invisible — le front réessayait après 2 s/5 s, toujours
  // dans la même fenêtre de 60 s. Ce test doit ÉCHOUER avant le correctif
  // (429 -> 502) et PASSER après (429 -> 429).
  clearGoogleTokenCache();
  const quota = mockGoogleFetch({ valuesStatus: 429 });
  await assert.rejects(() => readSheetRange(envSheets, '1kT0c2YtIwrqh7rkvXGybapah3yC8sNRZejHmOUO-bhA', 'A1:B2', quota.fetchMock), (e) => e.status === 429);
  // Un 403 reste un 502 générique (aucun détail de configuration exposé).
  clearGoogleTokenCache();
  const forbidden = mockGoogleFetch({ valuesStatus: 403 });
  await assert.rejects(() => readSheetRange(envSheets, '1kT0c2YtIwrqh7rkvXGybapah3yC8sNRZejHmOUO-bhA', 'A1:B2', forbidden.fetchMock), (e) => e.status === 502);
});

test("chemins d'erreur : secret absent -> 500 ; échange refusé -> 502 ; lecture refusée -> 502", async () => {
  clearGoogleTokenCache();
  const { fetchMock } = mockGoogleFetch();
  await assert.rejects(() => getAccessToken({}, fetchMock), (e) => e.status === 500);
  await assert.rejects(() => getAccessToken({ GOOGLE_SERVICE_ACCOUNT_JSON: 'pas-du-json' }, fetchMock), (e) => e.status === 500);
  await assert.rejects(() => getAccessToken({ GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ type: 'service_account' }) }, fetchMock), (e) => e.status === 500);

  clearGoogleTokenCache();
  const badToken = mockGoogleFetch({ tokenStatus: 400 });
  await assert.rejects(() => getAccessToken(envSheets, badToken.fetchMock), (e) => e.status === 502);

  clearGoogleTokenCache();
  const forbidden = mockGoogleFetch({ valuesStatus: 403 });
  await assert.rejects(() => readSheetRange(envSheets, '1kT0c2YtIwrqh7rkvXGybapah3yC8sNRZejHmOUO-bhA', 'A1:B2', forbidden.fetchMock), (e) => e.status === 502);
});

// ---- Endpoint GET /api/admin/sheets-test ----
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

const SEVEN_ROWS = [['H1', 'H2'], ['r1', 'a'], ['r2', 'b'], ['r3', 'c'], ['r4', 'd'], ['r5', 'e'], ['r6', 'f']];

test.before(async () => {
  kvStore.set('accounts', JSON.stringify([
    { username: 'proprio', hash: await hashPassword('Secret-Proprio-1'), role: 'owner', displayName: 'P', amName: null, protected: true },
    { username: 'omar.beldi', hash: await hashPassword('Omar-Password-2'), role: 'am', displayName: 'Omar', amName: 'Omar Beldi', protected: false }
  ]));
});

test('endpoint sheets-test : 401 sans jeton, 403 pour un AM, 200 proprio avec 5 premières lignes', async () => {
  clearGoogleTokenCache();
  const originalFetch = globalThis.fetch;
  const { fetchMock } = mockGoogleFetch({ valuesBody: { range: 'Budget!A1:B8', majorDimension: 'ROWS', values: SEVEN_ROWS } });
  globalThis.fetch = fetchMock;
  try {
    assert.equal((await call('GET', '/api/admin/sheets-test?spreadsheetId=1kT0c2YtIwrqh7rkvXGybapah3yC8sNRZejHmOUO-bhA&range=Budget!A1:B8')).status, 401);
    const owner = (await call('POST', '/api/login', { username: 'proprio', password: 'Secret-Proprio-1' })).json.token;
    const am = (await call('POST', '/api/login', { username: 'omar.beldi', password: 'Omar-Password-2' })).json.token;
    assert.equal((await call('GET', '/api/admin/sheets-test?spreadsheetId=1kT0c2YtIwrqh7rkvXGybapah3yC8sNRZejHmOUO-bhA&range=Budget!A1:B8', null, am)).status, 403);
    const r = await call('GET', '/api/admin/sheets-test?spreadsheetId=1kT0c2YtIwrqh7rkvXGybapah3yC8sNRZejHmOUO-bhA&range=Budget!A1:B8', null, owner);
    assert.equal(r.status, 200);
    assert.equal(r.json.rowCount, 7);
    assert.equal(r.json.rows.length, 5, 'seules les 5 premières lignes sont renvoyées');
    assert.deepEqual(r.json.rows[0], ['H1', 'H2']);
    // Aucun secret ni jeton Google dans la réponse.
    assert.ok(!JSON.stringify(r.json).includes('ya29.'));
    assert.ok(!JSON.stringify(r.json).includes('PRIVATE KEY'));
    assert.ok(!JSON.stringify(r.json).includes(CLIENT_EMAIL));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('endpoint sheets-test : 400 identifiant invalide, 500 secret absent, 502 lecture refusée', async () => {
  clearGoogleTokenCache();
  const originalFetch = globalThis.fetch;
  const { fetchMock } = mockGoogleFetch();
  globalThis.fetch = fetchMock;
  try {
    const owner = (await call('POST', '/api/login', { username: 'proprio', password: 'Secret-Proprio-1' })).json.token;
    assert.equal((await call('GET', '/api/admin/sheets-test?spreadsheetId=court&range=A1:B2', null, owner)).status, 400);
    assert.equal((await call('GET', '/api/admin/sheets-test?spreadsheetId=1kT0c2YtIwrqh7rkvXGybapah3yC8sNRZejHmOUO-bhA', null, owner)).status, 400);
    // Secret absent -> 500 générique (aucun détail de configuration exposé).
    const envNoSecret = { ...env };
    delete envNoSecret.GOOGLE_SERVICE_ACCOUNT_JSON;
    const callNoSecret = (method, path, body, token) => handle(new Request('https://api.test' + path, {
      method, body: body ? JSON.stringify(body) : undefined,
      headers: { Origin: 'https://app.test', ...(token ? { Authorization: 'Bearer ' + token } : {}) }
    }), envNoSecret).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));
    assert.equal((await callNoSecret('GET', '/api/admin/sheets-test?spreadsheetId=1kT0c2YtIwrqh7rkvXGybapah3yC8sNRZejHmOUO-bhA&range=A1:B2', null, owner)).status, 500);
  } finally {
    globalThis.fetch = originalFetch;
  }

  clearGoogleTokenCache();
  const forbidden = mockGoogleFetch({ valuesStatus: 403 });
  globalThis.fetch = forbidden.fetchMock;
  try {
    const owner = (await call('POST', '/api/login', { username: 'proprio', password: 'Secret-Proprio-1' })).json.token;
    const r = await call('GET', '/api/admin/sheets-test?spreadsheetId=1kT0c2YtIwrqh7rkvXGybapah3yC8sNRZejHmOUO-bhA&range=A1:B2', null, owner);
    assert.equal(r.status, 502);
    assert.ok(!JSON.stringify(r.json).includes('Forbidden'), 'le message de Google n’est pas propagé');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
