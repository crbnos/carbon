#!/usr/bin/env node
// Step 1 of /translate. Scans every committed .po catalog for empty msgstr
// entries and writes deterministic, chunked translation jobs for cheap-model
// subagents to fill.
//
// Outputs (all under .ai/scratch/translate/, gitignored):
//   in/{n}.json        one chunk of msgids to translate (subagent INPUT)
//   manifest.json      list of {in,out,locale,catalog,langLabel,count}
//   (subagents write out/{n}.json — this script only creates in/ + manifest)
//
// Locale scope: supportedLanguages from packages/locale/src/config.ts, minus
// the source locale "en". Orphaned locales on disk (e.g. nl) are excluded
// because they're not in supportedLanguages.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { parsePo, readLocaleConfig } from "./lib-po.mjs";

const REPO = process.cwd();
const CONFIG = `${REPO}/packages/locale/src/config.ts`;
const LOCALES_DIR = `${REPO}/packages/locale/locales`;
const OUT_DIR = `${REPO}/.ai/scratch/translate`;
const CATALOGS = ["erp", "mes"];
const CHUNK_SIZE = Number(process.env.TRANSLATE_CHUNK_SIZE || 40);

const { codes, labels } = readLocaleConfig(CONFIG, readFileSync);
const targets = codes.filter((c) => c !== "en");

// Fresh scratch each run so stale chunks never merge.
rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(`${OUT_DIR}/in`, { recursive: true });
mkdirSync(`${OUT_DIR}/out`, { recursive: true });

const manifest = [];
let chunkNo = 0;
let totalMissing = 0;

for (const locale of targets) {
  const langLabel = labels[locale] || locale;
  for (const catalog of CATALOGS) {
    const po = `${LOCALES_DIR}/${locale}/${catalog}.po`;
    if (!existsSync(po)) continue;
    const { entries } = parsePo(readFileSync(po, "utf8"));
    const missing = entries.filter((e) => e.msgid !== "" && e.msgstr === "");
    if (missing.length === 0) continue;
    totalMissing += missing.length;
    for (let i = 0; i < missing.length; i += CHUNK_SIZE) {
      const slice = missing.slice(i, i + CHUNK_SIZE);
      const inPath = `${OUT_DIR}/in/${chunkNo}.json`;
      const outPath = `${OUT_DIR}/out/${chunkNo}.json`;
      writeFileSync(
        inPath,
        JSON.stringify(
          {
            locale,
            langLabel,
            catalog,
            items: slice.map((e) => ({
              msgid: e.msgid,
              // translator notes (#. lines) carry placeholder context
              note: e.comments.filter((c) => c.startsWith("#.")).join(" ").trim() || undefined,
            })),
          },
          null,
          2,
        ),
      );
      manifest.push({ chunk: chunkNo, in: inPath, out: outPath, locale, catalog, langLabel, count: slice.length });
      chunkNo++;
    }
  }
}

writeFileSync(`${OUT_DIR}/manifest.json`, JSON.stringify(manifest, null, 2));

const byLocale = {};
for (const m of manifest) byLocale[m.locale] = (byLocale[m.locale] || 0) + m.count;
console.log(`Missing translations: ${totalMissing} across ${targets.length} locales`);
console.log(`Chunks: ${manifest.length} (size ${CHUNK_SIZE}) → ${OUT_DIR}/manifest.json`);
for (const [loc, n] of Object.entries(byLocale)) console.log(`  ${loc}: ${n}`);
if (totalMissing === 0) console.log("NOTHING_TO_TRANSLATE");
