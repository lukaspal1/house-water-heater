import { createServer } from 'node:http';
import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Tecomat } from './tecomat.js';
import { PAGES, ITEMS, USAGE, parseValue, parseUsage } from './settings.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = join(ROOT, 'public');
const DATA_DIR = join(ROOT, 'data');
const HISTORY_FILE = join(DATA_DIR, 'history.jsonl');
const PORT = Number(process.env.PORT) || 8080;
const POLL_MS = 15_000;
const SETTINGS_POLL_MS = 60_000;
const HISTORY_EVERY_MS = 60_000;

// Value names on UVOD.XML, mapped from the controller's UVOD.XSL layout.
const FIELDS = {
  tuvTemp:     { name: '__R45989_REAL_.1f', type: 'num' },  // hot water tank temperature
  heatingTemp: { name: '__R45993_REAL_.1f', type: 'num' },  // heating water (ekvitermní křivka)
  outdoorTemp: { name: '__R47977_REAL_.1f', type: 'num' },  // outdoor temperature
  hpOutput:    { name: '__R21082_REAL_.0f', type: 'num' },  // heat pump output %
  kwhHeating:  { name: '__R40462_REAL_.0f', type: 'num' },  // heating/cooling energy total
  kwhTuv:      { name: '__R40466_REAL_.0f', type: 'num' },  // hot water energy total
  plcTime:     { name: '__R37136_TIME_Thh:mm', type: 'str' },
  mode:        { name: '__R99586_STRING[80]_s', type: 'str' },
  summerMode:  { name: '__R2435.3_BOOL_i', type: 'bool' },
  circuit1:    { name: '__R91466.0_BOOL_i', type: 'bool' },
};

// The only values the dashboard may write.
const SWITCHES = {
  heatpump: { name: '__R21081.2_BOOL_i', label: 'Heat pump' },
  tuv:      { name: '__R2435.1_BOOL_i',  label: 'Hot water' },
};

const plc = new Tecomat({
  host: process.env.TECOMAT_HOST,
  user: process.env.TECOMAT_USER,
  pass: process.env.TECOMAT_PASS,
});

let state = { online: false, updatedAt: null, error: 'Starting…' };
let lastHistoryAt = 0;

// Latest raw values of every controller page we read, keyed by page.
const pageCache = {};
let settingsError = null;

async function readPage(page) {
  const values = await plc.read(page);
  pageCache[page] = { values, at: Date.now() };
  return values;
}

// The settings pages change rarely, so they are read less often than UVOD.XML.
async function pollSettings() {
  for (const page of Object.values(PAGES)) {
    if (page === PAGES.main) continue;
    try {
      await readPage(page);
      settingsError = null;
    } catch (err) {
      settingsError = err.message;
      console.error(new Date().toISOString(), `reading ${page} failed:`, err.message);
    }
  }
}

function settingsSnapshot() {
  const values = {};
  for (const [id, { page, name }] of Object.entries(ITEMS)) {
    values[id] = parseValue(name, pageCache[page]?.values[name]);
  }
  const updated = Object.values(pageCache).map((p) => p.at);
  return {
    values,
    usage: parseUsage(pageCache[USAGE.page]?.values),
    updatedAt: updated.length ? Math.min(...updated) : null,
    error: settingsError,
  };
}

// Writes go one at a time so quick repeated taps step the value once per tap.
let writeQueue = Promise.resolve();
function queued(fn) {
  const run = writeQueue.then(fn, fn);
  writeQueue = run.catch(() => {});
  return run;
}

function parse(raw) {
  const out = {};
  for (const [key, { name, type }] of Object.entries(FIELDS)) {
    const v = raw[name];
    out[key] = v === undefined ? null : type === 'num' ? Number(v) : type === 'bool' ? v === '1' : v;
  }
  out.switches = {};
  for (const [key, { name }] of Object.entries(SWITCHES)) out.switches[key] = raw[name] === '1';
  return out;
}

async function poll() {
  try {
    const values = parse(await readPage(PAGES.main));
    state = { online: true, updatedAt: Date.now(), error: null, ...values };
    if (Date.now() - lastHistoryAt >= HISTORY_EVERY_MS) {
      lastHistoryAt = Date.now();
      const { tuvTemp, heatingTemp, outdoorTemp, hpOutput, kwhHeating, kwhTuv } = values;
      const room = ITEMS['heat.roomTemp'];
      const roomTemp = parseValue(room.name, pageCache[room.page]?.values[room.name]);
      const row = { t: lastHistoryAt, tuvTemp, heatingTemp, outdoorTemp, roomTemp, hpOutput, kwhHeating, kwhTuv };
      await appendFile(HISTORY_FILE, JSON.stringify(row) + '\n');
    }
  } catch (err) {
    state = { ...state, online: false, error: err.message };
    console.error(new Date().toISOString(), 'poll failed:', err.message);
  }
}

async function readHistory(sinceMs) {
  const rows = [];
  try {
    const lines = createInterface({ input: createReadStream(HISTORY_FILE), crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line) continue;
      const row = JSON.parse(line);
      if (row.t >= sinceMs) rows.push(row);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  return rows;
}

// Thins a long series to roughly maxPoints by keeping every nth row.
function downsample(rows, maxPoints) {
  if (rows.length <= maxPoints) return rows;
  const step = Math.ceil(rows.length / maxPoints);
  return rows.filter((_, i) => i % step === 0 || i === rows.length - 1);
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 10_000) throw new Error('Body too large');
  }
  return body ? JSON.parse(body) : {};
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

async function serveStatic(res, urlPath) {
  const file = urlPath === '/' ? 'index.html' : urlPath.slice(1);
  if (file.includes('..') || file.includes('\\')) return sendJson(res, 400, { error: 'Bad path' });
  try {
    const data = await readFile(join(PUBLIC_DIR, file));
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: 'Not found' });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/api/state') {
      return sendJson(res, 200, state);
    }
    if (req.method === 'GET' && url.pathname === '/api/history') {
      const hours = Math.min(Math.max(Number(url.searchParams.get('hours')) || 24, 1), 24 * 31);
      const rows = await readHistory(Date.now() - hours * 3600_000);
      return sendJson(res, 200, downsample(rows, 600));
    }
    if (req.method === 'POST' && url.pathname === '/api/switch') {
      const { id, on } = await readBody(req);
      const sw = SWITCHES[id];
      if (!sw || typeof on !== 'boolean') return sendJson(res, 400, { error: 'Unknown switch' });
      await queued(() => plc.write(sw.name, on ? 1 : 0));
      console.log(new Date().toISOString(), `${sw.label} switched ${on ? 'ON' : 'OFF'}`);
      await poll();
      return sendJson(res, 200, state);
    }
    if (req.method === 'GET' && url.pathname === '/api/settings') {
      return sendJson(res, 200, settingsSnapshot());
    }
    if (req.method === 'POST' && url.pathname === '/api/settings/step') {
      const { id, dir } = await readBody(req);
      const item = ITEMS[id];
      const button = item && (dir === 'up' ? item.up : dir === 'down' ? item.down : null);
      if (!button) return sendJson(res, 400, { error: 'Unknown setting' });
      await queued(async () => {
        await plc.pulse(button, item.page);
        await readPage(item.page);
      });
      console.log(new Date().toISOString(), `${id} ${dir} → ${pageCache[item.page].values[item.name]}`);
      return sendJson(res, 200, settingsSnapshot());
    }
    if (req.method === 'POST' && url.pathname === '/api/settings/toggle') {
      const { id, on } = await readBody(req);
      const item = ITEMS[id];
      if (!item?.toggle || typeof on !== 'boolean') return sendJson(res, 400, { error: 'Unknown setting' });
      await queued(async () => {
        await plc.write(item.name, on ? 1 : 0, item.page);
        await readPage(item.page);
      });
      console.log(new Date().toISOString(), `${id} set ${on ? 'ON' : 'OFF'}`);
      if (item.page === PAGES.main) await poll();
      return sendJson(res, 200, settingsSnapshot());
    }
    if (req.method === 'GET') return serveStatic(res, url.pathname);
    sendJson(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    console.error(new Date().toISOString(), req.method, url.pathname, err.message);
    sendJson(res, 502, { error: err.message });
  }
});

await mkdir(DATA_DIR, { recursive: true });
await poll();
await pollSettings();
setInterval(poll, POLL_MS);
setInterval(pollSettings, SETTINGS_POLL_MS);
server.listen(PORT, () => {
  console.log(`Dashboard running at http://localhost:${PORT}`);
});
