import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, hashPassword, RateLimiter } from '../src/index.js';

const kvStore = new Map();
const rlStore = new Map();
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

test("journal d'activité : connexion AM et échec journalisés, proprio ignoré", async () => {
  kvStore.delete('activity_log');
  kvStore.set('accounts', JSON.stringify([
    { username: 'proprio', hash: await hashPassword('Secret-Proprio-1'), role: 'owner', displayName: 'P', amName: null, protected: true },
    { username: 'omar.beldi', hash: await hashPassword('Omar-Password-2'), role: 'am', displayName: 'Omar', amName: 'Omar Beldi', protected: false }
  ]));
  // Échec sur un compte AM existant -> entrée login_fail.
  assert.equal((await call('POST', '/api/login', { username: 'omar.beldi', password: 'faux' })).status, 401);
  // Échec sur un identifiant inexistant -> rien (ne pas révéler l'existence des comptes).
  assert.equal((await call('POST', '/api/login', { username: 'inconnu', password: 'faux' })).status, 401);
  // Connexion réussie AM -> entrée login ; connexion proprio -> rien.
  assert.equal((await call('POST', '/api/login', { username: 'omar.beldi', password: 'Omar-Password-2' })).status, 200);
  assert.equal((await call('POST', '/api/login', { username: 'proprio', password: 'Secret-Proprio-1' })).status, 200);
  const entries = JSON.parse(kvStore.get('activity_log'));
  assert.equal(entries.length, 2);
  assert.equal(entries[0].type, 'login_fail');
  assert.equal(entries[0].user, 'omar.beldi');
  assert.equal(entries[1].type, 'login');
  assert.equal(entries[1].user, 'omar.beldi');
  assert.ok(!JSON.stringify(entries).includes('faux')); // jamais de mot de passe dans le journal
});

test("journal d'activité : POST/GET/DELETE — accès réservé au propriétaire", async () => {
  kvStore.delete('activity_log');
  kvStore.set('accounts', JSON.stringify([
    { username: 'proprio', hash: await hashPassword('Secret-Proprio-1'), role: 'owner', displayName: 'P', amName: null, protected: true },
    { username: 'omar.beldi', hash: await hashPassword('Omar-Password-2'), role: 'am', displayName: 'Omar', amName: 'Omar Beldi', protected: false }
  ]));
  const owner = (await call('POST', '/api/login', { username: 'proprio', password: 'Secret-Proprio-1' })).json.token;
  const am = (await call('POST', '/api/login', { username: 'omar.beldi', password: 'Omar-Password-2' })).json.token;
  // L'AM peut écrire (son export), mais pas lire ni effacer.
  assert.equal((await call('POST', '/api/activity', { type: 'export', detail: 'Export Excel : Test.xlsx' }, am)).status, 200);
  assert.equal((await call('GET', '/api/activity', null, am)).status, 403);
  assert.equal((await call('DELETE', '/api/activity', null, am)).status, 403);
  assert.equal((await call('GET', '/api/activity')).status, 401);
  // Le propriétaire ne peut pas être journalisé (même via POST direct).
  assert.equal((await call('POST', '/api/activity', { type: 'export', detail: 'Export Excel : Proprio.xlsx' }, owner)).status, 200);
  // Entrées invalides refusées.
  assert.equal((await call('POST', '/api/activity', { type: 'bidon', detail: 'x' }, am)).status, 400);
  assert.equal((await call('POST', '/api/activity', { type: 'export', detail: '' }, am)).status, 400);
  // Lecture propriétaire : plus récentes d'abord (export, puis connexion AM).
  const list = (await call('GET', '/api/activity', null, owner)).json.entries;
  assert.equal(list.length, 2);
  assert.equal(list[0].type, 'export');
  assert.equal(list[0].user, 'omar.beldi');
  assert.equal(list[1].type, 'login');
  // Effacement par le propriétaire.
  assert.equal((await call('DELETE', '/api/activity', null, owner)).status, 200);
  assert.equal((await call('GET', '/api/activity', null, owner)).json.entries.length, 0);
});

test("journal d'activité : plafond à 500 entrées, les plus anciennes sortent (FIFO)", async () => {
  const seed = [];
  for (let i = 0; i < 500; i++) seed.push({ ts: 1000 + i, user: 'omar.beldi', type: 'export', detail: 'Entrée ' + i });
  kvStore.set('activity_log', JSON.stringify(seed));
  kvStore.set('accounts', JSON.stringify([
    { username: 'omar.beldi', hash: await hashPassword('Omar-Password-2'), role: 'am', displayName: 'Omar', amName: 'Omar Beldi', protected: false }
  ]));
  const am = (await call('POST', '/api/login', { username: 'omar.beldi', password: 'Omar-Password-2' })).json.token;
  assert.ok(am);
  // La connexion AM ajoute 1 entrée : le journal reste à 500, la plus ancienne sort.
  const entries = JSON.parse(kvStore.get('activity_log'));
  assert.equal(entries.length, 500);
  assert.equal(entries[0].detail, 'Entrée 1');
  assert.equal(entries[499].type, 'login');
});

test("journal d'activité : un échec d'écriture KV ne casse ni le login ni l'envoi", async () => {
  kvStore.set('accounts', JSON.stringify([
    { username: 'omar.beldi', hash: await hashPassword('Omar-Password-2'), role: 'am', displayName: 'Omar', amName: 'Omar Beldi', protected: false }
  ]));
  const kvFailing = {
    get: kv.get,
    put: async (k, v) => { if (k === 'activity_log') throw new Error('KV indisponible'); return kv.put(k, v); },
    delete: kv.delete
  };
  const envFailing = { ...env, PULSE_KV: kvFailing };
  const callFailing = (method, path, body, token) => handle(new Request('https://api.test' + path, {
    method, body: body ? JSON.stringify(body) : undefined,
    headers: { Origin: 'https://app.test', ...(token ? { Authorization: 'Bearer ' + token } : {}) }
  }), envFailing).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));
  // Le login réussit même si le journal ne peut pas être écrit.
  const r = await callFailing('POST', '/api/login', { username: 'omar.beldi', password: 'Omar-Password-2' });
  assert.equal(r.status, 200);
  // L'envoi d'activité répond OK même si l'écriture échoue.
  assert.equal((await callFailing('POST', '/api/activity', { type: 'export', detail: 'Export Excel : Test.xlsx' }, r.json.token)).status, 200);
});

test('comptes : identifiant mal encodé (%FF) -> 400, pas 500 ; identifiant invalide -> 400', async () => {
  kvStore.set('accounts', JSON.stringify([
    { username: 'proprio', hash: await hashPassword('Secret-Proprio-1'), role: 'owner', displayName: 'P', amName: null, protected: true }
  ]));
  const owner = (await call('POST', '/api/login', { username: 'proprio', password: 'Secret-Proprio-1' })).json.token;
  // %FF est une séquence UTF-8 invalide : decodeURIComponent lève une exception.
  const bad = await call('PUT', '/api/accounts/%FF', { role: 'am', password: 'MotDePasse-Long-1' }, owner);
  assert.equal(bad.status, 400, 'identifiant mal encodé : 400 attendue, pas 500');
  assert.ok(!bad.json.error || typeof bad.json.error === 'string', 'réponse JSON propre');
  // Identifiant invalide (caractères interdits) -> 400 aussi.
  assert.equal((await call('PUT', '/api/accounts/nom!invalide', { role: 'am', password: 'MotDePasse-Long-1' }, owner)).status, 400);
  // Identifiant vide à la connexion -> 400.
  assert.equal((await call('POST', '/api/login', { username: '', password: 'x' })).status, 400);
});

test("limitation des connexions : l'objet durable compte 5 essais puis bloque le 6e, réinitialisé après succès", async () => {
  const rl = new RateLimiter({ storage: { get: async (k) => rlStore.get(k) ?? null, put: async (k, v) => void rlStore.set(k, v), delete: async (k) => void rlStore.delete(k) } });
  const check = (key) => rl.fetch(new Request('https://rl/check', { method: 'POST', body: JSON.stringify({ key, max: 5, windowMs: 900000 }) })).then((r) => r.json());
  for (let i = 0; i < 5; i++) assert.equal((await check('rl:1.2.3.4:omar.beldi')).allowed, true, 'essai ' + (i + 1) + ' autorisé');
  assert.equal((await check('rl:1.2.3.4:omar.beldi')).allowed, false, '6e essai bloqué');
  // Une autre clé n'est pas bloquée.
  assert.equal((await check('rl:1.2.3.4:autre')).allowed, true, 'autre identifiant non bloqué');
  // Réinitialisation après connexion réussie.
  assert.equal((await rl.fetch(new Request('https://rl/reset', { method: 'POST', body: JSON.stringify({ key: 'rl:1.2.3.4:omar.beldi', reset: true }) }))).status, 200);
  assert.equal((await check('rl:1.2.3.4:omar.beldi')).allowed, true, 'compteur réinitialisé');
  // Clé manquante -> 400.
  assert.equal((await rl.fetch(new Request('https://rl/check', { method: 'POST', body: JSON.stringify({}) }))).status, 400);
});

test('limitation des connexions : 5 essais en parallèle ne contournent plus le blocage', async () => {
  kvStore.set('accounts', JSON.stringify([
    { username: 'omar.beldi', hash: await hashPassword('Omar-Password-2'), role: 'am', displayName: 'Omar', amName: 'Omar Beldi', protected: false }
  ]));
  const rlStore2 = new Map();
  const rl = new RateLimiter({ storage: { get: async (k) => rlStore2.get(k) ?? null, put: async (k, v) => void rlStore2.set(k, v), delete: async (k) => void rlStore2.delete(k) } });
  const envDo = { ...env, RATE_LIMITER: { idFromName: (name) => name, get: () => ({ fetch: (req) => rl.fetch(req) }) } };
  const callDo = (method, path, body, token) => handle(new Request('https://api.test' + path, {
    method, body: body ? JSON.stringify(body) : undefined,
    headers: { Origin: 'https://app.test', 'CF-Connecting-IP': '9.9.9.9', ...(token ? { Authorization: 'Bearer ' + token } : {}) }
  }), envDo).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));
  // 5 essais faux envoyés en même temps : tous rejetés (401), aucun ne passe entre la lecture et l'écriture.
  const results = await Promise.all(Array.from({ length: 5 }, () => callDo('POST', '/api/login', { username: 'omar.beldi', password: 'faux' })));
  assert.ok(results.every((r) => r.status === 401), 'les 5 essais parallèles sont rejetés');
  // Le 6e essai, même avec le bon mot de passe, est bloqué (429).
  assert.equal((await callDo('POST', '/api/login', { username: 'omar.beldi', password: 'Omar-Password-2' })).status, 429);
});

test("journal d'activité : un utilisateur ne peut pas envoyer plus de 50 événements par heure", async () => {
  kvStore.delete('activity_log');
  for (const k of [...kvStore.keys()]) if (k.startsWith('actrl:')) kvStore.delete(k);
  kvStore.set('accounts', JSON.stringify([
    { username: 'omar.beldi', hash: await hashPassword('Omar-Password-2'), role: 'am', displayName: 'Omar', amName: 'Omar Beldi', protected: false }
  ]));
  const am = (await call('POST', '/api/login', { username: 'omar.beldi', password: 'Omar-Password-2' })).json.token;
  for (let i = 0; i < 50; i++) {
    assert.equal((await call('POST', '/api/activity', { type: 'export', detail: 'Export ' + i }, am)).status, 200, 'événement ' + (i + 1) + ' accepté');
  }
  assert.equal((await call('POST', '/api/activity', { type: 'export', detail: 'Export 51' }, am)).status, 429, '51e événement refusé');
  // Le journal garde les 50 événements + la connexion : rien n'est effacé par le flood.
  const list = JSON.parse(kvStore.get('activity_log'));
  assert.equal(list.length, 51, 'le journal n\'a pas été inondé');
  assert.ok(list.some((e) => e.type === 'login'), 'la connexion est toujours dans le journal');
});

test('changement de mot de passe par le proprio -> ancien jeton AM rejeté, nouveau mot de passe accepté', async () => {
  kvStore.set('accounts', JSON.stringify([
    { username: 'proprio', hash: await hashPassword('Secret-Proprio-1'), role: 'owner', displayName: 'P', amName: null, protected: true },
    { username: 'omar.beldi', hash: await hashPassword('Omar-Password-2'), role: 'am', displayName: 'Omar', amName: 'Omar Beldi', protected: false }
  ]));
  const amOld = (await call('POST', '/api/login', { username: 'omar.beldi', password: 'Omar-Password-2' })).json.token;
  assert.equal((await call('GET', '/api/me', null, amOld)).status, 200);
  const owner = (await call('POST', '/api/login', { username: 'proprio', password: 'Secret-Proprio-1' })).json.token;
  assert.equal((await call('PUT', '/api/accounts/omar.beldi', { password: 'Nouveau-Password-3', role: 'am', amName: 'Omar Beldi', displayName: 'Omar' }, owner)).status, 200);
  // L'ancien jeton meurt immédiatement (version du mot de passe incrémentée).
  assert.equal((await call('GET', '/api/me', null, amOld)).status, 401);
  assert.equal((await call('GET', '/api/bootstrap', null, amOld)).status, 401);
  // L'ancien mot de passe ne marche plus, le nouveau oui — et son jeton est valide.
  assert.equal((await call('POST', '/api/login', { username: 'omar.beldi', password: 'Omar-Password-2' })).status, 401);
  const amFresh = (await call('POST', '/api/login', { username: 'omar.beldi', password: 'Nouveau-Password-3' })).json.token;
  assert.equal((await call('GET', '/api/me', null, amFresh)).status, 200);
  // Le jeton du propriétaire, lui, n'est pas touché (seul le compte modifié est déconnecté).
  assert.equal((await call('GET', '/api/me', null, owner)).status, 200);
});
