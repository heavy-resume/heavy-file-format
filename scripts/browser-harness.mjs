import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRATCH_DIR = resolve(ROOT, 'scratch');
const PID_FILE = resolve(SCRATCH_DIR, 'browser-harness.pid');
const LOG_FILE = resolve(SCRATCH_DIR, 'browser-harness.log');
const SMOKE_FILE = resolve(SCRATCH_DIR, 'browser-smoke.mjs');
const CHAT_PERF_FILE = resolve(ROOT, 'scripts/chat-performance-harness.mjs');
const HOST = '127.0.0.1';
const PORT = 5174;
const BASE_URL = `http://${HOST}:${PORT}/`;

const command = process.argv[2] ?? 'smoke';

mkdirSync(SCRATCH_DIR, { recursive: true });

if (command === 'start') {
  await startServer();
} else if (command === 'stop') {
  stopServer();
} else if (command === 'smoke') {
  await ensureSmokeFile();
  await runSmoke();
} else if (command === 'chat-perf') {
  await runScript(CHAT_PERF_FILE, 'scripts/chat-performance-harness.mjs');
} else {
  console.error(`Unknown browser harness command: ${command}`);
  process.exitCode = 1;
}

async function startServer() {
  if (await isServerReady()) {
    console.log(`Browser harness server already running at ${BASE_URL}`);
    return;
  }
  const logFd = openSync(LOG_FILE, 'a');
  const child = spawn(
    process.execPath,
    [resolve(ROOT, 'node_modules/vite/bin/vite.js'), '--host', HOST, '--port', String(PORT)],
    {
      cwd: ROOT,
      detached: true,
      stdio: ['ignore', logFd, logFd],
    }
  );

  writeFileSync(PID_FILE, String(child.pid));
  child.unref();
  closeSync(logFd);

  await waitForServer();
  console.log(`Browser harness server started at ${BASE_URL}`);
}

function stopServer() {
  if (!existsSync(PID_FILE)) {
    console.log('No browser harness server pid file found.');
    return;
  }
  const pid = Number.parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10);
  if (!Number.isFinite(pid)) {
    console.log('Browser harness pid file was invalid.');
    return;
  }
  try {
    process.kill(pid);
    unlinkSync(PID_FILE);
    console.log(`Stopped browser harness server pid ${pid}.`);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH') {
      unlinkSync(PID_FILE);
      console.log(`Browser harness server pid ${pid} was not running.`);
      return;
    }
    throw error;
  }
}

async function ensureSmokeFile() {
  if (existsSync(SMOKE_FILE)) {
    return;
  }
  writeFileSync(
    SMOKE_FILE,
    `export default async function browserSmoke({ chromium, baseUrl }) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  console.log(JSON.stringify({ title: await page.title(), url: page.url() }));
  await browser.close();
}
`
  );
}

async function runSmoke() {
  await runScript(SMOKE_FILE, 'scratch/browser-smoke.mjs');
}

async function runScript(scriptFile, label) {
  await waitForServer();
  const smokeUrl = pathToFileURL(scriptFile);
  smokeUrl.searchParams.set('t', String(Date.now()));
  const smoke = await import(smokeUrl.href);
  if (typeof smoke.default !== 'function') {
    throw new Error(`${label} must export a default async function.`);
  }
  await smoke.default({ chromium, baseUrl: BASE_URL });
}

async function waitForServer() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await isServerReady()) {
      return;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }
  throw new Error(`Timed out waiting for ${BASE_URL}. Run npm run browser:start first.`);
}

async function isServerReady() {
  try {
    const response = await fetch(BASE_URL, { method: 'HEAD' });
    return response.ok;
  } catch {
    return false;
  }
}
