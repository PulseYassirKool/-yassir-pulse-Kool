# Yassir Pulse v2

M�me application, nouvelle structure : **front** (Vite + Tailwind compilé) et **API** (Cloudflare Worker).
Plus aucun identifiant, hash, ID Google Sheets, commission ni portefeuille dans le code public.

```
src/js/NN-*.js     les 25 sections de l'ancien fichier, assemblées au build (même ordre, même portée)
src/js/02b-auth.js connexion par API, gestion des accès, initApp
src/styles/        base.css + theme-kool.css (Tailwind est compilé, plus de CDN)
worker/            API : connexion, jetons signés, comptes, configuration protégée + tests
scripts/           audit des innerHTML, préparation des données initiales
tests/             test d'intégration (vrai HTML + vrai code + API en mémoire)
private/           NE JAMAIS COMMITER (ignoré par git) : données initiales extraites de l'ancien fichier
```

## Mise en route (ordre à suivre)

1. **Installer** : `npm install` (SheetJS 0.20.2 est téléchargé depuis le CDN officiel SheetJS).
2. **API** :
   ```
   cd worker && npm install
   npx wrangler login
   npx wrangler kv namespace create PULSE_KV      # copier l'id dans wrangler.toml
   # éditer ALLOWED_ORIGIN dans wrangler.toml (l'URL de votre site)
   npx wrangler secret put JWT_SECRET             # 32+ caractères aléatoires
   cd .. && node scripts/make-kv-seed.mjs         # lit private/seed.json, affiche LEGACY_SALT
   cd worker && npx wrangler secret put LEGACY_SALT
   npx wrangler kv bulk put ../private/kv-seed.json --binding PULSE_KV --remote
   npx wrangler deploy
   ```
3. **Front** : `cp .env.example .env`, mettre l'URL du Worker dans `VITE_API_URL`, puis `npm run dev` (ou `npm run build`).
4. **GitHub Pages** : variable de dépôt `VITE_API_URL`, Pages sur « GitHub Actions » ; le workflow `.github/workflows/deploy.yml` fait audit + tests + build + déploiement.

Les mots de passe actuels continuent de fonctionner : chaque compte est converti de SHA-256 vers PBKDF2 à sa première connexion.

## À faire absolument après la bascule

- **Changer tous les mots de passe.** Les anciens hash et leur sel ont été publics dans l'historique git de l'ancien dépôt : on doit les considérer comme compromis. Nouveau minimum : 10 caractères.
- **Supprimer ou rendre privé l'ancien dépôt**, et ne pas réutiliser son historique.
- **Ne pas commiter `private/`** (déjà dans `.gitignore`). Après la mise en place du KV, gardez-le hors ligne.

## Limites connues

- Les Google Sheets restent lisibles « par lien » : leurs ID ne sont plus publics mais ils ne sont pas privés. Pour les protéger vraiment, il faut que le Worker les lise avec un compte de service et serve les données (étape suivante).
- Le jeton est dans `sessionStorage` (ou `localStorage` si « se souvenir de moi », 7 jours). Un cookie `HttpOnly` sur un domaine commun site/API serait plus robuste face au XSS.
- Les caches locaux (IndexedDB / localStorage : fichiers importés, portefeuilles) survivent à la déconnexion : sur un poste partagé, vider les données du site.
- La politique CSP garde `'unsafe-inline'` tant que les `onclick="…"` du HTML existent.
- Verrouillage anti-force-brute : 5 essais / 15 min par IP + identifiant (KV, cohérence éventuelle ; pour du strict, utiliser une Durable Object).

## Vérifications

`npm run check` (audit XSS) · `npm test` (4 tests API + 5 tests d'intégration) · `npm run build`.
