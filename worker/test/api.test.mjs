import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, hashPassword, RateLimiter } from '../src/index.js';
import { activityKey, ACTIVITY_TTL_SECONDS } from '../src/activity-log.js';

const kvStore = new Map();
const kvMeta = new Map(); // clé -> { metadata, expirationTtl } (options du put)
const rlStore = new Map();
const kv = {
  get: async (k, t) => (kvStore.has(k) ? (t === 'json' ? JSON.parse(kvStore.get(k)) : kvStore.get(k)) : null),
  put: async (k, v, opts) => {
    kvStore.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    if (opts) kvMeta.set(k, { metadata: opts.metadata, expirationTtl: opts.expirationTtl });
  },
  delete: async (k) => { kvStore.delete(k); kvMeta.delete(k); },
  list: async ({ prefix = '', limit = 1000, cursor } = {}) => {
    const names = [...kvStore.keys()].filter((k) => k.startsWith(prefix)).sort();
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
// Vide le journal (nouvelles clés + ancien modèle + marqueur d'effacement).
const clearActivityKeys = () => {
  for (const k of [...kvStore.keys()]) {
    if (k.startsWith('activity:') || k === 'activity_log') kvStore.delete(k);
  }
  for (const k of [...kvMeta.keys()]) {
    if (k.startsWith('activity:')) kvMeta.delete(k);
  }
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
  clearActivityKeys();
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
  // Lecture proprio : plus récentes d'abord (login, puis login_fail).
  const owner = (await call('POST', '/api/login', { username: 'proprio', password: 'Secret-Proprio-1' })).json.token;
  const entries = (await call('GET', '/api/activity', null, owner)).json.entries;
  assert.equal(entries.length, 2);
  assert.equal(entries[0].type, 'login');
  assert.equal(entries[0].user, 'omar.beldi');
  assert.equal(entries[1].type, 'login_fail');
  assert.equal(entries[1].user, 'omar.beldi');
  assert.ok(!JSON.stringify(entries).includes('faux')); // jamais de mot de passe dans le journal
});

test("journal d'activité : POST/GET/DELETE — accès réservé au propriétaire", async () => {
  clearActivityKeys();
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
  // Lecture propriétaire : 2 entrées (export + connexion AM). L'ordre
  // entre deux événements de la même milliseconde n'est pas garanti
  // (tri par horodatage seul, suffixe de clé aléatoire) : on vérifie le
  // contenu, pas l'ordre — sinon le test est aléatoire en CI.
  const list = (await call('GET', '/api/activity', null, owner)).json.entries;
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((e) => e.type).sort(), ['export', 'login']);
  assert.ok(list.every((e) => e.user === 'omar.beldi'));
  // Effacement par le propriétaire.
  assert.equal((await call('DELETE', '/api/activity', null, owner)).status, 200);
  assert.equal((await call('GET', '/api/activity', null, owner)).json.entries.length, 0);
});

test("journal d'activité : plafond à 500 entrées, les plus anciennes sortent", async () => {
  clearActivityKeys();
  // 500 entrées simulées (une clé KV par événement, horodatages croissants).
  const now = Date.now();
  for (let i = 0; i < 500; i++) {
    const ts = now - (500 - i) * 1000;
    await kv.put(activityKey(ts), '', { expirationTtl: ACTIVITY_TTL_SECONDS, metadata: { ts, user: 'omar.beldi', type: 'export', detail: 'Entrée ' + i } });
  }
  kvStore.set('accounts', JSON.stringify([
    { username: 'omar.beldi', hash: await hashPassword('Omar-Password-2'), role: 'am', displayName: 'Omar', amName: 'Omar Beldi', protected: false },
    { username: 'proprio', hash: await hashPassword('Secret-Proprio-1'), role: 'owner', displayName: 'P', amName: null, protected: true }
  ]));
  const am = (await call('POST', '/api/login', { username: 'omar.beldi', password: 'Omar-Password-2' })).json.token;
  assert.ok(am);
  // La connexion AM ajoute 1 entrée : la lecture reste à 500, la plus ancienne sort.
  const owner = (await call('POST', '/api/login', { username: 'proprio', password: 'Secret-Proprio-1' })).json.token;
  const entries = (await call('GET', '/api/activity', null, owner)).json.entries;
  assert.equal(entries.length, 500);
  assert.equal(entries[0].type, 'login', 'la connexion est la plus récente');
  assert.equal(entries[499].detail, 'Entrée 1', 'la plus ancienne (Entrée 0) est sortie');
  assert.ok(entries.every((e) => e.detail !== 'Entrée 0'));
});

test("journal d'activité : un échec d'écriture KV ne casse ni le login ni l'envoi", async () => {
  kvStore.set('accounts', JSON.stringify([
    { username: 'omar.beldi', hash: await hashPassword('Omar-Password-2'), role: 'am', displayName: 'Omar', amName: 'Omar Beldi', protected: false }
  ]));
  const kvFailing = {
    get: kv.get,
    list: kv.list,
    put: async (k, v, opts) => { if (String(k).startsWith('activity:')) throw new Error('KV indisponible'); return kv.put(k, v, opts); },
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
  clearActivityKeys();
  for (const k of [...kvStore.keys()]) if (k.startsWith('actrl:')) kvStore.delete(k);
  kvStore.set('accounts', JSON.stringify([
    { username: 'omar.beldi', hash: await hashPassword('Omar-Password-2'), role: 'am', displayName: 'Omar', amName: 'Omar Beldi', protected: false },
    { username: 'proprio', hash: await hashPassword('Secret-Proprio-1'), role: 'owner', displayName: 'P', amName: null, protected: true }
  ]));
  const am = (await call('POST', '/api/login', { username: 'omar.beldi', password: 'Omar-Password-2' })).json.token;
  for (let i = 0; i < 50; i++) {
    assert.equal((await call('POST', '/api/activity', { type: 'export', detail: 'Export ' + i }, am)).status, 200, 'événement ' + (i + 1) + ' accepté');
  }
  assert.equal((await call('POST', '/api/activity', { type: 'export', detail: 'Export 51' }, am)).status, 429, '51e événement refusé');
  // Le journal garde les 50 événements + la connexion : rien n'est effacé par le flood.
  const owner = (await call('POST', '/api/login', { username: 'proprio', password: 'Secret-Proprio-1' })).json.token;
  const list = (await call('GET', '/api/activity', null, owner)).json.entries;
  assert.equal(list.length, 51, 'le journal n\'a pas été inondé');
  assert.ok(list.some((e) => e.type === 'login'), 'la connexion est toujours dans le journal');
});

// ---- I4 : une clé KV par événement, TTL 90 jours ----
test("I4 : écriture concurrente sans perte (20 envois en parallèle, tous présents)", async () => {
  clearActivityKeys();
  for (const k of [...kvStore.keys()]) if (k.startsWith('actrl:')) kvStore.delete(k);
  kvStore.set('accounts', JSON.stringify([
    { username: 'omar.beldi', hash: await hashPassword('Omar-Password-2'), role: 'am', displayName: 'Omar', amName: 'Omar Beldi', protected: false },
    { username: 'proprio', hash: await hashPassword('Secret-Proprio-1'), role: 'owner', displayName: 'P', amName: null, protected: true }
  ]));
  const am = (await call('POST', '/api/login', { username: 'omar.beldi', password: 'Omar-Password-2' })).json.token;
  // 20 envois simultanés : avec l'ancien modèle (une seule clé en
  // lecture-modification-écriture), certains auraient été écrasés.
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) =>
    call('POST', '/api/activity', { type: 'export', detail: 'Export concurrent ' + i }, am)));
  assert.ok(results.every((r) => r.status === 200), 'les 20 envois sont acceptés');
  const owner = (await call('POST', '/api/login', { username: 'proprio', password: 'Secret-Proprio-1' })).json.token;
  const entries = (await call('GET', '/api/activity', null, owner)).json.entries;
  assert.equal(entries.length, 21, '20 exports + 1 connexion, aucune perte');
  for (let i = 0; i < 20; i++) {
    assert.ok(entries.some((e) => e.detail === 'Export concurrent ' + i), 'Export concurrent ' + i + ' présent');
  }
});

test('I4 : chaque événement a sa propre clé avec TTL 90 jours', async () => {
  clearActivityKeys();
  kvStore.set('accounts', JSON.stringify([
    { username: 'omar.beldi', hash: await hashPassword('Omar-Password-2'), role: 'am', displayName: 'Omar', amName: 'Omar Beldi', protected: false }
  ]));
  const am = (await call('POST', '/api/login', { username: 'omar.beldi', password: 'Omar-Password-2' })).json.token;
  assert.equal((await call('POST', '/api/activity', { type: 'export', detail: 'Export TTL' }, am)).status, 200);
  const keys = [...kvStore.keys()].filter((k) => k.startsWith('activity:') && k !== 'activity:clearedAt');
  assert.equal(keys.length, 2, 'une clé par événement (connexion + export)');
  for (const k of keys) {
    assert.match(k, /^activity:\d{13}:[0-9a-f]{16}$/, 'clé activity:<ts inversé>:<aléatoire>');
    assert.equal(kvMeta.get(k).expirationTtl, ACTIVITY_TTL_SECONDS, 'TTL 90 jours');
    assert.equal(kvMeta.get(k).expirationTtl, 90 * 24 * 3600);
  }
  // Plus aucune écriture dans l'ancienne clé unique.
  assert.equal(kvStore.has('activity_log'), false);
});

test("I4 : GET fusionne l'ancien journal, DELETE efface tout (nouveau + ancien)", async () => {
  clearActivityKeys();
  const now = Date.now();
  // Ancien modèle : 2 entrées dans la clé unique (horodatages passés).
  kvStore.set('activity_log', JSON.stringify([
    { ts: now - 3600000, user: 'omar.beldi', type: 'export', detail: 'Ancien export 1' },
    { ts: now - 1800000, user: 'omar.beldi', type: 'login', detail: 'Ancienne connexion' }
  ]));
  kvStore.set('accounts', JSON.stringify([
    { username: 'omar.beldi', hash: await hashPassword('Omar-Password-2'), role: 'am', displayName: 'Omar', amName: 'Omar Beldi', protected: false },
    { username: 'proprio', hash: await hashPassword('Secret-Proprio-1'), role: 'owner', displayName: 'P', amName: null, protected: true }
  ]));
  const am = (await call('POST', '/api/login', { username: 'omar.beldi', password: 'Omar-Password-2' })).json.token;
  assert.equal((await call('POST', '/api/activity', { type: 'export', detail: 'Nouvel export' }, am)).status, 200);
  const owner = (await call('POST', '/api/login', { username: 'proprio', password: 'Secret-Proprio-1' })).json.token;
  // Lecture : 4 entrées (2 nouvelles + 2 anciennes), plus récentes d'abord.
  const before = (await call('GET', '/api/activity', null, owner)).json.entries;
  assert.equal(before.length, 4);
  assert.ok(before.some((e) => e.detail === 'Ancien export 1'), 'ancien journal toujours lisible');
  assert.ok(before.some((e) => e.detail === 'Nouvel export'));
  // Effacement : plus rien, et l'ancienne clé a disparu.
  assert.equal((await call('DELETE', '/api/activity', null, owner)).status, 200);
  assert.equal((await call('GET', '/api/activity', null, owner)).json.entries.length, 0);
  assert.equal(kvStore.has('activity_log'), false, 'ancienne clé supprimée');
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

// ---- Déconnexion côté serveur (audit 2026-11-27, item 8) ----
test('déconnexion côté serveur : POST /api/logout invalide tous les jetons du compte, reconnexion possible', async () => {
  kvStore.set('accounts', JSON.stringify([
    { username: 'proprio', hash: await hashPassword('Secret-Proprio-1'), role: 'owner', displayName: 'P', amName: null, protected: true },
    { username: 'omar.beldi', hash: await hashPassword('Omar-Password-2'), role: 'am', displayName: 'Omar', amName: 'Omar Beldi', protected: false }
  ]));
  // Sans jeton -> 401.
  assert.equal((await call('POST', '/api/logout')).status, 401);
  // Deux jetons du même compte (ex. deux appareils, ou « se souvenir de moi »).
  const am1 = (await call('POST', '/api/login', { username: 'omar.beldi', password: 'Omar-Password-2' })).json.token;
  const am2 = (await call('POST', '/api/login', { username: 'omar.beldi', password: 'Omar-Password-2', remember: true })).json.token;
  assert.equal((await call('GET', '/api/me', null, am1)).status, 200);
  assert.equal((await call('GET', '/api/me', null, am2)).status, 200);
  // Déconnexion avec le premier jeton : les deux meurent immédiatement.
  assert.equal((await call('POST', '/api/logout', null, am1)).status, 200);
  assert.equal((await call('GET', '/api/me', null, am1)).status, 401);
  assert.equal((await call('GET', '/api/me', null, am2)).status, 401);
  // Le jeton du propriétaire n'est pas touché ; la reconnexion AM fonctionne.
  const owner = (await call('POST', '/api/login', { username: 'proprio', password: 'Secret-Proprio-1' })).json.token;
  assert.equal((await call('GET', '/api/me', null, owner)).status, 200);
  const amFresh = (await call('POST', '/api/login', { username: 'omar.beldi', password: 'Omar-Password-2' })).json.token;
  assert.equal((await call('GET', '/api/me', null, amFresh)).status, 200);
});

// ---- G2 (audit 2026-11-27) : la déconnexion ne touche plus jamais `accounts` ----
test('G2 : la déconnexion n\'écrit jamais dans accounts — seule une clé rev: est créée', async () => {
  kvStore.set('accounts', JSON.stringify([
    { username: 'proprio', hash: await hashPassword('Secret-Proprio-1'), role: 'owner', displayName: 'P', amName: null, protected: true },
    { username: 'omar.beldi', hash: await hashPassword('Omar-Password-2'), role: 'am', displayName: 'Omar', amName: 'Omar Beldi', protected: false }
  ]));
  kvStore.delete('rev:omar.beldi');
  const before = kvStore.get('accounts');
  const am = (await call('POST', '/api/login', { username: 'omar.beldi', password: 'Omar-Password-2' })).json.token;
  assert.equal((await call('POST', '/api/logout', null, am)).status, 200);
  assert.equal(kvStore.get('accounts'), before, 'accounts inchangé par la déconnexion');
  assert.equal(kvStore.get('rev:omar.beldi'), '1', 'compteur rev:omar.beldi incrémenté à 1');
  assert.equal((await call('GET', '/api/me', null, am)).status, 401, 'ancien jeton rejeté après déconnexion');
  // Reconnexion immédiate (souvent dans la même seconde) : le nouveau jeton est valide.
  const fresh = (await call('POST', '/api/login', { username: 'omar.beldi', password: 'Omar-Password-2' })).json.token;
  assert.equal((await call('GET', '/api/me', null, fresh)).status, 200, 'reconnexion immédiate possible');
});

test('G2 (a) : changement de mot de passe concurrent avec une déconnexion — le nouveau mot de passe gagne', async () => {
  kvStore.set('accounts', JSON.stringify([
    { username: 'proprio', hash: await hashPassword('Secret-Proprio-1'), role: 'owner', displayName: 'P', amName: null, protected: true },
    { username: 'omar.beldi', hash: await hashPassword('Omar-Password-2'), role: 'am', displayName: 'Omar', amName: 'Omar Beldi', protected: false },
    { username: 'aziza.souli', hash: await hashPassword('Aziza-Password-2'), role: 'am', displayName: 'Aziza', amName: 'Aziza Souli', protected: false }
  ]));
  const tokenA = (await call('POST', '/api/login', { username: 'omar.beldi', password: 'Omar-Password-2' })).json.token;
  const owner = (await call('POST', '/api/login', { username: 'proprio', password: 'Secret-Proprio-1' })).json.token;
  // A se déconnecte pendant que le proprio change le mot de passe de B.
  const [logoutRes, putRes] = await Promise.all([
    call('POST', '/api/logout', null, tokenA),
    call('PUT', '/api/accounts/aziza.souli', { password: 'Nouveau-Password-9', role: 'am', amName: 'Aziza Souli', displayName: 'Aziza' }, owner)
  ]);
  assert.equal(logoutRes.status, 200);
  assert.equal(putRes.status, 200);
  // A est bien déconnecté.
  assert.equal((await call('GET', '/api/me', null, tokenA)).status, 401);
  // Le nouveau mot de passe de B marche, l'ancien est refusé (pas de retour en arrière).
  assert.equal((await call('POST', '/api/login', { username: 'aziza.souli', password: 'Aziza-Password-2' })).status, 401);
  const freshB = (await call('POST', '/api/login', { username: 'aziza.souli', password: 'Nouveau-Password-9' })).json.token;
  assert.equal((await call('GET', '/api/me', null, freshB)).status, 200);
  // Les deux comptes sont toujours là.
  const list = (await call('GET', '/api/accounts', null, owner)).json.accounts;
  assert.ok(list.some((a) => a.username === 'omar.beldi'));
  assert.ok(list.some((a) => a.username === 'aziza.souli'));
});

test('G2 (d) : suppression concurrente avec une déconnexion — le compte reste supprimé', async () => {
  kvStore.set('accounts', JSON.stringify([
    { username: 'proprio', hash: await hashPassword('Secret-Proprio-1'), role: 'owner', displayName: 'P', amName: null, protected: true },
    { username: 'omar.beldi', hash: await hashPassword('Omar-Password-2'), role: 'am', displayName: 'Omar', amName: 'Omar Beldi', protected: false }
  ]));
  const tokenB = (await call('POST', '/api/login', { username: 'omar.beldi', password: 'Omar-Password-2' })).json.token;
  const owner = (await call('POST', '/api/login', { username: 'proprio', password: 'Secret-Proprio-1' })).json.token;
  // Le proprio supprime B pendant que B se déconnecte.
  const [delRes, logoutRes] = await Promise.all([
    call('DELETE', '/api/accounts/omar.beldi', null, owner),
    call('POST', '/api/logout', null, tokenB)
  ]);
  assert.equal(delRes.status, 200, 'la suppression aboutit');
  // La déconnexion répond 200 (avant la suppression) ou 401 (compte déjà parti) selon l'ordre.
  assert.ok([200, 401].includes(logoutRes.status), 'déconnexion concurrente : 200 ou 401, jamais de résurrection');
  const list = (await call('GET', '/api/accounts', null, owner)).json.accounts;
  assert.ok(list.every((a) => a.username !== 'omar.beldi'), 'le compte reste supprimé');
  assert.equal((await call('POST', '/api/login', { username: 'omar.beldi', password: 'Omar-Password-2' })).status, 401);
  assert.equal((await call('GET', '/api/me', null, tokenB)).status, 401);
});

test('G2 : migration d\'ancien hash — un changement de mot de passe concurrent n\'est pas écrasé', async () => {
  kvStore.set('accounts', JSON.stringify([
    { username: 'proprio', hash: await hashPassword('Secret-Proprio-1'), role: 'owner', displayName: 'P', amName: null, protected: true },
    { username: 'omar.beldi', hash: await legacy('Omar-Password-2'), role: 'am', displayName: 'Omar', amName: 'Omar Beldi', protected: false }
  ]));
  // On simule le changement concurrent du proprio : il a lieu entre la
  // vérification du mot de passe (1re lecture de `accounts`) et la migration
  // (2e lecture). Sans la garde, la migration réécrirait l'ancien mot de passe.
  const origGet = kv.get;
  let reads = 0;
  kv.get = async (k, t) => {
    if (k === 'accounts') {
      reads++;
      if (reads === 2) {
        const list = JSON.parse(kvStore.get('accounts'));
        const target = list.find((a) => a.username === 'omar.beldi');
        target.hash = await hashPassword('Nouveau-Password-9');
        target.pwdVersion = 1;
        kvStore.set('accounts', JSON.stringify(list));
      }
    }
    return origGet(k, t);
  };
  try {
    // La connexion avec l'ancien mot de passe aboutit (il était valide au moment de la vérification).
    const r = await call('POST', '/api/login', { username: 'omar.beldi', password: 'Omar-Password-2' });
    assert.equal(r.status, 200);
    // Mais le nouveau mot de passe du proprio n'a pas été écrasé par la migration.
    assert.equal((await call('POST', '/api/login', { username: 'omar.beldi', password: 'Nouveau-Password-9' })).status, 200);
    assert.equal((await call('POST', '/api/login', { username: 'omar.beldi', password: 'Omar-Password-2' })).status, 401);
    // Le jeton émis pendant la course meurt aussi (version du mot de passe changée).
    assert.equal((await call('GET', '/api/me', null, r.json.token)).status, 401);
  } finally {
    kv.get = origGet;
  }
});

// ---- I1 (audit 2026-11-27) : le limiteur ne peut plus être épuisé puis contourné ----
test("I1 : identifiant invalide -> 400 avant le limiteur (aucune instance d'objet durable créée)", async () => {
  let doCalls = 0;
  const envTracked = {
    ...env,
    RATE_LIMITER: {
      idFromName: (n) => { doCalls++; return n; },
      get: () => { doCalls++; return { fetch: async () => { doCalls++; return new Response(JSON.stringify({ allowed: true })); } }; }
    }
  };
  const callTracked = (method, path, body, token) => handle(new Request('https://api.test' + path, {
    method, body: body ? JSON.stringify(body) : undefined,
    headers: { Origin: 'https://app.test', ...(token ? { Authorization: 'Bearer ' + token } : {}) }
  }), envTracked).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));
  assert.equal((await callTracked('POST', '/api/login', { username: 'a!b', password: 'x' })).status, 400);
  assert.equal((await callTracked('POST', '/api/login', { username: 'a', password: 'x' })).status, 400);
  assert.equal((await callTracked('POST', '/api/login', { username: 'a'.repeat(41), password: 'x' })).status, 400);
  assert.equal((await callTracked('POST', '/api/login', { username: 'avec espace', password: 'x' })).status, 400);
  assert.equal(doCalls, 0, 'le limiteur ne doit pas être appelé pour un identifiant invalide');
  // Un identifiant au bon format mais inexistant passe le filtre et atteint le limiteur (401).
  assert.equal((await callTracked('POST', '/api/login', { username: 'inconnu', password: 'x' })).status, 401);
  assert.ok(doCalls > 0, 'le limiteur est consulté pour un identifiant au bon format');
});

test('I1 : 50 échecs depuis la même IP (identifiants différents) puis 429 via le compteur par IP', async () => {
  const ip = '203.0.113.7';
  const ip2 = '203.0.113.8';
  kvStore.delete(`rl:${ip}`);
  kvStore.delete(`rl:${ip2}`);
  const callIp = (useIp) => (method, path, body, token) => handle(new Request('https://api.test' + path, {
    method, body: body ? JSON.stringify(body) : undefined,
    headers: { Origin: 'https://app.test', 'CF-Connecting-IP': useIp, ...(token ? { Authorization: 'Bearer ' + token } : {}) }
  }), env).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));
  const fromIp = callIp(ip);
  // 50 échecs avec 50 identifiants différents : le compteur par IP+identifiant
  // (5/15 min) ne bloque jamais (1 seul échec par identifiant) — seul le
  // compteur par IP (50/15 min) compte.
  for (let i = 0; i < 50; i++) {
    assert.equal((await fromIp('POST', '/api/login', { username: 'user' + i, password: 'faux' })).status, 401, 'échec ' + (i + 1));
  }
  assert.equal((await fromIp('POST', '/api/login', { username: 'user50', password: 'faux' })).status, 429, '51e échec depuis la même IP : bloqué par le compteur par IP');
  // Une autre IP n'est pas bloquée.
  assert.equal((await callIp(ip2)('POST', '/api/login', { username: 'user50', password: 'faux' })).status, 401);
  kvStore.delete(`rl:${ip}`);
  kvStore.delete(`rl:${ip2}`);
});

test("I1 : l'objet durable nettoie ses entrées expirées via alarm()", async () => {
  const alarmStore = new Map();
  let scheduled = null;
  const storage = {
    get: async (k) => alarmStore.get(k) ?? null,
    put: async (k, v) => void alarmStore.set(k, v),
    delete: async (k) => void alarmStore.delete(k),
    list: async () => new Map(alarmStore),
    setAlarm: async (t) => { scheduled = t; },
    getAlarm: async () => scheduled
  };
  const rl = new RateLimiter({ storage });
  const check = (key) => rl.fetch(new Request('https://rl/check', { method: 'POST', body: JSON.stringify({ key, max: 5, windowMs: 900000 }) })).then((r) => r.json());
  // Une entrée vivante : une alarme est planifiée sur son expiration.
  assert.equal((await check('rl:1.2.3.4:omar.beldi')).allowed, true);
  assert.ok(scheduled !== null, 'une alarme est planifiée après un comptage');
  // Une entrée expirée + une vivante : l'alarme supprime l'expirée, garde la vivante.
  alarmStore.set('rl:9.9.9.9:vieux', { count: 5, resetAt: Date.now() - 1000 });
  rl.mem.set('rl:9.9.9.9:vieux', { count: 5, resetAt: Date.now() - 1000 });
  await rl.alarm();
  assert.equal(alarmStore.has('rl:9.9.9.9:vieux'), false, 'entrée expirée supprimée du stockage');
  assert.equal(rl.mem.has('rl:9.9.9.9:vieux'), false, 'entrée expirée supprimée de la mémoire');
  assert.equal(alarmStore.has('rl:1.2.3.4:omar.beldi'), true, 'entrée vivante conservée');
  assert.ok(scheduled !== null && scheduled > Date.now(), 'alarme replanifiée sur la prochaine échéance');
});

test('I1 : limiteur indisponible -> 503 sur /api/login, laisser-passer conservé pour /api/activity', async () => {
  kvStore.set('accounts', JSON.stringify([
    { username: 'proprio', hash: await hashPassword('Secret-Proprio-1'), role: 'owner', displayName: 'P', amName: null, protected: true },
    { username: 'omar.beldi', hash: await hashPassword('Omar-Password-2'), role: 'am', displayName: 'Omar', amName: 'Omar Beldi', protected: false }
  ]));
  const am = (await call('POST', '/api/login', { username: 'omar.beldi', password: 'Omar-Password-2' })).json.token;
  // Limiteur en panne : l'objet durable lève une exception ET le KV refuse
  // les lectures des compteurs (les autres clés KV fonctionnent).
  const kvLimiterDown = {
    get: async (k, t) => {
      if (String(k).startsWith('rl:') || String(k).startsWith('actrl:')) throw new Error('limiteur indisponible');
      return kv.get(k, t);
    },
    put: kv.put,
    delete: kv.delete
  };
  const envDown = { ...env, PULSE_KV: kvLimiterDown, RATE_LIMITER: { idFromName: () => { throw new Error('DO indisponible'); }, get: () => { throw new Error('DO indisponible'); } } };
  const callDown = (method, path, body, token) => handle(new Request('https://api.test' + path, {
    method, body: body ? JSON.stringify(body) : undefined,
    headers: { Origin: 'https://app.test', ...(token ? { Authorization: 'Bearer ' + token } : {}) }
  }), envDown).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));
  assert.equal((await callDown('POST', '/api/login', { username: 'omar.beldi', password: 'Omar-Password-2' })).status, 503);
  // Le journal ne doit jamais bloquer : l'envoi passe malgré le limiteur en panne.
  kvStore.delete('activity_log');
  assert.equal((await callDown('POST', '/api/activity', { type: 'export', detail: 'Export Excel : Test.xlsx' }, am)).status, 200);
});
