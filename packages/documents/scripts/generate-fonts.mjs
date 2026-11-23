// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Generates src/pdf/fonts.data.ts — the editor's body fonts as base64 woff data
// URIs from @fontsource/* (OFL/Apache), registered in-process with no network at
// render. Runs on the root postinstall + turbo build task; gitignored output.
//
// woff, NOT woff2: react-pdf preloads every registered font, and its fontkit's
// woff2/brotli decoder corrupts shared state across many decodes → DataView range
// errors at embed. woff (zlib) is stateless.
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "src", "pdf", "fonts.data.ts");

// Mirrors the bundled fonts in DOCUMENT_FONTS (template/schema.ts). Fontsource
// splits each face by unicode range, and react-pdf has no unicode-range, so each
// subset is registered as its own family: "Inter" holds "latin" (Western European)
// and "Inter Latin Ext" holds "latin-ext" (Central European: ś, ł, ő, č…). fonts.ts
// stacks them, and react-pdf picks per glyph. Without latin-ext a Polish city like
// "Przemyśl" printed as "Przemy[".
//
// Both subsets of a face carry the same PostScript name, and pdfkit reuses an
// embedded font by that name, so a Latin Ext glyph id was drawn from the latin
// subset (wrong letters). `psSuffix` renames the Latin Ext face (renamePostScript).
const SUBSETS = [
  { subset: "latin", suffix: "", psSuffix: "" },
  { subset: "latin-ext", suffix: " Latin Ext", psSuffix: "-LatinExt" },
];
const FAMILIES = [
  { family: "Inter", pkg: "@fontsource/inter", weights: [300, 400, 500, 700, 900] },
  { family: "Roboto", pkg: "@fontsource/roboto", weights: [400, 700] },
  { family: "Open Sans", pkg: "@fontsource/open-sans", weights: [400, 700] },
  { family: "Lato", pkg: "@fontsource/lato", weights: [400, 700] },
  { family: "Montserrat", pkg: "@fontsource/montserrat", weights: [400, 700] },
  { family: "Merriweather", pkg: "@fontsource/merriweather", weights: [400, 700] },
  { family: "Playfair Display", pkg: "@fontsource/playfair-display", weights: [400, 700] },
  { family: "Lora", pkg: "@fontsource/lora", weights: [400, 700] },
];

function filesDir(pkg) {
  // Probe install dirs via fs (which ignores the package's "exports" map, unlike
  // require.resolve), then fall back to require.
  const candidates = [
    join(here, "..", "node_modules", pkg, "files"),
    join(here, "..", "..", "..", "node_modules", pkg, "files"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  const pkgJson = require.resolve(`${pkg}/package.json`);
  return join(dirname(pkgJson), "files");
}

function findWoff(dir, id, subset, weight) {
  const exact = join(dir, `${id}-${subset}-${weight}-normal.woff`);
  return existsSync(exact) ? exact : null;
}

const align4 = (n) => (n + 3) & ~3;

function sfntChecksum(buf) {
  const padded = Buffer.alloc(align4(buf.length));
  buf.copy(padded);
  let sum = 0;
  for (let i = 0; i < padded.length; i += 4) sum = (sum + padded.readUInt32BE(i)) >>> 0;
  return sum;
}

// Appends `suffix` to every PostScript name record (nameID 6) of an sfnt `name`
// table. The new strings go at the end of the string storage and the records are
// repointed, so no other offset moves.
function renameNameTable(table, suffix) {
  const count = table.readUInt16BE(2);
  const storage = table.readUInt16BE(4);
  const out = Buffer.from(table);
  const added = [];
  let end = table.length - storage;
  for (let i = 0; i < count; i++) {
    const rec = 6 + i * 12;
    if (out.readUInt16BE(rec + 6) !== 6) continue;
    const platform = out.readUInt16BE(rec);
    const length = out.readUInt16BE(rec + 8);
    const offset = storage + out.readUInt16BE(rec + 10);
    const old = table.subarray(offset, offset + length);
    // Windows/Unicode names are UTF-16BE; Macintosh names are one byte per char.
    const name =
      platform === 1 ? Buffer.from(old.toString("latin1") + suffix, "latin1") : utf16be(utf16beString(old) + suffix);
    out.writeUInt16BE(name.length, rec + 8);
    out.writeUInt16BE(end, rec + 10);
    added.push(name);
    end += name.length;
  }
  if (!added.length) throw new Error("font has no PostScript name to rename");
  return Buffer.concat([out, ...added]);
}

function utf16beString(buf) {
  let s = "";
  for (let i = 0; i + 1 < buf.length; i += 2) s += String.fromCharCode(buf.readUInt16BE(i));
  return s;
}

function utf16be(s) {
  const buf = Buffer.alloc(s.length * 2);
  for (let i = 0; i < s.length; i++) buf.writeUInt16BE(s.charCodeAt(i), i * 2);
  return buf;
}

// Rewrites a WOFF 1.0 file with its PostScript name suffixed. Every table is kept
// byte for byte except `name`; metadata and private blocks are dropped.
function renamePostScript(woff, suffix) {
  if (woff.toString("latin1", 0, 4) !== "wOFF") throw new Error("not a WOFF 1.0 file");
  const numTables = woff.readUInt16BE(12);
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const dir = 44 + i * 20;
    const tag = woff.toString("latin1", dir, dir + 4);
    const offset = woff.readUInt32BE(dir + 4);
    const compLength = woff.readUInt32BE(dir + 8);
    const origLength = woff.readUInt32BE(dir + 12);
    let data = woff.subarray(offset, offset + compLength);
    let checksum = woff.readUInt32BE(dir + 16);
    if (tag === "name") {
      const raw = compLength < origLength ? inflateSync(data) : data;
      const renamed = renameNameTable(raw, suffix);
      checksum = sfntChecksum(renamed);
      const packed = deflateSync(renamed);
      tables.push({ tag, data: packed.length < renamed.length ? packed : renamed, origLength: renamed.length, checksum });
      continue;
    }
    tables.push({ tag, data, origLength, checksum });
  }

  let offset = 44 + numTables * 20;
  let sfntSize = 12 + numTables * 16;
  const placed = tables.map((t) => {
    const at = offset;
    offset += align4(t.data.length);
    sfntSize += align4(t.origLength);
    return { ...t, at };
  });

  const out = Buffer.alloc(offset);
  woff.copy(out, 0, 0, 12); // signature, flavor, (length rewritten below)
  out.writeUInt32BE(offset, 8);
  out.writeUInt16BE(numTables, 12);
  out.writeUInt32BE(sfntSize, 16);
  woff.copy(out, 20, 20, 24); // font version
  placed.forEach((t, i) => {
    const dir = 44 + i * 20;
    out.write(t.tag, dir, "latin1");
    out.writeUInt32BE(t.at, dir + 4);
    out.writeUInt32BE(t.data.length, dir + 8);
    out.writeUInt32BE(t.origLength, dir + 12);
    out.writeUInt32BE(t.checksum, dir + 16);
    t.data.copy(out, t.at);
  });
  return out;
}

const entries = [];
const warnings = [];
let totalBytes = 0;

for (const { family, pkg, weights } of FAMILIES) {
  let dir;
  try {
    dir = filesDir(pkg);
  } catch {
    warnings.push(`MISSING package ${pkg} — run pnpm install. Skipped ${family}.`);
    continue;
  }
  for (const { subset, suffix, psSuffix } of SUBSETS) {
    const fonts = [];
    for (const weight of weights) {
      const file = findWoff(dir, pkg.split("/")[1], subset, weight);
      if (!file) {
        warnings.push(`No woff for ${family} ${weight} (${subset}) in ${dir}`);
        continue;
      }
      const raw = readFileSync(file);
      const buf = psSuffix ? renamePostScript(raw, psSuffix) : raw;
      totalBytes += buf.length;
      fonts.push({ src: `data:font/woff;base64,${buf.toString("base64")}`, fontWeight: weight });
    }
    if (fonts.length) entries.push({ family: `${family}${suffix}`, fonts });
  }
}

const body = entries
  .map(
    (e) =>
      `  {\n    family: ${JSON.stringify(e.family)},\n    fonts: [\n` +
      e.fonts
        .map((f) => `      { fontWeight: ${f.fontWeight}, src: ${JSON.stringify(f.src)} },`)
        .join("\n") +
      `\n    ],\n  },`
  )
  .join("\n");

const out = `// GENERATED by scripts/generate-fonts.mjs — DO NOT EDIT BY HAND.
// Run: pnpm --filter @carbon/documents build
// Document fonts embedded as base64 woff data URIs (decoded in-process by
// react-pdf/fontkit; no network at render).

export type BundledFont = {
  family: string;
  fonts: { fontWeight: number; src: string }[];
};

export const BUNDLED_FONTS: BundledFont[] = [
${body}
];
`;

writeFileSync(OUT, out);

for (const w of warnings) console.warn(`⚠️  ${w}`);
console.log(
  `✓ Wrote ${OUT}\n  ${entries.length} families, ${entries.reduce((n, e) => n + e.fonts.length, 0)} faces, ${(totalBytes / 1024).toFixed(0)} KiB raw woff (~${((totalBytes * 1.34) / 1024).toFixed(0)} KiB base64).`
);
