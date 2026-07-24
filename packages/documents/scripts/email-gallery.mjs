// Renders every email template + notification preview fixture to HTML and
// stitches them into ONE self-contained gallery page — all emails at a
// glance. Two modes:
//   default:  write .email-gallery/index.html and open it
//   --serve:  HTTP server on EMAIL_DEV_PORT (what `crbn up`'s Email app
//             runs); every request re-renders, so refresh picks up edits
// Run via tsx (`pnpm email:gallery`) so the .tsx template imports resolve.
// Loads the worktree env first for the same reason email-dev.mjs does:
// templates need ERP_URL (via getAppUrl) for asset URLs.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync
} from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { render } from "@react-email/components";
import { createElement } from "react";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../..");
// loadEnvFile never overwrites existing keys — .env.local first so it wins.
for (const file of [".env.local", ".env"]) {
  const path = resolve(repoRoot, file);
  if (existsSync(path)) process.loadEnvFile(path);
}

const emailDir = resolve(scriptDir, "../src/email");
const previewsDir = join(emailDir, "previews");
const sections = [
  { title: "Templates", slug: "templates", dir: emailDir, skip: previewsDir },
  { title: "Previews", slug: "previews", dir: previewsDir }
];

async function renderSection(section) {
  const files = readdirSync(section.dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".tsx"))
    // Templates whose props have no defaults (document emails: PO, quote,
    // invoice…) carry a same-named fixture in previews/ — render that
    // instead of the bare template, which would only produce an error card.
    .filter(
      (e) => !section.skip || !existsSync(join(section.skip, e.name))
    )
    .map((e) => e.name)
    .sort();
  const cards = [];
  for (const file of files) {
    const name = file.replace(/\.tsx$/, "");
    const card = { name, anchor: `${section.slug}-${name}` };
    const path = join(section.dir, file);
    try {
      // Cache-bust by mtime so --serve picks up edits on refresh (ESM module
      // cache is keyed by the full URL, query included). Cheap side effect:
      // an edited file's transitive importers keep their old module — fine
      // for a dev gallery; restart for component-level changes.
      const mtime = statSync(path).mtimeMs;
      const cacheKey = `${path}:${mtime}`;
      const cached = htmlCache.get(cacheKey);
      if (cached !== undefined) {
        card.html = cached;
        cards.push(card);
        continue;
      }
      const mod = await import(`${pathToFileURL(path).href}?v=${mtime}`);
      const Component = mod.default;
      if (typeof Component !== "function") {
        // Shared building blocks (no default-exported email) don't belong in
        // the gallery — components/ is already excluded by directory.
        continue;
      }
      card.html = await render(createElement(Component));
      htmlCache.set(cacheKey, card.html);
    } catch (err) {
      card.error = err instanceof Error ? err.message : String(err);
    }
    cards.push(card);
  }
  return { ...section, cards };
}

// Rendered html per `${path}:${mtime}` — unchanged emails aren't re-rendered
// on every --serve refresh.
const htmlCache = new Map();

async function renderAll() {
  const rendered = [];
  for (const section of sections) {
    rendered.push(await renderSection(section));
  }
  return rendered;
}

const escapeAttr = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const escapeText = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function cardHtml(card) {
  const body = card.error
    ? `<div class="error">failed to render: ${escapeText(card.error)}</div>`
    : `<iframe title="${escapeAttr(card.name)}" srcdoc="${escapeAttr(card.html)}" loading="lazy"></iframe>`;
  return `
      <article class="card" id="${card.anchor}">
        <header><a href="#${card.anchor}">${escapeText(card.name)}</a></header>
        ${body}
      </article>`;
}

function pageHtml(rendered, subtitle) {
  const total = rendered.flatMap((s) => s.cards).length;
  const nav = rendered
    .map(
      (s) => `
      <nav>
        <h2>${escapeText(s.title)} <span>${s.cards.length}</span></h2>
        ${s.cards
          .map(
            (c) =>
              `<a class="${c.error ? "chip broken" : "chip"}" href="#${c.anchor}">${escapeText(c.name)}</a>`
          )
          .join("\n        ")}
      </nav>`
    )
    .join("\n");
  const body = rendered
    .map(
      (s) => `
    <section>
      <h2>${escapeText(s.title)}</h2>
      <div class="grid">${s.cards.map(cardHtml).join("\n")}</div>
    </section>`
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Carbon email gallery (${total})</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; background: #f4f4f5; color: #18181b; }
  .top { position: sticky; top: 0; z-index: 1; background: #ffffffeb; backdrop-filter: blur(6px); border-bottom: 1px solid #e4e4e7; padding: 12px 24px; }
  .top h1 { margin: 0 0 4px; font-size: 16px; }
  .top p { margin: 0; font-size: 12px; color: #71717a; }
  nav { padding: 6px 0 2px; }
  nav h2 { display: inline; font-size: 12px; color: #52525b; margin-right: 8px; }
  nav h2 span { color: #a1a1aa; font-weight: 400; }
  .chip { display: inline-block; font-size: 11px; color: #3f3f46; background: #f4f4f5; border: 1px solid #e4e4e7; border-radius: 999px; padding: 2px 8px; margin: 2px 2px; text-decoration: none; }
  .chip:hover { background: #e4e4e7; }
  .chip.broken { color: #b91c1c; border-color: #fecaca; background: #fef2f2; }
  section { padding: 8px 24px 24px; }
  section > h2 { font-size: 14px; color: #52525b; margin: 24px 0 12px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(640px, 1fr)); gap: 20px; }
  .card { background: #fff; border: 1px solid #e4e4e7; border-radius: 10px; overflow: hidden; scroll-margin-top: 140px; }
  .card header { padding: 8px 12px; border-bottom: 1px solid #e4e4e7; font-size: 13px; font-weight: 600; }
  .card header a { color: inherit; text-decoration: none; }
  .card iframe { display: block; width: 100%; height: 680px; border: 0; background: #fff; }
  .card .error { padding: 16px; font-size: 12px; color: #b91c1c; font-family: ui-monospace, monospace; white-space: pre-wrap; }
</style>
</head>
<body>
  <div class="top">
    <h1>Carbon email gallery</h1>
    <p>${total} emails · ${subtitle} · ERP_URL: ${escapeText(process.env.ERP_URL || "(not set — asset URLs will be broken)")}</p>
    ${nav}
  </div>
${body}
</body>
</html>
`;
}

if (process.argv.includes("--serve")) {
  const port = Number(process.env.EMAIL_DEV_PORT || 3030);
  const server = createServer(async (_req, res) => {
    try {
      const html = pageHtml(
        await renderAll(),
        "live — refresh to re-render edited templates"
      );
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
    } catch (err) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end(err instanceof Error ? (err.stack ?? err.message) : String(err));
    }
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`
  Email gallery (serve)
  ➜ URL:      http://localhost:${port}
  ➜ ERP_URL:  ${process.env.ERP_URL || "(not set — asset URLs will be broken)"}
`);
  });
} else {
  const rendered = await renderAll();
  const outDir = resolve(scriptDir, "../.email-gallery");
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, "index.html");
  writeFileSync(
    outFile,
    pageHtml(
      rendered,
      "generated by <code>pnpm --filter @carbon/documents email:gallery</code>"
    )
  );

  const cards = rendered.flatMap((s) => s.cards);
  const failed = cards.filter((c) => c.error);
  console.log(`
  Email gallery
  ➜ Rendered:  ${cards.length - failed.length}/${cards.length} emails
  ➜ Output:    ${outFile}
`);
  for (const c of failed) console.error(`  ✗ ${c.name}: ${c.error}`);

  // Best-effort open in the default browser; skip in CI/agents (--no-open or
  // no TTY).
  if (!process.argv.includes("--no-open") && process.stdout.isTTY) {
    const opener = process.platform === "darwin" ? "open" : "xdg-open";
    spawnSync(opener, [outFile], { stdio: "ignore" });
  }

  process.exit(failed.length === cards.length && cards.length > 0 ? 1 : 0);
}
