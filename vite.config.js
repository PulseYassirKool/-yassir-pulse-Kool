import { defineConfig, loadEnv } from 'vite';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const JS_DIR = resolve('src/js');

// Assemble les sections src/js/NN-*.js (même portée, même ordre que l'ancien fichier unique) en un seul module.
// Étape suivante possible : convertir chaque section en vrai module ES (import/export).
function legacyApp() {
  const id = 'virtual:legacy-app';
  return {
    name: 'legacy-app',
    resolveId: (source) => (source === id ? '\0' + id : null),
    load(requested) {
      if (requested !== '\0' + id) return null;
      const files = readdirSync(JS_DIR).filter((f) => f.endsWith('.js')).sort();
      files.forEach((f) => this.addWatchFile(resolve(JS_DIR, f)));
      const code = files.map((f) => readFileSync(resolve(JS_DIR, f), 'utf8')).join('\n');
      return `(function () {\n'use strict';\n${code}\n})();`;
    }
  };
}

// Politique de sécurité du contenu : seules les origines nécessaires sont autorisées.
function csp(apiUrl) {
  const api = apiUrl ? new URL(apiUrl).origin : '';
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://docs.google.com", // 'unsafe-inline' : gestionnaires onclick="" hérités ; JSONP Google Sheets
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${api} https://docs.google.com https://*.googleusercontent.com`.replace(/\s+/g, ' ').trim(),
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'"
  ].join('; ');
}

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    base: './',
    plugins: [
      legacyApp(),
      {
        name: 'csp',
        transformIndexHtml(html) {
          return command === 'build'
            ? html.replace('__CSP__', csp(env.VITE_API_URL))
            : html.replace(/\s*<meta http-equiv="Content-Security-Policy"[^>]*>/, '');
        }
      }
    ],
    build: { target: 'es2019', chunkSizeWarningLimit: 1500 }
  };
});
