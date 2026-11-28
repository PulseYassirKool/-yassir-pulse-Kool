// Lecture Google Sheets côté Worker via un compte de service (G3, tranche 1).
// Le Worker signe un JWT RS256 avec la clé du compte de service, l'échange
// contre un jeton d'accès Google (mis en cache jusqu'à expiration), puis lit
// les plages via Sheets API v4. Lecture seule.
//
// Aucun secret n'est jamais journalisé ni renvoyé : les erreurs sont
// génériques (le message de Google n'est jamais propagé tel quel).
// La clé JSON du compte de service vit uniquement dans le secret Worker
// GOOGLE_SERVICE_ACCOUNT_JSON — jamais dans le dépôt, jamais dans ce fichier.

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const TOKEN_SAFETY_MS = 60000; // on considère le jeton expiré 60 s avant sa fin réelle

const enc = new TextEncoder();
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64ToBytes = (s) => Uint8Array.from(atob(s.replace(/\s/g, '')), (c) => c.charCodeAt(0));

// Erreur avec un statut HTTP, pour que l'appelant renvoie une réponse propre
// sans jamais exposer le détail interne (jeton, clé, message de Google).
export class SheetsError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Statut amont Google préservé pour le quota (429) uniquement : c'est un
// signal transitoire et actionnable (le client attend la fin de la fenêtre
// de 60 s et réessaie). Les autres erreurs restent un 502 générique : le
// statut (403/404/…) révélerait l'état de la configuration du compte de
// service, et le message de Google n'est jamais propagé.
// (Diagnostic 2026-11-28 : details-kool échouait en 502 à chaque synchro
// Kool — le 429 quota était invisible, le front réessayait après 2 s/5 s,
// toujours dans la même fenêtre de 60 s, et la source tombait à 0.)
function sheetsErrorFromResponse(res, message) {
  if (res && res.status === 429) return new SheetsError(429, 'Quota Google Sheets dépassé.');
  return new SheetsError(502, message);
}

// Jeton d'accès mis en cache en mémoire (par isolate Worker) jusqu'à expiration.
let cachedToken = null;
export function clearGoogleTokenCache() { cachedToken = null; }

function parseServiceAccount(env) {
  const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw || typeof raw !== 'string') {
    throw new SheetsError(500, 'Compte de service Google non configuré.');
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new SheetsError(500, 'Compte de service Google non configuré.');
  }
  if (!parsed || parsed.type !== 'service_account' || !parsed.client_email || !parsed.private_key) {
    throw new SheetsError(500, 'Compte de service Google non configuré.');
  }
  return { clientEmail: parsed.client_email, privateKeyPem: parsed.private_key };
}

function pemToBytes(pem) {
  const body = String(pem)
    .replace(/-----BEGIN [A-Z ]*-----/g, '')
    .replace(/-----END [A-Z ]*-----/g, '')
    .replace(/\s/g, '');
  if (!body) throw new SheetsError(500, 'Compte de service Google non configuré.');
  return b64ToBytes(body);
}

// Construit le JWT signé RS256 pour l'échange contre un jeton d'accès.
// nowMs injectable pour les tests (par défaut l'horloge réelle).
export async function buildServiceAccountJwt(serviceAccount, nowMs = Date.now()) {
  const iat = Math.floor(nowMs / 1000);
  const header = b64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = b64url(enc.encode(JSON.stringify({
    iss: serviceAccount.clientEmail,
    scope: SHEETS_SCOPE,
    aud: TOKEN_URL,
    iat,
    exp: iat + 3600
  })));
  const data = enc.encode(`${header}.${payload}`);
  let key;
  try {
    key = await crypto.subtle.importKey(
      'pkcs8', pemToBytes(serviceAccount.privateKeyPem),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
    );
  } catch (e) {
    throw new SheetsError(500, 'Compte de service Google non configuré.');
  }
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, data);
  return `${header}.${payload}.${b64url(signature)}`;
}

// Jeton d'accès Google, réutilisé tant qu'il est valide (marge de sécurité).
// fetchImpl injectable pour les tests (par défaut le fetch global du Worker).
export async function getAccessToken(env, fetchImpl = fetch) {
  if (cachedToken && Date.now() < cachedToken.expiresAtMs - TOKEN_SAFETY_MS) {
    return cachedToken.token;
  }
  const serviceAccount = parseServiceAccount(env);
  const assertion = await buildServiceAccountJwt(serviceAccount);
  let res;
  try {
    res = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${encodeURIComponent(assertion)}`
    });
  } catch (e) {
    throw new SheetsError(502, "Échange de jeton Google impossible.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw sheetsErrorFromResponse(res, "Échange de jeton Google impossible.");
  if (!body.access_token) {
    throw new SheetsError(502, "Échange de jeton Google impossible.");
  }
  const expiresInMs = (Number(body.expires_in) || 3600) * 1000;
  cachedToken = { token: body.access_token, expiresAtMs: Date.now() + expiresInMs };
  return cachedToken.token;
}

// Lecture d'une plage via Sheets API v4. Renvoie { spreadsheetId, range, values }
// (values = tableau de lignes, [] si la plage est vide).
export async function readSheetRange(env, spreadsheetId, range, fetchImpl = fetch) {
  if (typeof spreadsheetId !== 'string' || !/^[A-Za-z0-9_-]{10,100}$/.test(spreadsheetId)) {
    throw new SheetsError(400, 'Identifiant de classeur invalide.');
  }
  if (typeof range !== 'string' || range.length < 1 || range.length > 200 || /[/\\?#\u0000-\u001F]/.test(range)) {
    throw new SheetsError(400, 'Plage invalide.');
  }
  const token = await getAccessToken(env, fetchImpl);
  // Correctif 2026-11-27 (audit point 2 — montants lus tels qu'affichés) :
  // sans valueRenderOption, l'API renvoie les valeurs FORMATÉES : une cellule
  // affichée « 1 235 » alors qu'elle contient 1 234,57 est lue 1 235, et les
  // décimales dépendent de la locale. Avec UNFORMATTED_VALUE, les nombres
  // arrivent exacts (1 234,57) et les dates arrivent comme chaînes formatées
  // (dateTimeRenderOption=FORMATTED_STRING) au lieu de numéros de série —
  // le front les reconnaît alors comme des dates et ne les somme pas comme
  // des montants (garde anti-date dans purgerNombre).
  const url = `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;
  let res;
  try {
    res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch (e) {
    throw new SheetsError(502, 'Lecture de la feuille impossible.');
  }
  if (!res.ok) {
    throw sheetsErrorFromResponse(res, 'Lecture de la feuille impossible.');
  }
  const body = await res.json().catch(() => ({}));
  return { spreadsheetId, range, values: Array.isArray(body.values) ? body.values : [] };
}

// ---- G3 suite : métadonnées + lecture par morceaux (pour /api/sheets/*) ----
// Liste des onglets d'un classeur : [{ id (gid), title }].
// `fields` limite la réponse aux propriétés des onglets (pas de données).
export async function getSpreadsheetSheets(env, spreadsheetId, fetchImpl = fetch) {
  if (typeof spreadsheetId !== 'string' || !/^[A-Za-z0-9_-]{10,100}$/.test(spreadsheetId)) {
    throw new SheetsError(400, 'Identifiant de classeur invalide.');
  }
  const token = await getAccessToken(env, fetchImpl);
  const url = `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties`;
  let res;
  try {
    res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch (e) {
    throw new SheetsError(502, 'Lecture de la feuille impossible.');
  }
  if (!res.ok) {
    throw sheetsErrorFromResponse(res, 'Lecture de la feuille impossible.');
  }
  const body = await res.json().catch(() => ({}));
  const sheets = Array.isArray(body.sheets) ? body.sheets : [];
  return sheets
    .map((s) => ({ id: s && s.properties ? s.properties.sheetId : null, title: s && s.properties ? s.properties.title : '' }))
    .filter((s) => typeof s.title === 'string' && s.title !== '');
}

// Lecture d'un morceau de lignes d'un onglet : lignes [startRow, endRow]
// (1-based, en-têtes comprises). Renvoie les lignes brutes (tableau de
// tableaux, [] si la plage est vide). Un morceau plus court que demandé
// signale la fin des données de l'onglet. Le titre est quoté façon A1
// (les ' doublés), comme l'exige Sheets API v4.
export function quoteSheetTitle(title) {
  return `'${String(title).replace(/'/g, "''")}'`;
}
export async function readSheetRowsChunk(env, spreadsheetId, title, startRow, endRow, fetchImpl = fetch) {
  if (typeof spreadsheetId !== 'string' || !/^[A-Za-z0-9_-]{10,100}$/.test(spreadsheetId)) {
    throw new SheetsError(400, 'Identifiant de classeur invalide.');
  }
  if (typeof title !== 'string' || title.length < 1 || title.length > 200) {
    throw new SheetsError(400, 'Onglet invalide.');
  }
  const start = Math.max(1, Math.floor(startRow) || 1);
  const end = Math.max(start, Math.floor(endRow) || start);
  const token = await getAccessToken(env, fetchImpl);
  const range = `${quoteSheetTitle(title)}!A${start}:ZZ${end}`;
  // Valeurs non formatées (voir readSheetRange) : nombres exacts, dates en
  // chaînes formatées — jamais de numéro de série Excel dans les montants.
  const url = `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;
  let res;
  try {
    res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch (e) {
    throw new SheetsError(502, 'Lecture de la feuille impossible.');
  }
  if (!res.ok) {
    throw sheetsErrorFromResponse(res, 'Lecture de la feuille impossible.');
  }
  const body = await res.json().catch(() => ({}));
  return Array.isArray(body.values) ? body.values : [];
}
