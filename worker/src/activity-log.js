// Journal d'activité (I4) : une clé KV par événement, TTL 90 jours.
// L'ancien modèle (une seule clé `activity_log` en lecture-modification-
// écriture) perdait des événements quand deux écritures se croisaient : deux
// requêtes lisaient le même tableau, ajoutaient leur entrée et écrivaient,
// la seconde écrasant la première. Ici chaque événement a sa propre clé,
// donc des écritures concurrentes ne peuvent plus se perdre.
//
// Clé : `activity:<horodatage inversé>:<aléatoire>` — l'horodatage inversé
// (9999999999999 - ts) fait que l'ordre lexicographique des clés = les plus
// récentes d'abord : un seul `list({ prefix: 'activity:', limit: 500 })`
// renvoie les 500 dernières entrées, sans lire chaque valeur.
// L'entrée elle-même vit dans les métadonnées de la clé (<= 1 024 octets :
// { ts, user, type, detail } avec detail plafonné à 200 caractères) ; la
// valeur est vide. TTL 90 jours : les vieilles clés expirent seules.
//
// DELETE : efface physiquement jusqu'à 40 clés (budget de sous-requêtes du
// plan gratuit : 50 par invocation) + l'ancienne clé `activity_log`, et pose
// un marqueur `activity:clearedAt` (horodatage) : GET ignore toute entrée
// antérieure au marqueur. Le contrat HTTP est donc respecté en un seul
// appel même avec des centaines d'entrées ; les clés restantes expirent
// par TTL. Les entrées de l'ancien journal (`activity_log`, si présent)
// sont fusionnées en lecture et supprimées par DELETE, pour ne pas perdre
// l'historique au changement de modèle.

export const ACTIVITY_TTL_SECONDS = 90 * 24 * 3600; // 7 776 000 s = 90 jours
export const ACTIVITY_MAX = 500; // plafond de lecture
export const ACTIVITY_MAX_PER_HOUR = 50; // par utilisateur (anti-flood)
export const ACTIVITY_TYPES = ['login', 'logout', 'login_fail', 'export', 'alerte'];
const ACTIVITY_PREFIX = 'activity:';
const ACTIVITY_KEY_RE = /^activity:\d{13}:[0-9a-f]+$/;
const DELETE_BATCH = 40; // clés effacées physiquement par appel DELETE

const randomHex = (bytes = 8) => [...crypto.getRandomValues(new Uint8Array(bytes))]
  .map((b) => b.toString(16).padStart(2, '0')).join('');

export function activityKey(ts, rand = randomHex()) {
  const rev = String(9999999999999 - ts).padStart(13, '0');
  return `${ACTIVITY_PREFIX}${rev}:${rand}`;
}

// Ajoute une entrée. Ne rejette jamais : un journal en panne ne doit pas
// casser la requête principale (connexion, export...).
export async function appendActivity(env, entry) {
  try {
    const ts = Number(entry.ts) || Date.now();
    await env.PULSE_KV.put(
      activityKey(ts),
      '',
      { expirationTtl: ACTIVITY_TTL_SECONDS, metadata: { ts, user: entry.user, type: entry.type, detail: entry.detail } }
    );
  } catch (e) { /* journal indisponible : on continue sans journaliser */ }
}

async function readClearedAt(env) {
  try {
    const raw = await env.PULSE_KV.get('activity:clearedAt');
    return Number(raw) || 0;
  } catch (e) {
    return 0;
  }
}

async function listNewEntries(env, clearedAt, limit) {
  if (!env.PULSE_KV || typeof env.PULSE_KV.list !== 'function') return [];
  const entries = [];
  let cursor = null;
  // Les clés sont triées (plus récentes d'abord) : on s'arrête dès qu'on a
  // assez d'entrées postérieures au marqueur. Une page = 1 sous-requête.
  for (let pages = 0; pages < 5 && entries.length < limit; pages++) {
    let page;
    try {
      page = await env.PULSE_KV.list({ prefix: ACTIVITY_PREFIX, limit: 1000, ...(cursor ? { cursor } : {}) });
    } catch (e) {
      break;
    }
    const keys = (page && page.keys) || [];
    for (const k of keys) {
      if (!ACTIVITY_KEY_RE.test(k.name)) continue;
      const m = k.metadata;
      if (!m || typeof m.ts !== 'number') continue;
      if (m.ts <= clearedAt) continue;
      entries.push({ ts: m.ts, user: m.user, type: m.type, detail: m.detail });
      if (entries.length >= limit) break;
    }
    if (!page || page.list_complete || !page.cursor) break;
    cursor = page.cursor;
  }
  return entries;
}

async function readLegacyEntries(env, clearedAt) {
  try {
    const list = (await env.PULSE_KV.get('activity_log', 'json')) || [];
    return (Array.isArray(list) ? list : [])
      .filter((e) => e && typeof e.ts === 'number' && e.ts > clearedAt)
      .map((e) => ({ ts: e.ts, user: e.user, type: e.type, detail: e.detail }));
  } catch (e) {
    return [];
  }
}

// Les 500 dernières entrées, plus récentes d'abord (nouveau modèle +
// ancien journal fusionnés, le cas échéant).
export async function listActivity(env, limit = ACTIVITY_MAX) {
  const clearedAt = await readClearedAt(env);
  const [fresh, legacy] = await Promise.all([listNewEntries(env, clearedAt, limit), readLegacyEntries(env, clearedAt)]);
  const all = fresh.concat(legacy);
  all.sort((a, b) => b.ts - a.ts);
  return all.slice(0, limit);
}

// Efface le journal : suppression physique par pages (jusqu'à 40 clés) +
// marqueur d'effacement (couvre le reste immédiatement) + suppression de
// l'ancienne clé `activity_log`. Renvoie le nombre de clés effacées.
export async function clearActivity(env) {
  let deleted = 0;
  try {
    if (env.PULSE_KV && typeof env.PULSE_KV.list === 'function') {
      let cursor = null;
      for (let pages = 0; pages < 5 && deleted < DELETE_BATCH; pages++) {
        let page;
        try {
          page = await env.PULSE_KV.list({ prefix: ACTIVITY_PREFIX, limit: 1000, ...(cursor ? { cursor } : {}) });
        } catch (e) {
          break;
        }
        const keys = (page && page.keys) || [];
        for (const k of keys) {
          if (deleted >= DELETE_BATCH) break;
          if (!ACTIVITY_KEY_RE.test(k.name)) continue;
          try { await env.PULSE_KV.delete(k.name); deleted += 1; } catch (e) { /* on continue */ }
        }
        if (!page || page.list_complete || !page.cursor) break;
        cursor = page.cursor;
      }
    }
  } catch (e) { /* l'effacement ne doit pas échouer la requête */ }
  try { await env.PULSE_KV.delete('activity_log'); } catch (e) {}
  try { await env.PULSE_KV.put('activity:clearedAt', String(Date.now())); } catch (e) {}
  return { deleted };
}
