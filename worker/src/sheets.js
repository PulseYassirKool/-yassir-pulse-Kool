// Lecture filtrée des feuilles Google Sheets côté Worker (G3, suite).
// Le front appelait les feuilles directement (CSV/gviz/XLSX) ; ces endpoints
// servent les mêmes lignes, déjà filtrées par rôle/AM, en JSON :
//   GET /api/sheets/:source?brand=yassir|kool&page=0&pageSize=5000&fresh=0|1
//
// Réponse : { source, brand, role, filtered, cached, updatedAt, tabs,
//   skippedTabs, partial, page, pageSize, totalRows, totalPages, rows }
// où rows = [ligne d'en-têtes, ...lignes de la page demandée].
//
// Les identifiants de classeurs vivent dans la clé KV `config` et ne sont
// JAMAIS exposés dans les réponses.
//
// Limites du plan gratuit Cloudflare (50 sous-requêtes / invocation,
// 10 ms de CPU, 128 Mo, 25 Mo par valeur KV, 1 000 écritures KV / jour) :
// - les onglets sont lus par morceaux de 20 000 lignes (values.get) ;
// - les lignes filtrées sont écrites en KV par paquets de 5 000 lignes
//   (clé `sheetcache:<utilisateur>:<marque>:<source>` + manifest) avec un
//   TTL de 300 s : une page servie depuis le cache ne coûte que 3 à 5
//   sous-requêtes ; `fresh=1` ne force le rechargement que pour le
//   propriétaire (ignoré pour les autres rôles) ;
// - le chargement à froid d'une très grosse source (Data Kool ~108 000
//   lignes, Détails ~150 000) reste lourd en CPU : si Cloudflare renvoie
//   une erreur 1102 sur ce chargement, c'est le plafond CPU gratuit qui est
//   atteint (le plan payant à 5 $/mois le porte à 30 s par défaut).
//
// Filtrage :
// - owner / viewer_all : tout (la marque demandée) ;
// - am : uniquement les restaurants de SON portefeuille (onglet Portefeuilles
//   dont le nom d'AM correspond à `amName`, colonne APP pour la marque) ;
// - market_am (Eya) : son portefeuille Yassir, rien en Kool (réponse vide,
//   sans lecture des feuilles).
// Les petites feuilles se filtrent par nom de restaurant (et APP) ; les
// grosses (Data, détails) aussi. Les détails Kool n'ont pas de colonne
// restaurant : ils se filtrent par l'ensemble des N° de commande de la Data
// Kool filtrée de l'utilisateur (chargée / mise en cache au besoin).
// Le Budget se filtre par nom d'AM dans la ligne (les lignes « global » sont
// gardées pour tous les rôles).
// Un onglet illisible ou aux en-têtes invalides est ignoré silencieusement
// (listé dans skippedTabs, partial=true) sans casser les autres.

import { getSpreadsheetSheets, readSheetRowsChunk, SheetsError } from './google-sheets.js';

export const CACHE_TTL_SECONDS = 300; // 5 min
export const SHEET_CHUNK_ROWS = 20000; // lignes lues par appel values.get
export const KV_CHUNK_ROWS = 5000; // lignes filtrées par valeur KV
export const MAX_TABS = 60;
export const MAX_TOTAL_ROWS = 300000; // plafond de sécurité par chargement
export const DEFAULT_PAGE_SIZE = 5000;
export const MAX_PAGE_SIZE = 10000;

// Sources servies. `kind` : 'named' (un onglet désigné) ou 'multi' (tous les
// onglets valides du classeur). `dedupe` : clé de déduplication entre onglets.
export const SHEET_SOURCES = [
  'portfolios', 'commissions', 'offres', 'budget', 'statuts', 'hist2025',
  'data-oct', 'data-nov', 'data-kool', 'details-kool'
];

// Normalisation des noms (miroir de normalizeText du front) : minuscules,
// accents supprimés, marques de direction retirées, espaces tassés.
const _normCache = new Map();
export function normalizeName(value) {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'string' ? value : String(value);
  if (!s) return '';
  const cached = _normCache.get(s);
  if (cached !== undefined) return cached;
  const res = s.trim().toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‎‏‪-‮]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (_normCache.size > 40000) _normCache.clear();
  _normCache.set(s, res);
  return res;
}

const ORDER_ID_RE = /^(n[°o]?\s*commande|order\s*id|numero\s*commande)$/;
const RESTO_HEADERS = ['restaurant name', 'restaurant', 'nom du restaurant', 'nom restaurant', 'store name', 'store', 'enseigne', 'partenaire', 'nom'];
const isOrderIdHeader = (h) => ORDER_ID_RE.test(h);
const isArticleHeader = (h) => h === 'article' || h.includes('article') || h.includes('item');

// Validateurs d'en-têtes (mêmes règles que le front : un onglet dont les
// en-têtes ne correspondent pas est ignoré silencieusement).
export function isDataKoolHeaders(h) {
  return h.includes('date') && h.some(isOrderIdHeader);
}
export function isDetailsKoolHeaders(h) {
  return h.some(isOrderIdHeader) && h.some(isArticleHeader);
}
export function isDataYassirHeaders(h) {
  return h.includes('order id') && (h.includes('order day') || h.includes('delivered day'));
}

function normRow(row) {
  return (row || []).map((c) => normalizeName(c));
}
function findCol(headersNorm, predicate) {
  for (let i = 0; i < headersNorm.length; i++) {
    if (predicate(headersNorm[i], i)) return i;
  }
  return -1;
}
export function findRestaurantCol(headersNorm) {
  return findCol(headersNorm, (h) => RESTO_HEADERS.includes(h) || h.includes('restaurant') || h.includes('partenaire') || h.includes('store'));
}
function findAppCol(headersNorm) {
  return headersNorm.indexOf('app');
}
function findOrderIdCol(headersNorm) {
  return findCol(headersNorm, isOrderIdHeader);
}
function findArticleCol(headersNorm) {
  return findCol(headersNorm, isArticleHeader);
}
function isEmptyRow(row) {
  return !row || row.every((c) => c === null || c === undefined || String(c).trim() === '');
}
function isTotalRow(row) {
  if (!row) return false;
  for (const c of row) {
    if (c === null || c === undefined || String(c).trim() === '') continue;
    const n = normalizeName(c);
    return n === 'total' || n.startsWith('total ') || n.startsWith('sous-total');
  }
  return false;
}
// Première ligne d'en-tête plausible dans les 12 premières lignes (comme le
// front) : une ligne qui mentionne un restaurant, un AM, un statut ou un
// budget. Repli : ligne 0.
function findHeaderRowIdx(rows) {
  const maxScan = Math.min(rows.length, 12);
  for (let sr = 0; sr < maxScan; sr++) {
    const h = normRow(rows[sr]);
    if (h.some((x) => x.includes('restaurant') || x.includes('partenaire') || x.includes('store') || x.includes('enseigne') || x === 'nom' || x === 'am' || x.includes('account manager') || x === 'status' || x === 'statut' || x.includes('budget'))) {
      return sr;
    }
  }
  return 0;
}

// Correspondance AM (miroir de matchAgentFromText du front) : nom complet
// égal, ou prénom + nom présents, ou prénom seul (mot entier, >= 4 lettres).
const AM_FIRST_NAMES = ['omar', 'nour', 'aziza', 'khouloud', 'imed', 'iheb', 'ilyes', 'eya'];
export function matchAmInText(text, amNames) {
  const norm = normalizeName(text);
  if (!norm) return '';
  for (const agent of amNames) {
    const normAgent = normalizeName(agent);
    if (!normAgent) continue;
    if (norm === normAgent || norm.includes(normAgent)) return agent;
    const parts = normAgent.split(' ').filter(Boolean);
    if (parts.length >= 2 && norm.includes(parts[0]) && norm.includes(parts[1])) return agent;
    if (parts[0] && parts[0].length >= 4 && new RegExp(`\\b${parts[0]}\\b`).test(norm)) return agent;
  }
  return '';
}
function amTabMatches(tabAm, meAm) {
  const a = normalizeName(tabAm);
  const b = normalizeName(meAm);
  if (!a || !b) return false;
  if (a === b) return true;
  const firstA = a.split(' ')[0];
  const firstB = b.split(' ')[0];
  return firstA.length >= 3 && firstA === firstB;
}

// ---------- Plan de lecture d'une source (IDs lus dans la KV `config`) ----------
export function resolveSourcePlan(config, source, brand) {
  const cfg = config || {};
  const live = cfg.live || {};
  const kool = cfg.kool || {};
  const uniqueId = live.PORTFOLIOS_SHEET_ID || '';
  switch (source) {
    case 'portfolios':
      return { spreadsheetId: uniqueId, kind: 'portfolios', tabs: Array.isArray(live.PORTFOLIOS_TABS) ? live.PORTFOLIOS_TABS : [] };
    case 'commissions':
      return { spreadsheetId: brand === 'kool' ? (kool.COMMISSION_SHEET_ID || uniqueId) : (live.COMMISSIONS_SHEET_ID || uniqueId), kind: 'named', tab: brand === 'kool' ? (kool.COMMISSION_TAB || 'Commissions') : (live.COMMISSIONS_TAB || 'Commissions'), altTabs: brand === 'kool' ? (kool.COMMISSION_ALT_TABS || []) : [], gid: brand === 'kool' ? kool.COMMISSION_GID : live.COMMISSIONS_GID };
    case 'offres':
      return { spreadsheetId: live.OFFRE_PARTICIPATION_SHEET_ID || uniqueId, kind: 'named', tab: 'Offre Participation', altTabs: ['Offre Participation', 'Offres'], gid: live.OFFRE_PARTICIPATION_GID };
    case 'budget':
      return { spreadsheetId: live.BUDGET_SHEET_ID || uniqueId, kind: 'named', tab: live.BUDGET_TAB || 'Budget', altTabs: ['Budget'], gid: live.BUDGET_GID };
    case 'statuts':
      return { spreadsheetId: live.RESTO_STATUS_SHEET_ID || uniqueId, kind: 'named', tab: 'Statuts', altTabs: ['Statuts', 'Active', 'Status'], gid: live.RESTO_STATUS_GID };
    case 'hist2025':
      return { spreadsheetId: live.HISTORICAL_2025_SHEET_ID || uniqueId, kind: 'named', tab: brand === 'kool' ? '2025 Kool' : '2025 Yassir', altTabs: [], gid: brand === 'kool' ? kool.HISTORICAL_2025_GID : live.HISTORICAL_2025_GID };
    case 'data-oct': {
      const m = Array.isArray(live.HISTORICAL_MONTHS) ? live.HISTORICAL_MONTHS[0] : null;
      return m ? { spreadsheetId: m.sheetId || '', kind: 'multi', validator: isDataYassirHeaders, mainTab: m.tab || '' } : null;
    }
    case 'data-nov': {
      const m = Array.isArray(live.HISTORICAL_MONTHS) ? live.HISTORICAL_MONTHS[1] : null;
      return m ? { spreadsheetId: m.sheetId || '', kind: 'multi', validator: isDataYassirHeaders, mainTab: m.tab || '' } : null;
    }
    case 'data-kool':
      return { spreadsheetId: kool.DATA_SHEET_ID || '', kind: 'multi', validator: isDataKoolHeaders, mainTab: '' };
    case 'details-kool':
      return { spreadsheetId: kool.ORDER_ITEMS_SHEET_ID || '', kind: 'multi', validator: isDetailsKoolHeaders, mainTab: '' };
    default:
      return null;
  }
}

// ---------- Cache KV ----------
function cacheKey(username, brand, source) {
  return `sheetcache:${username}:${brand}:${source}`;
}
async function readManifest(env, key) {
  try {
    const m = await env.PULSE_KV.get(key, 'json');
    if (!m || m.version !== 1 || !Array.isArray(m.headers) || typeof m.totalRows !== 'number' || typeof m.chunkCount !== 'number') return null;
    return m;
  } catch (e) {
    return null;
  }
}
async function readChunk(env, key, idx) {
  try {
    const rows = await env.PULSE_KV.get(`${key}:c${idx}`, 'json');
    return Array.isArray(rows) ? rows : null;
  } catch (e) {
    return null;
  }
}

// Accumulateur de lignes filtrées : écrit les paquets en KV au fil de l'eau
// (la mémoire reste bornée) et gère la déduplication entre onglets.
class RowSink {
  constructor(env, key) {
    this.env = env;
    this.key = key;
    this.buffer = [];
    this.flushed = 0; // lignes déjà écrites en KV
    this.chunks = 0;
    this.byOrder = new Map(); // clé de dédupe -> index global
    this.overwrites = new Map(); // index global -> ligne (doublon dans un paquet déjà écrit)
    this.dedupe = null; // 'order' | 'order-article' | null
  }
  get total() { return this.flushed + this.buffer.length; }
  push(row, dedupeKey) {
    if (this.dedupe && dedupeKey) {
      const prev = this.byOrder.get(dedupeKey);
      if (prev !== undefined) {
        // 2e occurrence écrase la 1re (même index global, total inchangé).
        if (prev >= this.flushed) this.buffer[prev - this.flushed] = row;
        else this.overwrites.set(prev, row);
        return;
      }
      this.byOrder.set(dedupeKey, this.total);
    }
    this.buffer.push(row);
    if (this.buffer.length >= KV_CHUNK_ROWS) {
      // Écriture synchrone du paquet (await dans push : l'appelant await).
      return this.flush();
    }
    return Promise.resolve();
  }
  async flush() {
    if (this.buffer.length === 0) return;
    const idx = this.chunks;
    await this.env.PULSE_KV.put(`${this.key}:c${idx}`, JSON.stringify(this.buffer), { expirationTtl: CACHE_TTL_SECONDS });
    this.chunks += 1;
    this.flushed += this.buffer.length;
    this.buffer = [];
  }
  async finish() {
    // Les écrasements qui visent le tampon courant s'y appliquent d'abord.
    for (const [idx, row] of this.overwrites) {
      if (idx >= this.flushed) this.buffer[idx - this.flushed] = row;
    }
    await this.flush();
    // Puis ceux qui visent des paquets déjà écrits (rares : doublon entre onglets).
    const byChunk = new Map();
    for (const [idx, row] of this.overwrites) {
      if (idx >= this.flushed) continue;
      const c = Math.floor(idx / KV_CHUNK_ROWS);
      if (!byChunk.has(c)) byChunk.set(c, []);
      byChunk.get(c).push([idx % KV_CHUNK_ROWS, row]);
    }
    for (const [c, patches] of byChunk) {
      const rows = await readChunk(this.env, this.key, c);
      if (!rows) continue;
      for (const [off, row] of patches) rows[off] = row;
      await this.env.PULSE_KV.put(`${this.key}:c${c}`, JSON.stringify(rows), { expirationTtl: CACHE_TTL_SECONDS });
    }
  }
}

// ---------- Chargement depuis Sheets ----------
// Lit un onglet par morceaux, détecte la ligne d'en-tête, réaligne les
// colonnes sur les en-têtes de référence, filtre et pousse les lignes.
async function loadTab(env, plan, tabTitle, ctx) {
  const { spreadsheetId } = plan;
  let startRow = 1;
  let headerRowIdx = -1;
  let headers = null; // en-têtes brutes de référence (1er onglet valide)
  let headersNorm = null;
  let idxResto = -1;
  let idxApp = -1;
  let idxOrder = -1;
  let idxArticle = -1;
  let rowsRead = 0;
  let firstChunk = true;
  for (;;) {
    let chunk;
    try {
      chunk = await readSheetRowsChunk(env, spreadsheetId, tabTitle, startRow, startRow + SHEET_CHUNK_ROWS - 1, ctx.fetchImpl);
    } catch (e) {
      if (firstChunk) throw e; // onglet illisible dès le 1er morceau : appelant décide
      ctx.skippedTabs.push(tabTitle);
      ctx.partial = true;
      return;
    }
    firstChunk = false;
    if (!chunk || chunk.length === 0) return; // fin de l'onglet
    rowsRead += chunk.length;
    if (rowsRead > 250000) { ctx.skippedTabs.push(tabTitle); ctx.partial = true; return; }
    if (headerRowIdx === -1) {
      // 1er morceau : trouver la ligne d'en-tête et valider l'onglet.
      const probe = chunk.slice(0, 12);
      headerRowIdx = ctx.findHeader(probe);
      const headerCells = (chunk[headerRowIdx] || []).map((c) => (c === null || c === undefined ? '' : String(c)));
      const hNorm = normRow(headerCells);
      if (ctx.validator && !ctx.validator(hNorm)) {
        ctx.skippedTabs.push(tabTitle);
        return; // onglet aux en-têtes invalides : ignoré silencieusement
      }
      if (!ctx.headers) {
        ctx.headers = headerCells;
        ctx.headersNorm = hNorm;
        headers = headerCells;
        headersNorm = hNorm;
        idxResto = findRestaurantCol(hNorm);
        idxApp = findAppCol(hNorm);
        idxOrder = findOrderIdCol(hNorm);
        idxArticle = findArticleCol(hNorm);
        ctx.idxResto = idxResto;
        ctx.idxApp = idxApp;
        ctx.idxOrder = idxOrder;
        ctx.idxArticle = idxArticle;
        if (ctx.source === 'data-kool' && idxResto === -1) ctx.idxResto = 6; // repli front : colonne G
        if (ctx.source === 'statuts' && idxResto === -1) ctx.idxResto = 1; // repli front : colonne B
        if (ctx.source === 'portfolios' && ctx.headersNorm[ctx.headersNorm.length - 1] !== 'am') {
          ctx.headers = [...headerCells, 'AM'];
          ctx.headersNorm = [...hNorm, 'am'];
        }
      } else {
        headers = ctx.headers;
        headersNorm = ctx.headersNorm;
        idxResto = ctx.idxResto;
        idxApp = ctx.idxApp;
        idxOrder = ctx.idxOrder;
        idxArticle = ctx.idxArticle;
      }
      // Aligner ce morceau : colonnes par nom d'en-tête.
      const tabHNorm = hNorm;
      const colMap = headersNorm.map((mh) => {
        if (!mh) return -1;
        for (let i = 0; i < tabHNorm.length; i++) {
          if (tabHNorm[i] === mh) return i;
        }
        return -1;
      });
      const dataStart = headerRowIdx + 1;
      for (let r = dataStart; r < chunk.length; r++) {
        await ctx.emitRow(alignRow(chunk[r], colMap, headers.length), tabTitle);
      }
    } else {
      // Morceaux suivants : toutes les lignes sont des données, déjà alignées
      // sur les en-têtes de cet onglet (même ordre que le 1er morceau).
      for (const raw of chunk) {
        await ctx.emitRow(alignRow(raw, ctx.colMap, headers.length), tabTitle);
      }
    }
    // Mémoriser l'alignement de cet onglet pour les morceaux suivants.
    if (!ctx.colMap) {
      const tabHNorm = normRow((chunk[headerRowIdx] || []).map((c) => (c === null || c === undefined ? '' : String(c))));
      ctx.colMap = headersNorm.map((mh) => {
        if (!mh) return -1;
        for (let i = 0; i < tabHNorm.length; i++) {
          if (tabHNorm[i] === mh) return i;
        }
        return -1;
      });
    }
    if (chunk.length < SHEET_CHUNK_ROWS) return; // dernier morceau
    startRow += SHEET_CHUNK_ROWS;
    if (ctx.sink.total >= MAX_TOTAL_ROWS) { ctx.partial = true; return; }
  }
}
function alignRow(row, colMap, width) {
  const out = new Array(width).fill('');
  if (!row) return out;
  for (let c = 0; c < colMap.length; c++) {
    const src = colMap[c];
    if (src !== -1 && src < row.length && row[src] !== null && row[src] !== undefined) out[c] = row[src];
  }
  return out;
}

// Contexte partagé d'un chargement : filtres + émission des lignes.
function makeLoadContext(env, me, source, brand, plan, sink, fetchImpl, portfolioSet, orderIdSet) {
  const filteredRole = me.role === 'am' || me.role === 'market_am';
  const amNames = (plan.allAmNames || []).slice();
  const ctx = {
    source, fetchImpl, sink,
    headers: null, headersNorm: null, colMap: null,
    idxResto: -1, idxApp: -1, idxOrder: -1, idxArticle: -1,
    tabs: [], skippedTabs: [], partial: false,
    validator: plan.validator || null,
    findHeader: (probe) => {
      if (plan.validator) {
        // Onglet multi : la ligne d'en-tête est celle qui valide.
        for (let i = 0; i < probe.length; i++) {
          if (plan.validator(normRow(probe[i]))) return i;
        }
        return -1; // aucune ligne ne valide : onglet ignoré (headerRowIdx -1 -> traité par l'appelant)
      }
      return findHeaderRowIdx(probe);
    },
    emitRow: async (row, tabTitle) => {
      if (isEmptyRow(row)) return;
      if (ctx.isDataSource && isTotalRow(row)) return;
      // Filtre par marque (colonne APP ; vide = gardée, sauf Budget où vide = Yassir).
      const idxApp = ctx.idxApp;
      if (idxApp !== -1 && idxApp < row.length) {
        const appVal = normalizeName(row[idxApp]);
        if (source === 'budget') {
          if ((appVal === 'kool' ? 'kool' : 'yassir') !== brand) return;
        } else if (appVal && appVal !== brand) {
          return;
        }
      } else if (source === 'budget' && brand !== 'yassir') {
        return; // sans colonne APP, le Budget est Yassir (règle front)
      }
      // Filtre Budget par AM (lignes « global » gardées pour tous).
      if (source === 'budget' && filteredRole) {
        const matched = matchAmInText((row || []).map((c) => String(c === null || c === undefined ? '' : c)).join(' | '), amNames);
        if (matched && !amTabMatches(matched, me.amName)) return;
      }
      // Filtre par restaurant (portefeuille de l'AM).
      if (filteredRole && portfolioSet && source !== 'portfolios' && source !== 'budget' && source !== 'details-kool' && source !== 'hist2025') {
        const idxResto = ctx.idxResto;
        if (idxResto === -1 || idxResto >= row.length) return; // sans colonne restaurant : on ne devine pas, on ne renvoie rien
        if (!portfolioSet.has(normalizeName(row[idxResto]))) return;
      }
      // Filtre détails Kool par N° de commande (ensemble issu de la Data Kool filtrée).
      if (source === 'details-kool' && filteredRole && orderIdSet) {
        const idxOrder = ctx.idxOrder;
        if (idxOrder === -1 || idxOrder >= row.length) return;
        if (!orderIdSet.has(normalizeName(row[idxOrder]))) return;
      }
      // Déduplication entre onglets.
      let dedupeKey = '';
      if (sink.dedupe === 'order' && ctx.idxOrder !== -1) {
        dedupeKey = normalizeName(row[ctx.idxOrder]);
      } else if (sink.dedupe === 'order-article' && ctx.idxOrder !== -1 && ctx.idxArticle !== -1) {
        dedupeKey = `${normalizeName(row[ctx.idxOrder])}|${normalizeName(row[ctx.idxArticle])}`;
      }
      if (dedupeKey === '' && sink.dedupe) dedupeKey = ''; // pas de clé : ligne gardée sans dédupe
      // Colonne AM ajoutée pour les portefeuilles (onglet d'origine).
      let outRow = row;
      if (source === 'portfolios') {
        outRow = [...row, ctx.tabAm || ''];
      }
      await sink.push(outRow, dedupeKey || null);
    }
  };
  ctx.isDataSource = source === 'data-oct' || source === 'data-nov' || source === 'data-kool' || source === 'details-kool';
  return ctx;
}

async function loadFromSheets(env, me, source, brand, fetchImpl) {
  const config = (await env.PULSE_KV.get('config', 'json')) || {};
  const plan = resolveSourcePlan(config, source, brand);
  if (!plan || !plan.spreadsheetId) throw new SheetsError(502, 'Lecture de la feuille impossible.');
  plan.allAmNames = Array.isArray((config.live || {}).PORTFOLIOS_TABS)
    ? (config.live.PORTFOLIOS_TABS.map((t) => t.am).filter(Boolean))
    : [];
  const key = cacheKey(me.username, brand, source);
  const sink = new RowSink(env, key);
  if (source === 'data-oct' || source === 'data-nov' || source === 'data-kool') sink.dedupe = 'order';
  if (source === 'details-kool') sink.dedupe = 'order-article';

  // Ensemble des restaurants du portefeuille (rôles filtrés, sauf portefeuilles
  // — filtrés par onglet — et hist2025 — sans dimension restaurant).
  let portfolioSet = null;
  const filteredRole = me.role === 'am' || me.role === 'market_am';
  if (filteredRole && source !== 'portfolios' && source !== 'hist2025') {
    portfolioSet = await getPortfolioRestaurants(env, me, brand, fetchImpl);
  }
  // Ensemble des N° de commande (détails Kool, rôles filtrés).
  let orderIdSet = null;
  if (source === 'details-kool' && filteredRole) {
    orderIdSet = await getFilteredKoolOrderIds(env, me, fetchImpl);
  }

  const ctx = makeLoadContext(env, me, source, brand, plan, sink, fetchImpl, portfolioSet, orderIdSet);
  const sheets = await getSpreadsheetSheets(env, plan.spreadsheetId, fetchImpl);
  const byTitle = new Map();
  const byGid = new Map();
  for (const s of sheets) {
    byTitle.set(normalizeName(s.title), s);
    if (s.id !== null && s.id !== undefined) byGid.set(String(s.id), s);
  }
  const resolveTab = (tabName, altTabs, gid) => {
    const names = [tabName, ...(altTabs || [])];
    for (const n of names) {
      const hit = byTitle.get(normalizeName(n));
      if (hit) return hit;
    }
    if (gid !== undefined && gid !== null && gid !== '') {
      const hit = byGid.get(String(gid));
      if (hit) return hit;
    }
    return null;
  };

  let tabsToRead = [];
  if (plan.kind === 'portfolios') {
    // Un onglet par AM ; un AM ne lit que son/ses onglet(s).
    for (const entry of plan.tabs) {
      if (filteredRole && !amTabMatches(entry.am, me.amName)) continue;
      const hit = resolveTab(entry.tab, entry.altTabs, entry.gid);
      if (!hit) { ctx.skippedTabs.push(entry.tab); ctx.partial = true; continue; }
      tabsToRead.push({ title: hit.title, am: entry.am });
    }
    if (tabsToRead.length === 0 && filteredRole) {
      // AM sans onglet de portefeuille : rien à renvoyer, sans lecture.
      await sink.finish();
      return finishLoad(env, key, ctx, sink);
    }
  } else if (plan.kind === 'named') {
    const hit = resolveTab(plan.tab, plan.altTabs, plan.gid);
    if (!hit) throw new SheetsError(502, 'Lecture de la feuille impossible.');
    tabsToRead.push({ title: hit.title, am: '' });
  } else {
    // Multi-onglets : tous les onglets du classeur, dans leur ordre.
    // L'onglet principal (config) est lu en premier pour fixer les en-têtes.
    const ordered = sheets.slice();
    if (plan.mainTab) {
      const idx = ordered.findIndex((s) => normalizeName(s.title) === normalizeName(plan.mainTab));
      if (idx > 0) { const [main] = ordered.splice(idx, 1); ordered.unshift(main); }
    }
    tabsToRead = ordered.slice(0, MAX_TABS).map((s) => ({ title: s.title, am: '' }));
  }

  let readOk = 0;
  let readFail = 0;
  for (const tab of tabsToRead) {
    // Chaque onglet a son propre alignement de colonnes.
    ctx.colMap = null;
    ctx.tabAm = tab.am || '';
    try {
      await loadTab(env, plan, tab.title, ctx);
      readOk += 1;
      if (!ctx.skippedTabs.includes(tab.title)) ctx.tabs.push(tab.title);
    } catch (e) {
      readFail += 1;
      ctx.skippedTabs.push(tab.title);
      ctx.partial = true;
    }
    if (sink.total >= MAX_TOTAL_ROWS) { ctx.partial = true; break; }
  }
  if (readOk === 0 && tabsToRead.length > 0) {
    throw new SheetsError(502, 'Lecture de la feuille impossible.');
  }
  await sink.finish();
  return finishLoad(env, key, ctx, sink);
}

async function finishLoad(env, key, ctx, sink) {
  const manifest = {
    version: 1,
    source: ctx.source,
    headers: ctx.headers || [],
    totalRows: sink.total,
    chunkCount: sink.chunks,
    chunkSize: KV_CHUNK_ROWS,
    tabs: ctx.tabs,
    skippedTabs: [...new Set(ctx.skippedTabs)],
    partial: ctx.partial,
    updatedAt: new Date().toISOString()
  };
  await env.PULSE_KV.put(key, JSON.stringify(manifest), { expirationTtl: CACHE_TTL_SECONDS });
  return manifest;
}

// Portefeuille de l'utilisateur pour une marque : ensemble normalisé des noms
// de restaurants (lu depuis le cache `portfolios`, chargé au besoin).
export async function getPortfolioRestaurants(env, me, brand, fetchImpl = fetch) {
  const manifest = await ensureSheetsCache(env, me, 'portfolios', brand, fetchImpl);
  const key = cacheKey(me.username, brand, 'portfolios');
  const set = new Set();
  const headersNorm = normRow(manifest.headers);
  let idxResto = findRestaurantCol(headersNorm);
  if (idxResto === -1) idxResto = 2; // repli : Ville | Segment | Restaurant
  for (let c = 0; c < manifest.chunkCount; c++) {
    const rows = await readChunk(env, key, c);
    if (!rows) continue;
    for (const row of rows) {
      if (!row || idxResto >= row.length) continue;
      const name = normalizeName(row[idxResto]);
      if (!name || name === 'restaurant' || name === 'restaurant name') continue;
      if (name === 'total' || name.startsWith('total ') || name.startsWith('sous-total')) continue;
      set.add(name);
    }
  }
  return set;
}

// N° de commande de la Data Kool filtrée de l'utilisateur (pour details-kool).
async function getFilteredKoolOrderIds(env, me, fetchImpl) {
  const manifest = await ensureSheetsCache(env, me, 'data-kool', 'kool', fetchImpl);
  const key = cacheKey(me.username, 'kool', 'data-kool');
  const headersNorm = normRow(manifest.headers);
  const idxOrder = findOrderIdCol(headersNorm);
  const set = new Set();
  if (idxOrder === -1) return set;
  for (let c = 0; c < manifest.chunkCount; c++) {
    const rows = await readChunk(env, key, c);
    if (!rows) continue;
    for (const row of rows) {
      if (!row || idxOrder >= row.length) continue;
      const oid = normalizeName(row[idxOrder]);
      if (oid) set.add(oid);
    }
  }
  return set;
}

async function ensureSheetsCache(env, me, source, brand, fetchImpl) {
  const key = cacheKey(me.username, brand, source);
  const manifest = await readManifest(env, key);
  if (manifest) return manifest;
  return loadFromSheets(env, me, source, brand, fetchImpl);
}

// ---------- Point d'entrée : enveloppe JSON pour le front ----------
// opts : { page (0-based), pageSize, fresh (1 = forcer, proprio seulement) }.
export async function getSheetsData(env, me, source, brand = 'yassir', opts = {}, fetchImpl = fetch) {
  if (!SHEET_SOURCES.includes(source)) {
    throw new SheetsError(400, 'Source inconnue.');
  }
  if (brand !== 'yassir' && brand !== 'kool') {
    throw new SheetsError(400, 'Marque invalide.');
  }
  const page = Math.max(0, Math.floor(opts.page ?? 0) || 0);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(opts.pageSize ?? DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE));
  const fresh = opts.fresh === 1 || opts.fresh === true || opts.fresh === '1';
  const filtered = me.role === 'am' || me.role === 'market_am';

  // market_am (Eya) : rien en Kool — réponse vide sans lecture des feuilles.
  if (me.role === 'market_am' && brand === 'kool') {
    return {
      source, brand, role: me.role, filtered: true, access: 'none',
      cached: false, updatedAt: new Date().toISOString(),
      tabs: [], skippedTabs: [], partial: false,
      page, pageSize, totalRows: 0, totalPages: 0,
      note: 'Aucun accès Kool pour ce rôle.',
      rows: []
    };
  }
  // Statuts : feuille Yassir uniquement (désactivée en Kool côté front).
  if (source === 'statuts' && brand === 'kool') {
    return {
      source, brand, role: me.role, filtered, access: 'none',
      cached: false, updatedAt: new Date().toISOString(),
      tabs: [], skippedTabs: [], partial: false,
      page, pageSize, totalRows: 0, totalPages: 0,
      note: 'Feuille Statuts Yassir uniquement.',
      rows: []
    };
  }

  const key = cacheKey(me.username, brand, source);
  const forceReload = fresh && me.role === 'owner';
  let manifest = null;
  let cached = false;
  if (!forceReload) {
    manifest = await readManifest(env, key);
    if (manifest) cached = true;
  }
  if (!manifest) {
    manifest = await loadFromSheets(env, me, source, brand, fetchImpl);
    cached = false;
  }
  const totalRows = manifest.totalRows;
  const totalPages = totalRows === 0 ? 0 : Math.ceil(totalRows / pageSize);
  const start = page * pageSize;
  let pageRows = [];
  if (start < totalRows) {
    const end = Math.min(totalRows, start + pageSize);
    const firstChunk = Math.floor(start / KV_CHUNK_ROWS);
    const lastChunk = Math.floor((end - 1) / KV_CHUNK_ROWS);
    let all = [];
    let missing = false;
    for (let c = firstChunk; c <= lastChunk; c++) {
      const rows = await readChunk(env, key, c);
      if (!rows) { missing = true; break; }
      all = all.concat(rows);
    }
    if (missing) {
      // Paquet expiré entre-temps : recharger puis relire la page.
      manifest = await loadFromSheets(env, me, source, brand, fetchImpl);
      cached = false;
      all = [];
      const end2 = Math.min(manifest.totalRows, start + pageSize);
      const last2 = manifest.totalRows === 0 ? -1 : Math.floor((end2 - 1) / KV_CHUNK_ROWS);
      for (let c = firstChunk; c <= last2; c++) {
        const rows = await readChunk(env, key, c);
        if (rows) all = all.concat(rows);
      }
      pageRows = all.slice(start - firstChunk * KV_CHUNK_ROWS, start - firstChunk * KV_CHUNK_ROWS + pageSize);
      return {
        source, brand, role: me.role, filtered, cached,
        updatedAt: manifest.updatedAt, tabs: manifest.tabs, skippedTabs: manifest.skippedTabs,
        partial: manifest.partial, page, pageSize,
        totalRows: manifest.totalRows,
        totalPages: manifest.totalRows === 0 ? 0 : Math.ceil(manifest.totalRows / pageSize),
        rows: [manifest.headers, ...pageRows]
      };
    }
    pageRows = all.slice(start - firstChunk * KV_CHUNK_ROWS, start - firstChunk * KV_CHUNK_ROWS + pageSize);
  }
  return {
    source, brand, role: me.role, filtered, cached,
    updatedAt: manifest.updatedAt, tabs: manifest.tabs, skippedTabs: manifest.skippedTabs,
    partial: manifest.partial, page, pageSize, totalRows, totalPages,
    rows: [manifest.headers, ...pageRows]
  };
}
