// API Yassir Pulse — Cloudflare Worker.
// Rôle : vérifier les mots de passe (PBKDF2), émettre des jetons signés, gérer les comptes,
// et ne servir la configuration (IDs Google Sheets) et les données par défaut qu'aux utilisateurs connectés.
// Aucun secret ne vit dans le dépôt : env.JWT_SECRET, env.LEGACY_SALT, et le KV `PULSE_KV`.

const ROLES = ['owner', 'viewer_all', 'am', 'market_am'];
const ITERATIONS = 100000; // plafond PBKDF2 sur Workers
const MAX_FAILS = 5;
const LOCK_SECONDS = 900;
const enc = new TextEncoder();

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (buf) => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => unb64(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

function safeEqual(a, b) {
  const x = enc.encode(String(a)), y = enc.encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

async function pbkdf2(password, salt, iterations = ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(await pbkdf2(password, salt))}`;
}
async function verifyPassword(account, password, env) {
  const stored = account.hash || '';
  if (stored.startsWith('pbkdf2$')) {
    const [, it, salt, h] = stored.split('$');
    return { ok: safeEqual(b64(await pbkdf2(password, unb64(salt), Number(it))), h), legacy: false };
  }
  // Ancien format SHA-256(sel + mot de passe) : accepté une fois, puis remplacé par PBKDF2 à la connexion.
  const digest = hex(await crypto.subtle.digest('SHA-256', enc.encode((env.LEGACY_SALT || '') + password)));
  return { ok: safeEqual(digest, stored), legacy: true };
}

async function sign(payload, secret) {
  const head = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return `${head}.${body}.${b64url(await crypto.subtle.sign('HMAC', key, enc.encode(`${head}.${body}`)))}`;
}
async function verify(token, secret) {
  const [head, body, sig] = String(token).split('.');
  if (!head || !body || !sig) return null;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('HMAC', key, unb64url(sig), enc.encode(`${head}.${body}`));
  if (!ok) return null;
  const payload = JSON.parse(new TextDecoder().decode(unb64url(body)));
  return payload.exp > Math.floor(Date.now() / 1000) ? payload : null;
}

const publicUser = (a) => ({ username: a.username, role: a.role, displayName: a.displayName, amName: a.amName || null });
const listAccounts = async (env) => (await env.PULSE_KV.get('accounts', 'json')) || [];
const saveAccounts = (env, list) => env.PULSE_KV.put('accounts', JSON.stringify(list));

// ---------- Journal d'activité (AM uniquement, jamais le propriétaire) ----------
// Clé KV `activity_log` : tableau JSON [{ts, user, type, detail}], plafonné à
// 500 entrées (FIFO). La journalisation ne doit JAMAIS faire échouer la
// requête principale : appendActivity ne rejette jamais.
const ACTIVITY_LOG_KEY = 'activity_log';
const ACTIVITY_MAX = 500;
const ACTIVITY_MAX_PER_HOUR = 50; // par utilisateur (audit item 7) : anti-flood du journal
const ACTIVITY_TYPES = ['login', 'logout', 'login_fail', 'export', 'alerte'];
async function appendActivity(env, entry) {
  try {
    const list = (await env.PULSE_KV.get(ACTIVITY_LOG_KEY, 'json')) || [];
    list.push(entry);
    await env.PULSE_KV.put(ACTIVITY_LOG_KEY, JSON.stringify(list.slice(-ACTIVITY_MAX)));
  } catch (e) { /* journal indisponible : on continue sans journaliser */ }
}

// ---------- Limitation de débit des connexions (audit 2026-11-27, item 3) ----------
// Le compteur d'échecs en KV seul se contourne : des essais envoyés en
// parallèle lisent tous « 0 échec » avant d'écrire. L'objet durable
// RateLimiter sérialise les tentatives (une seule instance par clé
// ip+identifiant, donc lecture + incrément atomiques).
// La règle de limitation Cloudflare n'est pas applicable ici : le compte
// n'a aucune zone (le Worker est sur tun-omar.workers.dev, pas sur un
// domaine du compte), et les règles de débit sont liées à une zone.
// Repli : si la liaison RATE_LIMITER est absente (tests, ancien
// déploiement), on garde le compteur KV — le blocage séquentiel
// fonctionne, seule la protection contre les essais parallèles manque.
export class RateLimiter {
  constructor(state) {
    this.state = state;
    this.mem = new Map();
    this.queue = new Map(); // clé -> chaîne de promesses : les appels concurrents
    // pour une même clé s'exécutent en file, jamais en parallèle.
  }
  async _load(key) {
    if (this.mem.has(key)) return this.mem.get(key);
    let entry = null;
    try {
      if (this.state && this.state.storage) entry = await this.state.storage.get(key);
    } catch (e) { entry = null; }
    if (entry) this.mem.set(key, entry);
    return entry;
  }
  async _save(key, entry) {
    this.mem.set(key, entry);
    try {
      if (this.state && this.state.storage) await this.state.storage.put(key, entry);
    } catch (e) { /* mémoire seule */ }
  }
  async _clear(key) {
    this.mem.delete(key);
    try {
      if (this.state && this.state.storage) await this.state.storage.delete(key);
    } catch (e) {}
  }
  async fetch(request) {
    const body = await request.json().catch(() => ({}));
    const key = String(body.key || '');
    if (!key) return new Response(JSON.stringify({ error: 'key requise' }), { status: 400 });
    // File d'attente par clé : lecture + incrément + écriture atomiques,
    // même si plusieurs appels arrivent en même temps.
    const prev = this.queue.get(key) || Promise.resolve();
    const next = prev.then(() => this._traiter(key, body));
    this.queue.set(key, next.catch(() => {}));
    return next;
  }
  async _traiter(key, body) {
    if (body.reset) {
      await this._clear(key);
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    }
    const max = Number(body.max) || 5;
    const windowMs = Number(body.windowMs) || 900000;
    const now = Date.now();
    let entry = await this._load(key);
    if (!entry || now >= entry.resetAt) entry = { count: 0, resetAt: now + windowMs };
    entry.count += 1;
    await this._save(key, entry);
    return new Response(JSON.stringify({ allowed: entry.count <= max, count: entry.count, resetAt: entry.resetAt }), { headers: { 'Content-Type': 'application/json' } });
  }
}

// Enregistre une tentative et dit si elle est autorisée (compteur <= max
// dans la fenêtre). Avec l'objet durable, lecture + incrément atomiques ;
// repli KV sinon (le compteur est alors incrémenté ici). Le limiteur ne
// doit jamais empêcher une action légitime : en cas d'erreur, on laisse passer.
async function rlCheck(env, rlKey, max = MAX_FAILS, windowMs = LOCK_SECONDS * 1000) {
  if (env.RATE_LIMITER) {
    try {
      const stub = env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(rlKey));
      const r = await stub.fetch(new Request('https://rl/check', { method: 'POST', body: JSON.stringify({ key: rlKey, max, windowMs }) }));
      const j = await r.json().catch(() => ({}));
      return { allowed: j.allowed !== false, useDo: true };
    } catch (e) { /* repli KV ci-dessous */ }
  }
  try {
    const count = Number(await env.PULSE_KV.get(rlKey)) || 0;
    if (count >= max) return { allowed: false, useDo: false };
    await env.PULSE_KV.put(rlKey, String(count + 1), { expirationTtl: Math.ceil(windowMs / 1000) });
    return { allowed: true, useDo: false };
  } catch (e) {
    return { allowed: true, useDo: false };
  }
}
async function rlReset(env, rlKey, useDo) {
  try { await env.PULSE_KV.delete(rlKey); } catch (e) {}
  if (!useDo || !env.RATE_LIMITER) return;
  try {
    const stub = env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(rlKey));
    await stub.fetch(new Request('https://rl/reset', { method: 'POST', body: JSON.stringify({ key: rlKey, reset: true }) }));
  } catch (e) { /* réinitialisation du compteur non critique */ }
}

function cors(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim());
  const h = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin'
  };
  if (origin && allowed.includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
    h['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
  }
  return h;
}

export async function handle(request, env) {
  const headers = cors(request, env);
  const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });
  const fail = (status, error) => reply({ error }, status);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) return fail(500, 'Configuration serveur incomplète.');

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;

  // ---------- Connexion ----------
  if (path === '/api/login' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const username = String(body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!username || !password || password.length > 200) return fail(400, 'Identifiants requis.');

    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    const rlKey = `rl:${ip}:${username}`;
    const rl = await rlCheck(env, rlKey);
    if (!rl.allowed) return fail(429, 'Trop de tentatives.');

    const account = (await listAccounts(env)).find((a) => a.username.toLowerCase() === username);
    // Même coût de calcul que le compte existe ou non (évite de révéler quels identifiants existent).
    const result = account ? await verifyPassword(account, password, env) : (await pbkdf2(password, new Uint8Array(16)), { ok: false });
    if (!result.ok) {
      // Tentative échouée sur un compte existant (hors propriétaire) : journalisée.
      // Jamais de mot de passe dans le journal, ni de journalisation si le compte n'existe pas.
      if (account && account.role !== 'owner') {
        await appendActivity(env, { ts: Date.now(), user: account.username, type: 'login_fail', detail: 'Tentative de connexion échouée' });
      }
      return fail(401, 'Identifiant ou mot de passe incorrect.');
    }
    await rlReset(env, rlKey, rl.useDo);
    if (result.legacy) {
      const list = await listAccounts(env);
      const target = list.find((a) => a.username === account.username);
      // G2 : ne migrer que si l'entrée est strictement inchangée depuis la
      // vérification du mot de passe. Si le propriétaire a changé le mot de
      // passe (ou supprimé le compte) entre-temps, on ne réécrit rien : sans
      // cela, l'ancien mot de passe réapparaissait et la suppression pouvait
      // être annulée. Le KV n'offre pas de CAS : une modification entre cette
      // relecture et l'écriture reste théoriquement possible (fenêtre de
      // quelques ms) — la migration ne porte que sur un hash, jamais sur un
      // mot de passe en clair.
      if (target && target.hash === account.hash) {
        target.hash = await hashPassword(password);
        await saveAccounts(env, list);
      }
    }
    const now = Math.floor(Date.now() / 1000);
    const ttl = body.remember ? 7 * 24 * 3600 : 8 * 3600;
    // G2 : le jeton porte la génération de révocation en vigueur (`rv`) :
    // après une déconnexion, la génération augmente et les jetons émis avant
    // sont rejetés (voir le contrôle dans les routes protégées).
    const revGen = Number(await env.PULSE_KV.get(`rev:${account.username}`)) || 0;
    // pv = version du mot de passe : quand le propriétaire change le mot de passe
    // d'un compte, pv est incrémenté et tous les jetons émis avant sont rejetés.
    const token = await sign({ sub: account.username, iat: now, exp: now + ttl, pv: account.pwdVersion || 0, rv: revGen }, env.JWT_SECRET);
    // Connexion réussie d'un non-propriétaire : journalisée côté serveur.
    if (account.role !== 'owner') {
      await appendActivity(env, { ts: Date.now(), user: account.username, type: 'login', detail: 'Connexion' });
    }
    return reply({ token, user: publicUser(account) });
  }

  // ---------- Routes protégées ----------
  const bearer = (request.headers.get('Authorization') || '').replace(/^Bearer /, '');
  const claims = bearer ? await verify(bearer, env.JWT_SECRET).catch(() => null) : null;
  if (!claims) return fail(401, 'Session expirée.');
  const accounts = await listAccounts(env);
  const me = accounts.find((a) => a.username === claims.sub); // rôle relu à chaque appel : une suppression prend effet tout de suite
  if (!me) return fail(401, 'Compte introuvable.');
  // Mot de passe changé depuis l'émission du jeton (par le propriétaire) :
  // la session meurt immédiatement (le front déconnecte sur ce 401).
  if ((claims.pv || 0) !== (me.pwdVersion || 0)) return fail(401, 'Session expirée.');
  // Révocation à la déconnexion (G2, audit 2026-11-27) : chaque déconnexion
  // incrémente un compteur `rev:<identifiant>` ; le jeton porte le compteur
  // en vigueur à son émission (`rv`). Un jeton d'une génération antérieure
  // est rejeté. Un compteur (et non un horodatage) : aucun problème de
  // granularité quand déconnexion et reconnexion s'enchaînent dans la même
  // seconde. La clé ne touche jamais au tableau des comptes, donc une
  // déconnexion concurrente avec un changement de mot de passe ou une
  // suppression ne peut plus annuler l'autre opération. Une clé par compte :
  // pas d'accumulation à nettoyer.
  const revGen = Number(await env.PULSE_KV.get(`rev:${me.username}`)) || 0;
  if ((claims.rv || 0) !== revGen) return fail(401, 'Session expirée.');

  if (path === '/api/me' && method === 'GET') return reply({ user: publicUser(me) });

  // Déconnexion côté serveur (audit 2026-11-27, item 8 ; G2) : la déconnexion
  // ne touche PLUS JAMAIS au tableau des comptes — elle incrémente seulement
  // le compteur `rev:<identifiant>`. Tout jeton d'une génération antérieure
  // est rejeté à chaque requête authentifiée (voir ci-dessus), y compris le
  // jeton 7 jours « se souvenir de moi ». La déconnexion coupe toujours
  // toutes les sessions du compte : comportement voulu pour l'instant.
  // Rôle indifférent ; la journalisation reste côté front (yassirJournaliser,
  // avant l'appel).
  if (path === '/api/logout' && method === 'POST') {
    const cur = Number(await env.PULSE_KV.get(`rev:${me.username}`)) || 0;
    await env.PULSE_KV.put(`rev:${me.username}`, String(cur + 1));
    return reply({ ok: true });
  }

  if (path === '/api/bootstrap' && method === 'GET') {
    const [config, defaults] = await Promise.all([env.PULSE_KV.get('config', 'json'), env.PULSE_KV.get('defaults', 'json')]);
    return reply({ config: config || { live: {}, kool: {} }, defaults: defaults || { commissions: {}, portfolios: {} } });
  }

  // ---------- Journal d'activité (AM uniquement) ----------
  if (path === '/api/activity') {
    if (method === 'POST') {
      const b = await request.json().catch(() => ({}));
      // Le propriétaire n'est jamais journalisé : on répond OK sans rien stocker.
      if (me.role === 'owner') return reply({ ok: true });
      const type = String(b.type || '');
      const detail = String(b.detail || '').slice(0, 200);
      if (!ACTIVITY_TYPES.includes(type) || !detail) return fail(400, 'Événement invalide.');
      // Limite anti-flood (audit item 7) : 50 événements par heure et par
      // utilisateur — un AM ne peut pas inonder le journal et effacer ses traces.
      const bucket = Math.floor(Date.now() / 3600000);
      const actrl = await rlCheck(env, `actrl:${me.username}:${bucket}`, ACTIVITY_MAX_PER_HOUR, 3600000);
      if (!actrl.allowed) return fail(429, 'Trop d\'événements, réessayez plus tard.');
      await appendActivity(env, { ts: Date.now(), user: me.username, type, detail });
      return reply({ ok: true });
    }
    if (me.role !== 'owner') return fail(403, 'Accès réservé au propriétaire.');
    if (method === 'GET') {
      const list = (await env.PULSE_KV.get(ACTIVITY_LOG_KEY, 'json')) || [];
      return reply({ entries: list.slice(-ACTIVITY_MAX).reverse() });
    }
    if (method === 'DELETE') {
      await env.PULSE_KV.delete(ACTIVITY_LOG_KEY);
      return reply({ ok: true });
    }
  }

  // ---------- Gestion des comptes (propriétaire admin uniquement) ----------
  if (path.startsWith('/api/accounts')) {
    if (me.role !== 'owner') return fail(403, 'Accès réservé au propriétaire.');
    if (path === '/api/accounts' && method === 'GET') {
      return reply({ accounts: accounts.map((a) => ({ ...publicUser(a), protected: !!a.protected })) });
    }
    // Un identifiant mal encodé (% isolé, séquence UTF-8 invalide) faisait
    // planter le Worker (500 sans en-têtes CORS) — on renvoie une 400 propre.
    let name;
    try {
      name = decodeURIComponent(path.slice('/api/accounts/'.length)).trim().toLowerCase();
    } catch (e) {
      return fail(400, 'Identifiant invalide.');
    }
    if (!/^[a-z0-9._-]{2,40}$/.test(name)) return fail(400, 'Identifiant invalide.');
    const idx = accounts.findIndex((a) => a.username.toLowerCase() === name);

    if (method === 'PUT') {
      const b = await request.json().catch(() => ({}));
      if (!ROLES.includes(b.role)) return fail(400, 'Rôle invalide.');
      if (idx === -1 && !b.password) return fail(400, 'Mot de passe requis pour un nouveau compte.');
      if (b.password && (String(b.password).length < 10 || String(b.password).length > 200)) return fail(400, 'Mot de passe : 10 caractères minimum.');
      const owners = accounts.filter((a) => a.role === 'owner' && a.username !== name).length;
      if (b.role !== 'owner' && idx !== -1 && accounts[idx].role === 'owner' && owners === 0) return fail(400, 'Il doit rester un propriétaire.');
      const next = {
        username: idx === -1 ? name : accounts[idx].username,
        hash: b.password ? await hashPassword(String(b.password)) : accounts[idx].hash,
        // Changer le mot de passe incrémente la version : tous les jetons
        // émis avant (sessions en cours du compte) sont rejetés.
        pwdVersion: b.password ? (((idx === -1 ? 0 : accounts[idx].pwdVersion) || 0) + 1) : (idx === -1 ? 0 : (accounts[idx].pwdVersion || 0)),
        role: b.role,
        displayName: String(b.displayName || b.amName || name).slice(0, 60),
        amName: b.amName ? String(b.amName).slice(0, 60) : null,
        protected: idx === -1 ? false : !!accounts[idx].protected
      };
      if (idx === -1) accounts.push(next); else accounts[idx] = next;
      await saveAccounts(env, accounts);
      return reply({ ok: true });
    }
    if (method === 'DELETE') {
      if (idx === -1) return fail(404, 'Compte introuvable.');
      if (accounts[idx].protected) return fail(403, 'Compte protégé.');
      if (accounts[idx].username === me.username) return fail(400, 'Impossible de supprimer votre propre compte.');
      accounts.splice(idx, 1);
      await saveAccounts(env, accounts);
      return reply({ ok: true });
    }
  }
  return fail(404, 'Introuvable.');
}

export default { fetch: handle };
