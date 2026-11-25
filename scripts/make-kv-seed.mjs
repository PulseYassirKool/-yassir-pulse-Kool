// Prépare les données initiales du Worker à partir de private/seed.json (jamais commité).
// Usage : node scripts/make-kv-seed.mjs
// Puis  : cd worker && npx wrangler kv bulk put ../private/kv-seed.json --binding PULSE_KV --remote
//         npx wrangler secret put JWT_SECRET   (≥ 32 caractères aléatoires)
//         npx wrangler secret put LEGACY_SALT  (valeur affichée ci-dessous)
import { readFileSync, writeFileSync } from 'node:fs';

const seed = JSON.parse(readFileSync('private/seed.json', 'utf8'));
const entries = [
  { key: 'accounts', value: JSON.stringify(seed.accounts) },
  { key: 'config', value: JSON.stringify({ live: seed.live, kool: seed.kool }) },
  { key: 'defaults', value: JSON.stringify({ commissions: seed.commissions, portfolios: seed.portfolios }) }
];
writeFileSync('private/kv-seed.json', JSON.stringify(entries));
console.log(`OK : private/kv-seed.json (${seed.accounts.length} comptes, ${Object.keys(seed.commissions).length} commissions)`);
console.log('LEGACY_SALT à enregistrer comme secret :', seed.legacySalt);
console.log('Les mots de passe actuels restent valides ; chaque compte passe en PBKDF2 à sa première connexion.');
