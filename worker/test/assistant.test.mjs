// Tests de l'assistant IA : POST /api/assistant (Gemini, clé simulée).
// L'appel Gemini est simulé (fetch global remplacé) : aucun appel réseau réel,
// aucune vraie clé — la « clé » de test est une chaîne fictive.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, hashPassword } from '../src/index.js';
import { ASSISTANT_SYSTEM_PROMPT } from '../src/gemini.js';

const kvStore = new Map();
const kv = {
  get: async (k, t) => (kvStore.has(k) ? (t === 'json' ? JSON.parse(kvStore.get(k)) : kvStore.get(k)) : null),
  put: async (k, v) => { kvStore.set(k, typeof v === 'string' ? v : JSON.stringify(v)); },
  delete: async (k) => { kvStore.delete(k); },
  list: async () => ({ keys: [], list_complete: true, cursor: null })
};
const env = { PULSE_KV: kv, JWT_SECRET: 'x'.repeat(40), LEGACY_SALT: 'SEL_HERITE::', ALLOWED_ORIGIN: 'https://app.test' };
const call = (method, path, body, token) => handle(new Request('https://api.test' + path, {
  method, body: body ? JSON.stringify(body) : undefined,
  headers: { Origin: 'https://app.test', ...(token ? { Authorization: 'Bearer ' + token } : {}) }
}), env).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));

const realFetch = globalThis.fetch;
const fakeGeminiOk = (answer) => async (url, opts) => {
  globalThis.__geminiLastCall = { url: String(url), opts };
  return {
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text: answer }] } }] })
  };
};
const fakeGeminiFail = (status) => async () => ({ ok: false, status, json: async () => ({}) });
const fakeGeminiEmpty = async () => ({ ok: true, status: 200, json: async () => ({ candidates: [] }) });

test.before(async () => {
  kvStore.set('accounts', JSON.stringify([
    { username: 'proprio', hash: await hashPassword('Secret-Proprio-1'), role: 'owner', displayName: 'P', amName: null, protected: true }
  ]));
  env.GEMINI_API_KEY = 'CLE_TEST_SIMULEE_JAMAIS_UNE_VRAIE_CLE';
});
test.after(() => {
  globalThis.fetch = realFetch;
  delete env.GEMINI_API_KEY;
  delete globalThis.__geminiLastCall;
});

const loginOwner = async () => (await call('POST', '/api/login', { username: 'proprio', password: 'Secret-Proprio-1' })).json.token;

test('assistant : sans jeton -> 401 ; question vide ou trop longue -> 400', async () => {
  assert.equal((await call('POST', '/api/assistant', { question: 'Bonjour', context: 'ctx' })).status, 401);
  const token = await loginOwner();
  assert.equal((await call('POST', '/api/assistant', { question: '   ', context: 'ctx' }, token)).status, 400);
  assert.equal((await call('POST', '/api/assistant', { question: 'x'.repeat(2001), context: 'ctx' }, token)).status, 400);
  assert.equal((await call('POST', '/api/assistant', { question: 'Bonjour', context: 'x'.repeat(20001) }, token)).status, 400);
  globalThis.fetch = fakeGeminiOk('ok');
  try {
    assert.equal((await call('POST', '/api/assistant', { question: 'Bonjour' }, token)).status, 200);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('assistant : la clé Gemini n\'est jamais exposée (en-tête seulement, jamais URL ni corps ni réponse)', async () => {
  globalThis.fetch = fakeGeminiOk('Réponse simulée.');
  try {
    const token = await loginOwner();
    const r = await call('POST', '/api/assistant', { question: 'Combien de commandes ?', context: 'Babke : 12 commandes.' }, token);
    assert.equal(r.status, 200);
    assert.equal(r.json.answer, 'Réponse simulée.');
    const last = globalThis.__geminiLastCall;
    assert.ok(String(last.url).includes('gemini-3.5-flash:generateContent'), 'mauvais modèle/URL : ' + last.url);
    assert.equal(last.opts.headers['x-goog-api-key'], 'CLE_TEST_SIMULEE_JAMAIS_UNE_VRAIE_CLE');
    assert.ok(!String(last.url).includes('CLE_TEST'), 'la clé ne doit jamais être dans l\'URL');
    assert.ok(!String(last.opts.body).includes('CLE_TEST'), 'la clé ne doit jamais être dans le corps');
    const body = JSON.parse(last.opts.body);
    assert.ok(JSON.stringify(body.systemInstruction).includes('N\'invente jamais'), 'consigne système absente');
    assert.ok(JSON.stringify(body.contents).includes('Babke : 12 commandes.'), 'contexte non transmis');
    assert.ok(JSON.stringify(body.contents).includes('Combien de commandes ?'), 'question non transmise');
    assert.equal(JSON.stringify(r.json).includes('CLE_TEST'), false, 'la clé ne doit jamais être dans la réponse');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('assistant : sans clé configurée -> 503 propre ; Gemini en erreur ou vide -> 502 propre', async () => {
  const token = await loginOwner();
  delete env.GEMINI_API_KEY;
  globalThis.fetch = fakeGeminiOk('Ne doit pas être appelée.');
  try {
    const r = await call('POST', '/api/assistant', { question: 'Bonjour', context: 'ctx' }, token);
    assert.equal(r.status, 503);
    assert.equal(r.json.error, 'Assistant indisponible pour le moment.');
  } finally {
    env.GEMINI_API_KEY = 'CLE_TEST_SIMULEE_JAMAIS_UNE_VRAIE_CLE';
    globalThis.fetch = realFetch;
  }
  globalThis.fetch = fakeGeminiFail(500);
  try {
    const r = await call('POST', '/api/assistant', { question: 'Bonjour', context: 'ctx' }, token);
    assert.equal(r.status, 502);
    assert.equal(r.json.error, 'Assistant indisponible pour le moment.');
    assert.ok(!JSON.stringify(r.json).includes('500'), 'aucun détail technique dans l\'erreur');
    // Diagnostic serveur : la cause est gardée en KV (jamais dans la réponse).
    assert.equal(JSON.parse(kvStore.get('asst:lastError')).status, '500');
  } finally {
    globalThis.fetch = realFetch;
  }
  globalThis.fetch = fakeGeminiEmpty;
  try {
    const r = await call('POST', '/api/assistant', { question: 'Bonjour', context: 'ctx' }, token);
    assert.equal(r.status, 502);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('assistant : limite anti-abus — 30 questions puis 429', async () => {
  for (const k of [...kvStore.keys()]) if (k.startsWith('asst:')) kvStore.delete(k);
  globalThis.fetch = fakeGeminiOk('ok');
  try {
    const token = await loginOwner();
    for (let i = 0; i < 30; i++) {
      assert.equal((await call('POST', '/api/assistant', { question: 'Question ' + i, context: 'ctx' }, token)).status, 200, 'question ' + (i + 1));
    }
    assert.equal((await call('POST', '/api/assistant', { question: 'Question 31', context: 'ctx' }, token)).status, 429);
  } finally {
    globalThis.fetch = realFetch;
    for (const k of [...kvStore.keys()]) if (k.startsWith('asst:')) kvStore.delete(k);
  }
});

test('assistant : la consigne système interdit d\'inventer et de sortir du périmètre', () => {
  assert.ok(ASSISTANT_SYSTEM_PROMPT.includes('N\'invente jamais'), 'règle anti-invention absente');
  assert.ok(ASSISTANT_SYSTEM_PROMPT.includes('périmètre'), 'règle de périmètre absente');
  assert.ok(ASSISTANT_SYSTEM_PROMPT.includes('français simple'), 'langue de réponse absente');
});
