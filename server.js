import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';
import admin from 'firebase-admin';
import serviceAccount from './firebase-service-account.json' with { type: 'json' };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const PORT = process.env.PORT || 3000;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_OTP_ATTEMPTS = 5;
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

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
const otpStore = new Map();

let emailTransporter = null;
let emailFrom = null;

async function initEmail() {
  if (process.env.SMTP_HOST && process.env.SMTP_USER) {
    emailTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: (process.env.SMTP_SECURE === 'true') || false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS || ''
      }
    });
    emailFrom = process.env.SMTP_FROM || process.env.SMTP_USER;
    console.log('Using configured SMTP transport.');
    return;
  }

  try {
    const testAccount = await nodemailer.createTestAccount();
    emailTransporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass
      }
    });
    emailFrom = `"Sustainability Twin" <${testAccount.user}>`;
    console.log('Using Ethereal test email account.');
    console.log('Ethereal user:', testAccount.user);
  } catch (err) {
    console.warn('Email transport not available:', err.message);
  }
}

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

function cleanExpiredOtps() {
  const now = Date.now();
  for (const [email, entry] of otpStore) {
    if (entry.expiresAt < now) {
      otpStore.delete(email);
    }
  }
}

function hashOtp(code) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(code).digest('hex');
}

function generateOtp() {
  return crypto.randomInt(100000, 1000000).toString();
}

function signSession(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function verifySession(token) {
  try {
    const [header, body, signature] = token.split('.');
    if (!header || !body || !signature) return null;
    const expected = crypto.createHmac('sha256', SESSION_SECRET).update(`${header}.${body}`).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(header) {
  if (!header) return {};
  return Object.fromEntries(
    header.split(';').map(c => {
      const [k, ...v] = c.trim().split('=');
      return [k, v.join('=')];
    })
  );
}

function setSessionCookie(res, token) {
  const expires = new Date(Date.now() + SESSION_MAX_AGE_MS).toUTCString();
  res.setHeader('Set-Cookie', `session=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${Math.floor(SESSION_MAX_AGE_MS / 1000)}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'session=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0');
}

function getSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  if (!cookies.session) return null;
  return verifySession(cookies.session);
}

async function verifyFirebaseIdToken(idToken) {
  try {
    return await admin.auth().verifyIdToken(idToken);
  } catch (err) {
    err.status = 401;
    throw err;
  }
}

async function sendOtpEmail(email, code) {
  if (!emailTransporter) {
    throw new Error('Email transport is not configured.');
  }
  const info = await emailTransporter.sendMail({
    from: emailFrom,
    to: email,
    subject: 'Your Sustainability Digital Twin verification code',
    text: `Your one-time verification code is: ${code}\n\nThis code expires in 5 minutes.`,
    html: `
      <div style="font-family:Inter,Segoe UI,sans-serif;background:#05070f;color:#e9f1ff;padding:24px;border-radius:12px;border:1px solid rgba(94,234,212,0.2);max-width:420px;">
        <h2 style="color:#4fd1c5;margin-top:0;">Sustainability Digital Twin</h2>
        <p style="color:#8ea3c9;">Use the code below to complete your sign-in.</p>
        <div style="font-size:2rem;font-weight:800;letter-spacing:0.2em;background:rgba(79,209,197,0.1);border:1px solid rgba(79,209,197,0.3);border-radius:10px;padding:16px;text-align:center;color:#4fd1c5;margin:16px 0;">
          ${code}
        </div>
        <p style="color:#8ea3c9;font-size:0.85rem;">This code expires in 5 minutes. Do not share it with anyone.</p>
      </div>
    `
  });
  if (info.ethereal) {
    console.log('OTP email preview URL:', nodemailer.getTestMessageUrl(info));
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
  const session = getSession(req);
  if (!session) {
    sendJSON(res, 401, { error: 'Authentication required.' });
    return;
  }

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

async function handleOtpSend(req, res) {
  let body = '';
  for await (const chunk of req) body += chunk;

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    sendJSON(res, 400, { error: 'Invalid JSON body.' });
    return;
  }

  const { idToken, email } = payload;
  if (!idToken || !email) {
    sendJSON(res, 400, { error: 'idToken and email are required.' });
    return;
  }

  try {
    const user = await verifyFirebaseIdToken(idToken);
    if (user.email !== email) {
      sendJSON(res, 401, { error: 'Email mismatch.' });
      return;
    }
  } catch (err) {
    sendJSON(res, err.status || 401, { error: err.message });
    return;
  }

  cleanExpiredOtps();

  const code = generateOtp();
  const record = {
    hash: hashOtp(code),
    expiresAt: Date.now() + OTP_TTL_MS,
    attempts: 0
  };
  otpStore.set(email.toLowerCase(), record);

  if (process.env.LOG_OTP !== 'false') {
    console.log(`[OTP] Generated code for ${email}: ${code}`);
  }

  try {
    await sendOtpEmail(email, code);
    sendJSON(res, 200, { sent: true });
  } catch (err) {
    otpStore.delete(email.toLowerCase());
    sendJSON(res, 503, { error: err.message || 'Failed to send OTP email.' });
  }
}

async function handleOtpVerify(req, res) {
  let body = '';
  for await (const chunk of req) body += chunk;

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    sendJSON(res, 400, { error: 'Invalid JSON body.' });
    return;
  }

  const { email, code } = payload;
  if (!email || !code) {
    sendJSON(res, 400, { error: 'Email and OTP code are required.' });
    return;
  }

  cleanExpiredOtps();

  const key = email.toLowerCase();
  const record = otpStore.get(key);
  if (!record) {
    sendJSON(res, 401, { error: 'OTP expired or not found. Please request a new code.' });
    return;
  }

  if (record.expiresAt < Date.now()) {
    otpStore.delete(key);
    sendJSON(res, 401, { error: 'OTP expired. Please request a new code.' });
    return;
  }

  record.attempts += 1;
  if (record.attempts > MAX_OTP_ATTEMPTS) {
    otpStore.delete(key);
    sendJSON(res, 401, { error: 'Too many failed attempts. Please request a new code.' });
    return;
  }

  if (hashOtp(code) !== record.hash) {
    sendJSON(res, 401, { error: 'Invalid OTP. Please try again.' });
    return;
  }

  otpStore.delete(key);
  const token = signSession({ email, exp: Date.now() + SESSION_MAX_AGE_MS });
  setSessionCookie(res, token);
  sendJSON(res, 200, { ok: true });
}

function handleSession(req, res) {
  const session = getSession(req);
  if (!session) {
    sendJSON(res, 401, { error: 'Not authenticated.' });
    return;
  }
  sendJSON(res, 200, { email: session.email });
}

function isProtectedPath(pathname) {
  return pathname === '/' || pathname === '/index.html';
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || `http://${req.headers.host}`;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  // Auth-protected HTML pages
  if (req.method === 'GET' && isProtectedPath(pathname)) {
    const session = getSession(req);
    if (!session) {
      res.writeHead(302, { Location: '/login.html' });
      res.end();
      return;
    }
  }

  if (pathname === '/api/insights' && req.method === 'POST') {
    await handleInsights(req, res);
  } else if (pathname === '/api/auth/otp/send' && req.method === 'POST') {
    await handleOtpSend(req, res);
  } else if (pathname === '/api/auth/otp/verify' && req.method === 'POST') {
    await handleOtpVerify(req, res);
  } else if (pathname === '/api/auth/session' && req.method === 'POST') {
    handleSession(req, res);
  } else if (req.method === 'GET') {
    await serveStatic(req, res);
  } else {
    sendJSON(res, 405, { error: 'Method not allowed.' });
  }
});

await initEmail();

server.listen(PORT, () => {
  console.log(`Sustainability Digital Twin server running at http://localhost:${PORT}`);
  console.log(`Using Gemini model: ${GEMINI_MODEL}`);
  if (!process.env.SESSION_SECRET) {
    console.log('SESSION_SECRET not set; a random secret was generated (sessions reset on restart).');
  }
});
