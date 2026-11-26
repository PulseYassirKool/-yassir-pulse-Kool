// Audit XSS : repère les `innerHTML = ...` / insertAdjacentHTML qui concatènent une valeur
// non entourée de escapeHtml()/Number()/.toFixed()/… Usage : node scripts/audit-innerhtml.mjs [--all]
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'src/js';
const SAFE = /^(escapeHtml\(|esc\(|Number\(|parseInt\(|parseFloat\(|Math\.|String\(Math|formatNumber\(|fmt[A-Za-z]*\(|format[A-Za-z]*\(|toLocale|\(?\s*[A-Za-z_.]+\.toFixed\(|[A-Za-z_.]+\.length\b|idx\b|i\b|index\b)/;
// Opérandes relus à la main : nombres, classes CSS, ou « HTML par contrat » (message construit avec escapeHtml en amont).
// Revue manuelle du 25/11/2026 : en-têtes constants, nombres, et textes de données déjà passés par escapeHtml().
const REVIEWED = /^(bestWAvg|avgDayDel|1\)|STAT_HEADERS|OFFRES_HEADERS|visibleCols|dayDeliveredCounts|dayGmvSums|dayStats|currentCancReasonsSummary|\(ownerAdmin|\(gmvVal|\(fallbackTxt|\(cancReasonFilterMode|\(STAT_HEADERS|\(visibleCols|Market\)<\/option>|cA|sA|cSt|sSt|diffStores|rOffset|colSpanCount|cnt|r\.count|d\.canc|d\.restoRej|a\.colorClass|a\.icon|a\.message|htmlMessage|vsBestAvgPct|wowCa|gmvVal|totalEff|\(?(wowCa|vsBestAvgPct)\b)/;
const showAll = process.argv.includes('--all');
let flagged = 0, total = 0;

for (const file of readdirSync(DIR).filter((f) => f.endsWith('.js')).sort()) {
  const lines = readFileSync(join(DIR, file), 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (!/\.innerHTML\s*\+?=|insertAdjacentHTML\(/.test(line)) return;
    total++;
    let stmt = line;
    for (let j = i + 1; j < Math.min(i + 120, lines.length) && !/;\s*$/.test(stmt.trimEnd()) ; j++) stmt += '\n' + lines[j];
    // Opérandes concaténés qui ne sont pas des littéraux de chaîne
    const operands = [];
    const re = /\+\s*([^+;]+?)(?=\s*\+|\s*;|\s*$)/gms;
    let m;
    while ((m = re.exec(stmt))) {
      const op = m[1].trim();
      if (!op || /^['"`]/.test(op) || /^[0-9.]+$/.test(op) || SAFE.test(op) || REVIEWED.test(op)) continue;
      operands.push(op.replace(/\s+/g, ' ').slice(0, 70));
    }
    const tpl = [...stmt.matchAll(/\$\{([^}]+)\}/g)].map((x) => x[1].trim()).filter((op) => !SAFE.test(op) && !REVIEWED.test(op));
    const risky = [...operands, ...tpl];
    if (risky.length || showAll) {
      if (risky.length) flagged++;
      console.log(`${file}:${i + 1}  ${risky.length ? '⚠ ' + risky.slice(0, 6).join(' | ') : 'ok'}`);
    }
  });
}
// Règle anti-régression XSS (audit 2026-11-27, item 2) : aucune valeur
// (escapeHtml(...), .replace(...)) ne doit être interpolée dans un attribut
// onclick="..." — les clics passent par data-action + l'écouteur délégué
// (src/js/28-clics-delegues.js). Un onclick avec une constante ('ALL',
// 'RESTAURANT_REJECTED') reste toléré, tout comme onclick="f(this.getAttribute(...))"
// (21-analyse-restaurant.js:154 : la valeur est relue, pas interpolée).
// On ne regarde donc que ce qui suit « onclick » sur la ligne : une valeur
// interpolée y apparaît après l'attribut. Sans cette règle, la faille
// reviendrait au prochain copier-coller.
let onclickFlagged = 0;
for (const file of readdirSync(DIR).filter((f) => f.endsWith('.js')).sort()) {
  const lines = readFileSync(join(DIR, file), 'utf8').split('\n');
  lines.forEach((line, i) => {
    const idx = line.indexOf('onclick');
    if (idx === -1) return;
    const rest = line.slice(idx);
    if (/escapeHtml|\.replace\(/.test(rest)) {
      onclickFlagged++;
      console.log(`${file}:${i + 1}  ⚠ onclick avec valeur interpolée (utiliser data-action) : ${line.trim().slice(0, 120)}`);
    }
  });
}
console.log(`\n${total} assignations HTML, ${flagged} à relire.`);
if (onclickFlagged) console.log(`${onclickFlagged} onclick avec valeur interpolée (faille XSS) — voir 28-clics-delegues.js.`);
process.exit(flagged || onclickFlagged ? 1 : 0);
