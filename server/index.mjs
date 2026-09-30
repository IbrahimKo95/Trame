// Serveur Trame : sert dist/ et expose l'IA (Groq). Aucune dépendance npm.
//   node server/index.mjs            (PORT=8787 par défaut, lit .env s'il existe)
// Variables : GROQ_API_KEY (requis pour l'IA), GROQ_MODEL, GROQ_URL (tests), PORT, RATE_LIMIT (requêtes / 10 min / IP).
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs';
import { join, extname, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { systemPrompt, userPrompt, fromCompact, MAX_PROMPT } from '../src/lib/ai/schema.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// .env minimal (dev) : ne remplace pas les variables déjà définies
const envFile = join(ROOT, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const PORT = Number(process.env.PORT) || 8787;
const KEY = process.env.GROQ_API_KEY || '';
const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const URL_API = process.env.GROQ_URL || 'https://api.groq.com/openai/v1/chat/completions';
const LIMIT = Number(process.env.RATE_LIMIT) || 12;
const WINDOW = 10 * 60 * 1000;
const MAX_BODY = 256 * 1024;
const DIST = join(ROOT, 'dist');

/* ------------------------------------------------------------------ débit par IP */
const hits = new Map();
function allowed(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < WINDOW);
  if (list.length >= LIMIT) { hits.set(ip, list); return Math.ceil((WINDOW - (now - list[0])) / 1000); }
  list.push(now); hits.set(ip, list); return 0;
}
setInterval(() => { const now = Date.now(); for (const [ip, l] of hits) if (!l.some((t) => now - t < WINDOW)) hits.delete(ip); }, WINDOW).unref();

// derrière Cloudflare Tunnel : cf-connecting-ip, sinon premier x-forwarded-for
const clientIp = (req) => String(req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket.remoteAddress || '?').trim();

/* ------------------------------------------------------------------ Groq */
async function callGroq(messages) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90_000);
  try {
    const res = await fetch(URL_API, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ model: MODEL, messages, temperature: 0.2, max_completion_tokens: 8000, response_format: { type: 'json_object' } }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = body?.error?.message || res.statusText;
      if (res.status === 429) throw Object.assign(new Error('Quota Groq atteint, réessaie dans une minute.'), { status: 429 });
      // json_validate_failed : le modèle a produit un JSON invalide -> on relance
      if (body?.error?.code === 'json_validate_failed') return { invalid: true, text: body?.error?.failed_generation || '' };
      throw Object.assign(new Error(`Groq : ${msg}`), { status: 502 });
    }
    return { text: body?.choices?.[0]?.message?.content || '' };
  } catch (e) {
    if (e.name === 'AbortError') throw Object.assign(new Error('Groq ne répond pas (délai dépassé).'), { status: 504 });
    throw e;
  } finally { clearTimeout(timer); }
}

async function generate({ prompt, dialect, current }) {
  const messages = [{ role: 'system', content: systemPrompt(dialect) }, { role: 'user', content: userPrompt(prompt, current) }];
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await callGroq(messages);
    try {
      if (out.invalid) throw new Error('JSON invalide');
      return fromCompact(out.text, { dialect, base: current || null });
    } catch (e) {
      lastErr = e;
      messages.push({ role: 'assistant', content: out.text.slice(0, 20000) }, { role: 'user', content: `Réponse inutilisable (${e.message}). Renvoie uniquement l'objet JSON demandé, complet et valide.` });
    }
  }
  throw Object.assign(new Error(`Réponse de l'IA inutilisable : ${lastErr?.message}`), { status: 502 });
}

/* ------------------------------------------------------------------ HTTP */
const send = (res, status, data, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
};

function readBody(req) {
  return new Promise((ok, ko) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { ko(Object.assign(new Error('Requête trop volumineuse.'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
    req.on('error', ko);
  });
}

async function api(req, res, path) {
  if (path === '/api/health' && req.method === 'GET') return send(res, 200, { ai: !!KEY, model: KEY ? MODEL : null, maxPrompt: MAX_PROMPT });
  if (path !== '/api/generate') return send(res, 404, { error: 'Introuvable.' });
  if (req.method !== 'POST') return send(res, 405, { error: 'Méthode non autorisée.' }, { allow: 'POST' });
  if (!KEY) return send(res, 503, { error: "IA non configurée (GROQ_API_KEY absente)." });
  let input;
  try { input = JSON.parse(await readBody(req)); } catch (e) { return send(res, e.status || 400, { error: e.status ? e.message : 'JSON invalide.' }); }
  const prompt = String(input?.prompt ?? '').trim();
  if (!prompt) return send(res, 400, { error: 'Décris ton projet.' });
  if (prompt.length > MAX_PROMPT) return send(res, 400, { error: `Description trop longue (${MAX_PROMPT} caractères max).` });
  const dialect = ['postgres', 'mysql', 'sqlite'].includes(input?.dialect) ? input.dialect : 'postgres';
  const current = input?.current && Array.isArray(input.current.tables) ? input.current : null;
  const wait = allowed(clientIp(req));
  if (wait) return send(res, 429, { error: `Trop de demandes, réessaie dans ${Math.ceil(wait / 60)} min.` }, { 'retry-after': String(wait) });

  try {
    const t0 = Date.now();
    const out = await generate({ prompt, dialect, current });
    console.log(`[ai] ${clientIp(req)} ${current ? 'edit' : 'new'} ${out.schema.tables.length} tables ${Date.now() - t0} ms`);
    send(res, 200, out);
  } catch (e) {
    console.error('[ai]', e.message);
    send(res, e.status || 500, { error: e.message || 'Erreur serveur.' });
  }
}

/* ------------------------------------------------------------------ fichiers statiques */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8' };

function serveStatic(req, res, path) {
  let file = resolve(DIST, '.' + decodeURIComponent(path));
  if (file !== DIST && !file.startsWith(DIST + sep)) { res.writeHead(403); return res.end(); }
  if (!existsSync(file) || !statSync(file).isFile()) file = join(DIST, 'index.html');
  if (!existsSync(file)) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('dist/ absent : lance « npm run build ».'); }
  const immutable = path.startsWith('/assets/') && !file.endsWith('index.html');
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

createServer((req, res) => {
  const path = new URL(req.url || '/', 'http://x').pathname;
  if (path.startsWith('/api/')) return void api(req, res, path).catch((e) => send(res, 500, { error: e.message }));
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  serveStatic(req, res, path);
}).listen(PORT, () => console.log(`Trame sur http://localhost:${PORT} — IA ${KEY ? `activée (${MODEL})` : 'désactivée (GROQ_API_KEY absente)'}`));
