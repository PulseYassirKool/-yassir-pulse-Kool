// Appel à l'API Gemini (modèle gemini-2.5-flash) pour l'assistant IA du site.
// La clé ne vit que dans le secret Worker GEMINI_API_KEY (env) : elle n'est
// jamais mise dans un fichier, un log, une URL ou une réponse. `fetchImpl`
// est injectable pour les tests (par défaut le fetch global du Worker).
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent';

// Consigne système envoyée à Gemini à chaque question : l'assistant ne
// répond qu'à partir du contexte fourni par le front (données du site,
// périmètre de l'utilisateur connecté) et dit quand une donnée manque.
export const ASSISTANT_SYSTEM_PROMPT = [
  'Tu es l\'assistant de Yassir Pulse, un outil de pilotage des restaurants Yassir et Kool.',
  'Réponds en français simple et concis, avec les chiffres exacts du contexte.',
  'Règles :',
  '1. N\'utilise QUE les données du contexte fourni. N\'invente jamais un chiffre, un restaurant ou une date.',
  '2. Si le contexte ne contient pas la réponse (restaurant absent, période hors couverture), dis-le clairement au lieu de deviner.',
  '3. Les jours de semaine (lundi, mardi / ethleth, mercredi, jeudi, vendredi / jem3a, samedi, dimanche) : prends le jour le plus récent présent dans le contexte et cite toujours sa date exacte.',
  '4. « Cette semaine » = la semaine en cours indiquée dans le contexte ; « la semaine dernière » = la semaine précédente.',
  '5. « Combien de commandes » = commandes reçues, sauf si la question dit « livrées ».',
  '6. Montants en TND. CA = GMV des commandes livrées (Total Food VF).',
  '7. Ne révèle jamais de données hors du périmètre de l\'utilisateur, ni aucun détail technique (clé, serveur, modèle).'
].join('\n');

export async function askGemini(env, question, context, fetchImpl) {
  const key = env.GEMINI_API_KEY || '';
  if (!key) {
    const e = new Error('Assistant non configuré.');
    e.status = 503;
    throw e;
  }
  // Diagnostic serveur uniquement (jamais dans la réponse ni le front) :
  // la dernière erreur Gemini (statut + message court) est gardée en KV
  // pour comprendre un échec en production sans exposer la clé, la question
  // ou le contexte. Lecture : cf.py kv-get asst:lastError.
  const noterErreur = async (status, message) => {
    try {
      if (env.PULSE_KV && typeof env.PULSE_KV.put === 'function') {
        await env.PULSE_KV.put('asst:lastError', JSON.stringify({
          status: String(status), message: String(message || '').slice(0, 300),
          at: new Date().toISOString()
        }));
      }
    } catch (e) { /* le diagnostic ne doit jamais casser l'assistant */ }
  };
  const doFetch = fetchImpl || fetch;
  let res;
  try {
    res = await doFetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        // Consigne système SANS rôle : la forme canonique de l'API Gemini
        // (un rôle explicite a fait échouer les appels en production).
        systemInstruction: { parts: [{ text: ASSISTANT_SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: 'Contexte (données du site, périmètre de l\'utilisateur) :\n' + context + '\n\nQuestion : ' + question }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 800 }
      })
    });
  } catch (e) {
    await noterErreur('fetch-error', e && e.message ? e.message : 'fetch');
    const err = new Error('Assistant indisponible.');
    err.status = 502;
    throw err;
  }
  if (!res.ok) {
    let detail = '';
    try {
      const eb = await res.json().catch(() => ({}));
      detail = (eb && eb.error && eb.error.message) ? String(eb.error.message) : ('HTTP ' + res.status);
    } catch (e) { detail = 'HTTP ' + res.status; }
    await noterErreur(res.status, detail);
    const err = new Error('Assistant indisponible.');
    err.status = 502;
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
  const text = Array.isArray(parts) ? parts.map((p) => p.text || '').join('').trim() : '';
  if (!text) {
    await noterErreur(200, 'réponse vide (aucun candidat)');
    const err = new Error('Réponse vide.');
    err.status = 502;
    throw err;
  }
  return text;
}
