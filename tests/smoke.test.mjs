// Test d'intégration : vrai HTML + vrai code de l'application (jsdom) + vraie API (worker) branchée en mémoire.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { handle, hashPassword } from '../worker/src/index.js';

const seed = existsSync('private/seed.json') ? JSON.parse(readFileSync('private/seed.json', 'utf8')) : { live: { PORTFOLIOS_SHEET_ID: 'SHEET_TEST_ID_000000000000000000000000000' }, kool: {}, commissions: { 'test resto': 20 }, portfolios: {} };
const store = new Map();
const kv = { get: async (k, t) => (store.has(k) ? (t === 'json' ? JSON.parse(store.get(k)) : store.get(k)) : null), put: async (k, v) => void store.set(k, v), delete: async (k) => void store.delete(k) };
const env = { PULSE_KV: kv, JWT_SECRET: 'j'.repeat(48), LEGACY_SALT: 's', ALLOWED_ORIGIN: 'http://localhost' };
store.set('accounts', JSON.stringify([
  { username: 'proprio', hash: await hashPassword('Proprio-Test-123'), role: 'owner', displayName: 'Propriétaire Admin', amName: null, protected: true },
  { username: 'omar.beldi', hash: await hashPassword('Omar-Test-12345'), role: 'am', displayName: 'Omar Beldi', amName: 'Omar Beldi', protected: true }
]));
store.set('config', JSON.stringify({ live: seed.live, kool: seed.kool }));
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
