import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, hashPassword } from '../src/index.js';

const kvStore = new Map();
const kv = {
  get: async (k, t) => (kvStore.has(k) ? (t === 'json' ? JSON.parse(kvStore.get(k)) : kvStore.get(k)) : null),
  put: async (k, v) => void kvStore.set(k, v),
  delete: async (k) => void kvStore.delete(k)
};
const SALT = 'SEL_HERITE::';
const legacy = async (p) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(SALT + p)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const env = { PULSE_KV: kv, JWT_SECRET: 'x'.repeat(40), LEGACY_SALT: SALT, ALLOWED_ORIGIN: 'https://app.test' };
const call = (method, path, body, token) => handle(new Request('https://api.test' + path, {
  method, body: body ? JSON.stringify(body) : undefined,
  headers: { Origin: 'https://app.test', ...(token ? { Authorization: 'Bearer ' + token } : {}) }
}), env).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})), headers: r.headers }));

test.before(async () => {
  kvStore.set('accounts', JSON.stringify([
    { username: 'proprio', hash: await legacy('Secret-Proprio-1'), role: 'owner', displayName: 'Propriétaire', amName: null, protected: true },
    { username: 'omar.beldi', hash: await hashPassword('Omar-Password-2'), role: 'am', displayName: 'Omar Beldi', amName: 'Omar Beldi', protected: true }
  ]));
  kvStore.set('config', JSON.stringify({ live: { X: 'secret-id' }, kool: {} }));
  kvStore.set('defaults', JSON.stringify({ commissions: { a: 1 }, portfolios: {} }));
});

test('mauvais mot de passe -> 401, puis blocage 429 après 5 essais', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/api/login', { username: 'omar.beldi', password: 'faux' })).status, 401);
  assert.equal((await call('POST', '/api/login', { username: 'omar.beldi', password: 'Omar-Password-2' })).status, 429);
  for (const k of [...kvStore.keys()]) if (k.startsWith('rl:')) kvStore.delete(k);
});

test('connexion ancien hash SHA-256 -> migration PBKDF2 automatique', async () => {
  kvStore.set('accounts', JSON.stringify([{ username: 'proprio', hash: await legacy('Secret-Proprio-1'), role: 'owner', displayName: 'P', amName: null, protected: true }]));
  const r = await call('POST', '/api/login', { username: 'proprio', password: 'Secret-Proprio-1' });
  assert.equal(r.status, 200);
  assert.ok(JSON.parse(kvStore.get('accounts'))[0].hash.startsWith('pbkdf2$'));
  assert.equal((await call('POST', '/api/login', { username: 'proprio', password: 'Secret-Proprio-1' })).status, 200);
});

test('routes protégées : sans jeton ou jeton falsifié -> 401 ; bootstrap avec jeton', async () => {
  kvStore.set('config', JSON.stringify({ live: { X: 'secret-id' }, kool: {} }));
  kvStore.set('defaults', JSON.stringify({ commissions: { a: 1 }, portfolios: {} }));
  assert.equal((await call('GET', '/api/bootstrap')).status, 401);
  const { json } = await call('POST', '/api/login', { username: 'proprio', password: 'Secret-Proprio-1' });
  assert.equal((await call('GET', '/api/bootstrap', null, json.token + 'x')).status, 401);
  const boot = await call('GET', '/api/bootstrap', null, json.token);
  assert.equal(boot.json.config.live.X, 'secret-id');
  assert.equal(JSON.stringify(json.user).includes('hash'), false);
});

test('gestion des comptes : réservée au propriétaire, mot de passe >= 10, pas d\'auto-suppression', async () => {
  kvStore.set('accounts', JSON.stringify([
    { username: 'proprio', hash: await hashPassword('Secret-Proprio-1'), role: 'owner', displayName: 'P', amName: null, protected: true },
    { username: 'omar.beldi', hash: await hashPassword('Omar-Password-2'), role: 'am', displayName: 'Omar', amName: 'Omar Beldi', protected: false }
  ]));
  const owner = (await call('POST', '/api/login', { username: 'proprio', password: 'Secret-Proprio-1' })).json.token;
  const am = (await call('POST', '/api/login', { username: 'omar.beldi', password: 'Omar-Password-2' })).json.token;
  assert.equal((await call('GET', '/api/accounts', null, am)).status, 403);
  assert.equal((await call('PUT', '/api/accounts/nouveau', { role: 'am', password: 'court' }, owner)).status, 400);
  assert.equal((await call('PUT', '/api/accounts/nouveau', { role: 'am', amName: 'Nour Ali', password: 'MotDePasse-Long-1' }, owner)).status, 200);
  assert.equal((await call('PUT', '/api/accounts/proprio', { role: 'am' }, owner)).status, 400); // dernier propriétaire
  assert.equal((await call('DELETE', '/api/accounts/proprio', null, owner)).status, 403);
  assert.equal((await call('DELETE', '/api/accounts/omar.beldi', null, owner)).status, 200);
  assert.equal((await call('GET', '/api/me', null, am)).status, 401); // compte supprimé = accès coupé immédiatement
  const list = (await call('GET', '/api/accounts', null, owner)).json.accounts;
  assert.ok(list.every((a) => !('hash' in a)));
});
