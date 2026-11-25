// Bundle IIFE sans CSS, uniquement pour le test d'intégration (jsdom ne lit pas les modules ES).
import { defineConfig } from 'vite';
import base from './vite.config.js';
export default defineConfig((env) => {
  const cfg = base(env);
  return {
    ...cfg,
    plugins: cfg.plugins.slice(0, 1),
    build: { outDir: 'dist-test', emptyOutDir: true, lib: { entry: 'tests/entry.js', name: 'PulseApp', formats: ['iife'], fileName: () => 'app.js' }, minify: false }
  };
});
