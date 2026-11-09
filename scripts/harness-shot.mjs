#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Screenshots an app's UI harness (apps/<app>/harness) without a backend.
//
//   node scripts/harness-shot.mjs --app mes            # standard set, 2x
//   node scripts/harness-shot.mjs --app erp --out /tmp/shots
//   node scripts/harness-shot.mjs --app mes --url 'long=1&dark=1' --name my-shot [--click] [--width 640 --height 420]
//
// Starts the harness's Vite server if nothing listens on its port, and stops it
// when it is done. Needs `playwright` resolvable from Node (the cloud sessions
// have it; locally: `npx playwright install chromium` and `npm i -g playwright`).
// Not agent-specific: run it from Claude Code, Codex or a terminal.

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : (args[i + 1] ?? true);
};
const flag = (name) => args.includes(`--${name}`);

const app = arg("app");
const PORTS = { mes: 3999, erp: 3998 };
if (!PORTS[app]) {
  console.error("usage: harness-shot.mjs --app mes|erp [--out dir] [--url qs --name n [--click]]");
  process.exit(2);
}
const port = PORTS[app];
const out = path.resolve(arg("out", path.join(root, ".harness-shots", app)));
mkdirSync(out, { recursive: true });

let chromium;
try {
  ({ chromium } = createRequire(import.meta.url)("playwright"));
} catch {
  console.error("playwright is not resolvable. Install it: npm i -g playwright && npx playwright install chromium");
  process.exit(1);
}

// The switcher is the first button/link with an aria-label in the rail header.
const SWITCHER = 'button[aria-label*="Acme"], button[aria-label*="Northwind"], a[aria-label*="Acme"], a[aria-label*="Northwind"]';
const RAIL = { x: 0, y: 0, width: 520, height: 420 };
const WIDE = { x: 0, y: 0, width: 640, height: 420 };

// name, query string, whether to open the switcher menu, clip (CSS px)
const SETS = {
  mes: [
    ["1-expanded", "open=1", false, RAIL],
    ["2-menu", "open=1", true, RAIL],
    ["3-collapsed", "", false, { x: 0, y: 0, width: 300, height: 200 }],
    ["4-long-expanded", "open=1&long=1", false, RAIL],
    ["5-long-menu", "open=1&long=1", true, WIDE],
    ["6-dark-menu", "open=1&dark=1", true, RAIL],
    ["7-one-company-menu", "open=1&multi=0", true, RAIL]
  ],
  erp: [
    ["1-expanded", "open=1", false, { ...RAIL, height: 260 }],
    ["2-menu", "open=1", true, RAIL],
    ["3-collapsed", "", false, { x: 0, y: 0, width: 300, height: 200 }],
    ["4-long-expanded", "open=1&long=1", false, { ...RAIL, height: 260 }],
    ["5-long-menu", "open=1&long=1", true, WIDE],
    ["6-dark-menu", "open=1&dark=1", true, RAIL]
  ]
};

const up = () => fetch(`http://localhost:${port}`).then(() => true, () => false);

let server;
if (!(await up())) {
  server = spawn("npx", ["vite", "--config", "harness/vite.config.ts"], {
    cwd: path.join(root, "apps", app),
    env: { ...process.env, HARNESS_PORT: String(port) },
    stdio: "ignore",
    detached: true
  });
  for (let i = 0; i < 60 && !(await up()); i++) await new Promise((r) => setTimeout(r, 1000));
  if (!(await up())) {
    console.error(`harness did not start on :${port}`);
    process.exit(1);
  }
}

const browser = await chromium.launch();
let failed = false;
try {
  const jobs = flag("url")
    ? [[arg("name", "shot"), arg("url"), flag("click"), { x: 0, y: 0, width: Number(arg("width", 640)), height: Number(arg("height", 420)) }]]
    : SETS[app];
  for (const [name, qs, click, clip] of jobs) {
    const page = await (await browser.newContext({ viewport: { width: 1000, height: 420 }, deviceScaleFactor: 2 })).newPage();
    page.on("pageerror", (e) => {
      failed = true;
      console.error(`${name}: page error: ${e.message.slice(0, 200)}`);
    });
    await page.goto(`http://localhost:${port}/?${qs}`);
    await page.waitForSelector(SWITCHER, { timeout: 30000 });
    if (click) {
      await page.click(SWITCHER);
      await page.waitForSelector("[role=menu]");
    }
    await page.waitForTimeout(400);
    const file = path.join(out, `${app}-${name}.png`);
    await page.screenshot({ path: file, clip });
    console.log(file);
    await page.close();
  }
} finally {
  await browser.close();
  if (server) process.kill(-server.pid);
}
process.exit(failed ? 1 : 0);
