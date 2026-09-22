import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const cache = new Map();

function getCacheKey(payload) {
  const { building, metrics, problems, simulationTime } = payload;
  return JSON.stringify({ building, metrics, problems, simulationTime });
}

function cleanCache() {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now - entry.ts > CACHE_TTL_MS) {
      cache.delete(key);
    }
  }
}

function buildPrompt(payload) {
  const { building, timestamp, metrics, delta, activeProblems, simulationTime, runDuration } = payload;

  const problemText = activeProblems.length
    ? activeProblems.map(p => `- ${p.type} (${p.severity}) on ${p.building}, remaining ${p.remainingMinutes} min`).join('\n')
    : 'None';

  return `You are a sustainability advisor for a smart campus digital twin.
Building: ${building}
Simulation stopped/paused at: ${timestamp} (simulation minute ${simulationTime}, run duration ${runDuration} min)
Final metrics:
- Energy: ${metrics.energy.toFixed(2)} kWh ${delta && delta.energy ? `(delta ${delta.energy > 0 ? '+' : ''}${delta.energy.toFixed(2)})` : ''}
- Water: ${metrics.water.toFixed(2)} L ${delta && delta.water ? `(delta ${delta.water > 0 ? '+' : ''}${delta.water.toFixed(2)})` : ''}
- Occupancy: ${metrics.occupancy.toFixed(1)}% ${delta && delta.occupancy ? `(delta ${delta.occupancy > 0 ? '+' : ''}${delta.occupancy.toFixed(1)})` : ''}
- CO2: ${metrics.co2.toFixed(2)} kg ${delta && delta.co2 ? `(delta ${delta.co2 > 0 ? '+' : ''}${delta.co2.toFixed(2)})` : ''}
Active problems during this run:
${problemText}
Based only on the data above, give one concise, actionable recommendation to improve sustainability or resolve issues for ${building}. Keep it under 3 sentences.`;
}

async function callGemini(apiKey, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }]
      }
    ],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 400
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await response.json();

  if (!response.ok) {
    const message = data?.error?.message || `Gemini API error (${response.status})`;
    const err = new Error(message);
    err.status = response.status;
    throw err;
  }

  const candidate = data?.candidates?.[0];
  const text = candidate?.content?.parts?.map(part => part.text).join('\n') || '';

  if (!text) {
    throw new Error('Gemini returned an empty recommendation.');
  }

  return text.trim();
}

async function serveStatic(req, res) {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  let pathname = parsedUrl.pathname;
  if (pathname === '/') pathname = '/index.html';

  const safePath = path.normalize('.' + pathname).replace(/^(\.\.(\/|$))+/, '');
  const filePath = path.join(__dirname, safePath);

  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  try {
    const stats = await fs.stat(filePath);
    if (stats.isDirectory()) {
      const indexPath = path.join(filePath, 'index.html');
      await fs.access(indexPath);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(await fs.readFile(indexPath));
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(await fs.readFile(filePath));
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}

function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function handleInsights(req, res) {
  let body = '';
  for await (const chunk of req) body += chunk;

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    sendJSON(res, 400, { error: 'Invalid JSON body.' });
    return;
  }

  const apiKey = payload.apiKey;
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 10) {
    sendJSON(res, 400, { error: 'A valid-looking Gemini API key is required.' });
    return;
  }

  if (!payload.building || typeof payload.building !== 'string') {
    sendJSON(res, 400, { error: 'Building name is required.' });
    return;
  }

  cleanCache();
  const key = getCacheKey(payload);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    sendJSON(res, 200, { recommendation: cached.value, cached: true });
    return;
  }

  try {
    const prompt = buildPrompt(payload);
    const recommendation = await callGemini(apiKey, prompt);
    cache.set(key, { ts: Date.now(), value: recommendation });
    sendJSON(res, 200, { recommendation, cached: false });
  } catch (err) {
    const status = err.status || 502;
    sendJSON(res, status, { error: err.message });
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);

  if (parsedUrl.pathname === '/api/insights' && req.method === 'POST') {
    await handleInsights(req, res);
  } else if (req.method === 'GET') {
    await serveStatic(req, res);
  } else {
    sendJSON(res, 405, { error: 'Method not allowed.' });
  }
});

server.listen(PORT, () => {
  console.log(`Sustainability Digital Twin server running at http://localhost:${PORT}`);
  console.log(`Using Gemini model: ${GEMINI_MODEL}`);
});
