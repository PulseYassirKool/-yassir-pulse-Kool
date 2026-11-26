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
    const fails = Number(await env.PULSE_KV.get(rlKey)) || 0;
    if (fails >= MAX_FAILS) return fail(429, 'Trop de tentatives.');

    const account = (await listAccounts(env)).find((a) => a.username.toLowerCase() === username);
    // Même coût de calcul que le compte existe ou non (évite de révéler quels identifiants existent).
    const result = account ? await verifyPassword(account, password, env) : (await pbkdf2(password, new Uint8Array(16)), { ok: false });
    if (!result.ok) {
      await env.PULSE_KV.put(rlKey, String(fails + 1), { expirationTtl: LOCK_SECONDS });
      return fail(401, 'Identifiant ou mot de passe incorrect.');
    }
    await env.PULSE_KV.delete(rlKey);
    if (result.legacy) {
      const list = await listAccounts(env);
      const target = list.find((a) => a.username === account.username);
      target.hash = await hashPassword(password);
      await saveAccounts(env, list);
    }
    const now = Math.floor(Date.now() / 1000);
    const ttl = body.remember ? 7 * 24 * 3600 : 8 * 3600;
    // pv = version du mot de passe : quand le propriétaire change le mot de passe
    // d'un compte, pv est incrémenté et tous les jetons émis avant sont rejetés.
    const token = await sign({ sub: account.username, iat: now, exp: now + ttl, pv: account.pwdVersion || 0 }, env.JWT_SECRET);
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

  if (path === '/api/me' && method === 'GET') return reply({ user: publicUser(me) });

  if (path === '/api/bootstrap' && method === 'GET') {
    const [config, defaults] = await Promise.all([env.PULSE_KV.get('config', 'json'), env.PULSE_KV.get('defaults', 'json')]);
    return reply({ config: config || { live: {}, kool: {} }, defaults: defaults || { commissions: {}, portfolios: {} } });
  }

  // ---------- Gestion des comptes (propriétaire admin uniquement) ----------
  if (path.startsWith('/api/accounts')) {
    if (me.role !== 'owner') return fail(403, 'Accès réservé au propriétaire.');
    if (path === '/api/accounts' && method === 'GET') {
      return reply({ accounts: accounts.map((a) => ({ ...publicUser(a), protected: !!a.protected })) });
    }
    const name = decodeURIComponent(path.slice('/api/accounts/'.length)).trim().toLowerCase();
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
