// Generates a changelog entry's thumbnail from the entry itself.
//
//   node scripts/generate-changelog-thumbnail.mjs            # every entry
//   node scripts/generate-changelog-thumbnail.mjs <slug>      # one entry
//
// The motif is chosen from the entry's title and tags (MOTIFS below, first match
// wins), so an illustration describes its own entry rather than being hand-drawn.
// Layout detail is varied by a hash of the slug, so two entries sharing a motif do
// not come out identical. Writes public/changelog/<slug>.svg and stamps `image:`
// into the frontmatter if it is missing.
//
// House style, enforced by the changelog-authoring rule: dark, flat, abstract. Solid
// fills only — no gradients, no shadows, no fill-opacity, no text, no logos. Images
// render at ~56% in the feed, so detail is lost and only clutter survives.

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENTRIES = resolve(__dirname, "../content/changelog");
const OUT_DIR = resolve(__dirname, "../public/changelog");

const FIELD = "#09090B", PANEL = "#141518", PANEL2 = "#1B1C20";
const STROKE = "#26272B", FAINT = "#212329", DIM = "#2E3036", MID = "#43454D";
const ACCENT = "#00B0FF", ACC_BG = "#0B3C50";
const GREEN = "#3FB950", AMBER = "#D29922", RED = "#A3423C";

/* ── primitives ─────────────────────────────────────────────────────────── */
const panel = (x, y, w, h, r = 16, fill = PANEL, stroke = STROKE) =>
  `  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
const bar = (x, y, w, fill = DIM, h = 10, r = 5) =>
  `  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"/>`;
const dot = (cx, cy, r, fill) => `  <circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;
const ring = (cx, cy, r, stroke) =>
  `  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${stroke}" stroke-width="1.5"/>`;
const sq = (x, y, s, fill, r = 3) =>
  `  <rect x="${x}" y="${y}" width="${s}" height="${s}" rx="${r}" fill="${fill}"/>`;
const hr = (x, y, w, c = FAINT) => `  <path d="M${x} ${y} H${x + w}" stroke="${c}" stroke-width="1.5"/>`;
const vr = (x, y, h, c = FAINT) => `  <path d="M${x} ${y} V${y + h}" stroke="${c}" stroke-width="1.5"/>`;
const chrome = (x, y, w) =>
  [hr(x, y + 46, w, STROKE), ...[0, 1, 2].map((i) => dot(x + 28 + i * 18, y + 23, 4, DIM))].join("\n");
const arrow = (x1, x2, y) =>
  `  <path d="M${x1} ${y} H${x2}" stroke="${MID}" stroke-width="1.5" stroke-dasharray="5 7"/>\n` +
  `  <path d="M${x2 - 9} ${y - 6} l9 6 -9 6" stroke="${MID}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;

/** Deterministic pseudo-random from the slug, so a rebuild is byte-identical. */
function seeded(slug) {
  let h = 2166136261;
  for (const ch of slug) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (n) => { h = Math.imul(h ^ (h >>> 15), 2246822507); return Math.abs(h) % n; };
}
const pick = (rnd, lo, hi) => lo + rnd(hi - lo + 1);

/* ── motifs ─────────────────────────────────────────────────────────────── */
const M = {
  ledger: (r) => {
    const rows = [0, 1, 2, 3].map((i) =>
      [dot(206, 349 + i * 48, 4, i === 0 ? ACCENT : i === 1 ? GREEN : MID),
       bar(224, 344 + i * 48, pick(r, 130, 200), i === 0 ? ACCENT : DIM, 9, 4),
       bar(420, 344 + i * 48, pick(r, 60, 90), DIM, 9, 4),
       bar(534, 344 + i * 48, pick(r, 42, 60), i === 0 ? MID : DIM, 9, 4)].join("\n"));
    return [panel(172, 268, 468, 278), chrome(172, 268, 468),
      bar(206, 322, 54, MID, 8, 4), bar(420, 322, 44, MID, 8, 4), bar(534, 322, 38, MID, 8, 4),
      hr(172, 338, 468), vr(404, 338, 190), vr(518, 338, 190), ...rows, hr(172, 506, 468),
      dot(206, 530, 4, FAINT), bar(224, 525, 132, FAINT, 9, 4), bar(420, 525, 56, FAINT, 9, 4),
      panel(606, 152, 404, 226, 20, PANEL2, ACCENT),
      `  <rect x="606" y="208" width="404" height="30" fill="${ACC_BG}"/>`,
      sq(634, 172, 14, ACC_BG), bar(656, 175, 74, MID, 8, 4),
      bar(634, 268, 120, ACCENT, 12, 6), bar(634, 302, 190, DIM),
      dot(954, 308, 17, "#22262C"), dot(922, 308, 17, ACC_BG)].join("\n");
  },

  gantt: (r) => {
    const lanes = [0, 1, 2, 3, 4, 5].map((i) => {
      const hot = i === 2, x = pick(r, 40, 330), w = pick(r, 130, 250);
      return [dot(206, 268 + i * 48, 4, hot ? ACCENT : MID),
        bar(224, 263 + i * 48, pick(r, 62, 92), hot ? MID : DIM, 9, 4),
        `  <rect x="${400 + x}" y="${258 + i * 48}" width="${w}" height="26" rx="7" fill="${hot ? ACCENT : "#20232A"}" stroke="${hot ? ACCENT : STROKE}" stroke-width="1.5"/>`].join("\n");
    });
    return [panel(170, 146, 860, 400), chrome(170, 146, 860),
      ...[0,1,2,3,4,5].map((i) => bar(404 + i * 126, 214, 22, MID, 8, 4)),
      hr(170, 232, 860), vr(384, 232, 296, STROKE),
      ...[0,1,2,3,4,5].map((i) => vr(400 + i * 126, 232, 296)), ...lanes,
      `  <path d="M574 232 V528" stroke="${ACCENT}" stroke-width="1.5" stroke-dasharray="4 6"/>`,
      dot(574, 232, 5, ACCENT), hr(170, 522, 860)].join("\n");
  },

  merge: (r) => {
    const jobs = [0, 1, 2].map((i) => {
      const y = 206 + i * 100;
      return [panel(200, y, 244, 78, 12), sq(224, y + 22, 12, i === 2 ? GREEN : AMBER),
        bar(246, y + 24, pick(r, 74, 100), MID, 9, 4), bar(224, y + 50, pick(r, 140, 180), DIM, 8, 4),
        arrow(468, 596, y + 39)].join("\n");
    });
    return [...jobs, panel(620, 182, 344, 312, 16, PANEL, ACCENT), chrome(620, 182, 344),
      bar(652, 258, 60, ACC_BG, 20, 8), bar(660, 263, 44, ACCENT, 10, 5),
      bar(652, 300, 224, DIM), bar(652, 332, 178, DIM), hr(620, 360),
      ...[0,1,2].map((i) => [dot(666, 392 + i * 32, 4, i < 2 ? GREEN : MID),
        bar(686, 387 + i * 32, pick(r, 140, 200), DIM, 9, 4)].join("\n")),
      hr(620, 446, 344), dot(666, 478, 4, FAINT), bar(686, 473, 156, FAINT, 9, 4),
      bar(652, 466, 110, ACC_BG, 18, 7)].join("\n");
  },

  flow: (r) => {
    const node = (x, y, w, h, accent = false) =>
      [panel(x, y, w, h, 12, PANEL, accent ? ACCENT : STROKE),
       sq(x + 20, y + 20, 14, accent ? ACC_BG : FAINT),
       bar(x + 42, y + 23, w - 116, accent ? ACCENT : MID, 9, 4),
       bar(x + 20, y + 52, w - 56, DIM, 8, 4),
       bar(x + 20, y + 70, w - 100, FAINT, 7, 3)].join("\n");
    return [node(160, 272, 232, 104, true),
      `  <path d="M392 324 H452 Q472 324 472 304 V206 Q472 186 492 186 H556" stroke="${MID}" stroke-width="1.5"/>`,
      `  <path d="M392 324 H556" stroke="${MID}" stroke-width="1.5"/>`,
      `  <path d="M392 324 H452 Q472 324 472 344 V442 Q472 462 492 462 H556" stroke="${MID}" stroke-width="1.5"/>`,
      dot(392, 324, 5, ACCENT), ...[186, 324, 462].map((y) => dot(556, y, 3.5, MID)),
      node(556, 134, 252, 104), node(556, 272, 252, 104), node(556, 410, 252, 104),
      `  <path d="M808 186 H872" stroke="${MID}" stroke-width="1.5"/>`,
      `  <path d="M808 462 H872" stroke="${MID}" stroke-width="1.5"/>`,
      ...[186, 462].map((y) => dot(872, y, 3.5, MID)),
      node(872, 134, 182, 104), node(872, 410, 182, 104)].join("\n");
  },

  conversation: (r) => [panel(230, 128, 740, 420, 20), chrome(230, 128, 740),
    sq(266, 206, 20, FAINT, 5), bar(294, 212, 96, MID, 9, 4),
    panel(266, 242, 392, 84, 14, PANEL2, STROKE),
    bar(294, 266, pick(r, 230, 280), MID), bar(294, 292, pick(r, 160, 200), DIM, 8, 4),
    `  <rect x="266" y="352" width="668" height="76" rx="14" fill="${ACC_BG}" stroke="${ACCENT}" stroke-width="1.5"/>`,
    sq(294, 372, 16, "#0F4E66", 4), bar(318, 376, 196, ACCENT, 11, 5), bar(318, 400, 286, MID, 9, 4),
    dot(898, 390, 15, "#123322"),
    `  <path d="M891 390 l5 5 10 -11" stroke="${GREEN}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
    panel(430, 446, 504, 62, 14, PANEL2, STROKE), bar(458, 468, 360, MID), bar(458, 488, 258, DIM, 8, 4),
    bar(266, 528, 150, FAINT, 11, 5), bar(430, 528, 96, FAINT, 11, 5)].join("\n"),

  diff: (r) => {
    const kinds = ["same", "del", "add", "same", "add", "same"];
    return [panel(190, 160, 820, 396), chrome(190, 160, 820), vr(600, 206, 336, STROKE),
      ...kinds.map((_, i) => bar(228, 250 + i * 46, pick(r, 145, 215), DIM, 9, 4)),
      ...kinds.map((k, i) => {
        const c = k === "add" ? GREEN : k === "del" ? RED : DIM;
        return [`  <rect x="636" y="${250 + i * 46}" width="${pick(r, 140, 205)}" height="9" rx="4" fill="${c}"/>`,
                sq(614, 248 + i * 46, 12, k === "same" ? FAINT : c, 3)].join("\n");
      })].join("\n");
  },

  calendar: (r) => {
    const cells = [];
    for (let row = 0; row < 4; row++) for (let c = 0; c < 5; c++) {
      const x = 250 + c * 84, y = 266 + row * 62;
      const closed = row < 2 || (row === 2 && c < 3);
      cells.push(`  <rect x="${x}" y="${y}" width="64" height="44" rx="8" fill="${closed ? "#191C22" : PANEL2}" stroke="${STROKE}" stroke-width="1.5"/>`);
      if (row === 2 && c === 3) cells.push(sq(x + 22, y + 15, 16, ACCENT, 4));
      else if (closed) cells.push(dot(x + 32, y + 22, 4, MID));
    }
    return [panel(206, 178, 494, 388), chrome(206, 178, 494), ...cells,
      panel(750, 246, 280, 252, 16, PANEL, ACCENT),
      bar(780, 286, 124, ACCENT, 12, 6), hr(750, 318, 280, STROKE),
      ...[0,1,2,3].map((i) => [dot(796, 352 + i * 34, 4, i < 3 ? GREEN : MID),
        bar(816, 347 + i * 34, pick(r, 115, 165), DIM, 9, 4)].join("\n"))].join("\n");
  },

  checklist: (r) => [panel(190, 166, 470, 392), chrome(190, 166, 470),
    ...[0,1,2,3,4].map((i) => [
      `  <rect x="224" y="${242 + i * 58}" width="20" height="20" rx="5" fill="${i < 2 ? ACC_BG : "none"}" stroke="${i < 2 ? ACCENT : MID}" stroke-width="1.5"/>`,
      bar(260, 246 + i * 58, pick(r, 140, 220), i < 2 ? MID : DIM, 9, 4),
      bar(548, 246 + i * 58, pick(r, 46, 72), DIM, 9, 4)].join("\n")),
    `  <path d="M712 300 H772 M712 420 H772" stroke="${MID}" stroke-width="1.5" stroke-dasharray="5 7"/>`,
    panel(790, 246, 240, 108, 14, PANEL2, STROKE), bar(818, 278, 110, MID), bar(818, 306, 164, DIM, 8, 4),
    panel(790, 386, 240, 108, 14, PANEL, ACCENT), bar(818, 418, 96, ACCENT, 12, 6), bar(818, 448, 152, DIM, 8, 4)].join("\n"),

  balloons: (r) => {
    const pts = [[430, 260], [560, 214], [690, 286], [612, 378], [486, 392]];
    return [panel(330, 152, 540, 400, 18), chrome(330, 152, 540),
      `  <rect x="404" y="240" width="392" height="240" rx="14" fill="${PANEL2}" stroke="${STROKE}" stroke-width="1.5"/>`,
      ...pts.flatMap(([cx, cy], i) => [ring(cx, cy, 17, i === 0 ? ACCENT : MID), dot(cx, cy, 5, i === 0 ? ACCENT : MID)]),
      panel(900, 236, 160, 232, 14, PANEL2, STROKE),
      ...[0,1,2,3,4].map((i) => [dot(926, 278 + i * 34, 4, i === 0 ? ACCENT : MID),
        bar(944, 273 + i * 34, pick(r, 58, 92), DIM, 9, 4)].join("\n"))].join("\n");
  },

  stack: (r) => [panel(300, 196, 330, 420, 18, PANEL2, STROKE), panel(360, 166, 330, 420, 18, PANEL2, STROKE),
    panel(420, 136, 330, 420, 18, PANEL, ACCENT), bar(456, 186, 150, ACCENT, 14, 7), hr(420, 220, 330, STROKE),
    ...[0,1,2,3,4].map((i) => bar(456, 250 + i * 34, pick(r, 160, 240), DIM, 9, 4)),
    hr(420, 432, 330), ...[0,1].map((i) => [dot(470, 462 + i * 30, 4, MID), bar(490, 457 + i * 30, pick(r, 130, 175), FAINT, 9, 4)].join("\n")),
    panel(800, 236, 250, 220, 14, PANEL2, STROKE), bar(828, 270, 96, MID), bar(828, 298, 152, DIM, 8, 4),
    ...[0,1,2].map((i) => bar(828, 334 + i * 30, pick(r, 96, 140), FAINT, 8, 4))].join("\n"),

  branch: (r) => [panel(170, 152, 480, 180, 16), chrome(170, 152, 480),
    ...[0,1].map((i) => [bar(204, 224 + i * 34, pick(r, 128, 175), DIM, 9, 4), bar(520, 224 + i * 34, pick(r, 54, 78), MID, 9, 4)].join("\n")),
    panel(170, 362, 480, 180, 16), chrome(170, 362, 480),
    ...[0,1].map((i) => [bar(204, 434 + i * 34, pick(r, 140, 185), DIM, 9, 4), bar(520, 434 + i * 34, pick(r, 60, 84), MID, 9, 4)].join("\n")),
    `  <path d="M650 242 H716 Q740 242 740 266 V410 Q740 434 716 434 H650" stroke="${MID}" stroke-width="1.5"/>`,
    dot(650, 242, 5, MID), dot(650, 434, 5, MID),
    panel(760, 266, 270, 144, 16, PANEL, ACCENT),
    bar(790, 300, 120, ACCENT, 12, 6), bar(790, 332, 196, DIM), bar(790, 360, 150, DIM)].join("\n"),

  grid: (r) => {
    const cells = [];
    for (let row = 0; row < 3; row++) for (let c = 0; c < 4; c++) {
      const x = 250 + c * 168, y = 232 + row * 104, hot = row === 1 && c === 1;
      cells.push([panel(x, y, 144, 80, 12, PANEL2, hot ? ACCENT : STROKE),
        bar(x + 20, y + 22, pick(r, 56, 88), hot ? ACCENT : MID, 9, 4),
        bar(x + 20, y + 46, pick(r, 86, 112), hot ? ACC_BG : FAINT, 8, 4)].join("\n"));
    }
    return [panel(206, 168, 788, 388), chrome(206, 168, 788), ...cells].join("\n");
  },

  rings: (r) => [panel(390, 158, 420, 360, 20), chrome(390, 158, 420),
    ...[34, 62, 90].map((rad) => ring(600, 300, rad, rad === 34 ? ACCENT : STROKE)),
    dot(600, 300, 10, ACCENT), bar(444, 404, 312, DIM), bar(444, 436, 236, DIM),
    `  <rect x="444" y="470" width="312" height="30" rx="8" fill="${ACC_BG}"/>`, bar(460, 478, 120, ACCENT, 14, 7),
    panel(160, 236, 190, 204, 14, PANEL2, STROKE), bar(186, 270, 94, MID), bar(186, 298, 130, DIM, 8, 4),
    ...[0,1,2].map((i) => bar(186, 334 + i * 28, pick(r, 86, 126), FAINT, 8, 4)),
    panel(850, 236, 190, 204, 14, PANEL2, STROKE), bar(876, 270, 82, MID), bar(876, 298, 126, DIM, 8, 4),
    ...[0,1,2].map((i) => bar(876, 334 + i * 28, pick(r, 90, 124), FAINT, 8, 4))].join("\n"),

  dashboard: (r) => [panel(150, 180, 470, 316), chrome(150, 180, 470),
    bar(184, 268, 150, ACCENT, 16, 8), bar(184, 306, 224, DIM), bar(184, 338, 178, DIM), hr(150, 374, 470),
    ...[0,1,2].map((i) => [dot(198, 410 + i * 30, 4, i < 2 ? GREEN : AMBER),
      bar(218, 405 + i * 30, pick(r, 140, 200), DIM, 9, 4)].join("\n")),
    panel(660, 180, 392, 316),
    ...[0,1,2].flatMap((row) => [panel(688, 214 + row * 100, 168, 80, 12, PANEL2, STROKE),
      panel(872, 214 + row * 100, 152, 80, 12, PANEL2, STROKE),
      bar(708, 238 + row * 100, pick(r, 48, 76), row === 0 ? ACCENT : MID, 14, 7),
      bar(708, 264 + row * 100, pick(r, 90, 112), DIM, 8, 4),
      bar(892, 238 + row * 100, pick(r, 46, 62), MID, 14, 7),
      bar(892, 264 + row * 100, pick(r, 82, 100), DIM, 8, 4)])].join("\n"),
};

/* A motif is chosen by WHERE its keywords appear in the title, not by a fixed
 * priority order: changelog titles lead with the headline feature, so the earliest
 * match is the entry's real subject. "Ramp card transactions, batch materials, …"
 * is a ledger entry, not a batching one. Tags are a fallback only. */
const MOTIFS = [
  ["dashboard", /dashboard|time clock|timecard|report/i],
  ["gantt", /schedul|capacity|gantt/i],
  ["merge", /batching|batch |merge|consolidat/i],
  ["flow", /workflow|automation|trigger/i],
  ["conversation", /agent|assistant|chat/i],
  ["diff", /change notice|revision|diff|supersession|engineering change/i],
  ["calendar", /period clos|closing|month-end|backup/i],
  ["checklist", /picking|pick list|inspection|label|inventory count|checklist/i],
  ["stack", /document|pdf|asset|template/i],
  ["branch", /multi-entity|intercompany|storage rule/i],
  ["grid", /storage unit|inventory|bin|shelf|warehouse/i],
  ["rings", /passkey|sign-in|sso|two-factor|mcp|console|api\b|security/i],
  ["ledger", /accounting|ledger|invoice|payment|card transaction|journal|budget|valuation/i],
  ["balloons", /balloon/i],
];

/** Earliest keyword position in the title wins; tags only break a total miss. */
export function motifFor(title, tags = []) {
  let best = null;
  for (const [name, re] of MOTIFS) {
    const at = title.search(re);
    if (at !== -1 && (best === null || at < best.at)) best = { name, at };
  }
  if (best) return best.name;
  const hay = tags.join(" ");
  for (const [name, re] of MOTIFS) if (re.test(hay)) return name;
  return "grid";
}

export function renderThumbnail({ slug, title, tags }) {
  const motif = motifFor(title, tags);
  const body = M[motif](seeded(slug));
  return {
    motif,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675" fill="none">\n` +
         `  <rect width="1200" height="675" fill="${FIELD}"/>\n${body}\n</svg>\n`,
  };
}

/* ── CLI ────────────────────────────────────────────────────────────────── */
function frontmatter(raw) {
  const block = raw.split("---")[1] ?? "";
  const get = (k) => (block.match(new RegExp(`^${k}:\\s*(.*)$`, "m"))?.[1] ?? "").trim();
  const strip = (v) => v.replace(/^["']|["']$/g, "");
  return {
    title: strip(get("title")),
    tags: (get("tags").match(/"[^"]*"/g) ?? []).map((t) => t.slice(1, -1)),
    hasImage: /^image:/m.test(block),
  };
}

const only = process.argv[2];
mkdirSync(OUT_DIR, { recursive: true });
let n = 0;
for (const file of readdirSync(ENTRIES).filter((f) => f.endsWith(".mdx")).sort()) {
  const slug = basename(file, ".mdx");
  if (only && slug !== only) continue;
  const path = resolve(ENTRIES, file);
  const raw = readFileSync(path, "utf8");
  const { title, tags, hasImage } = frontmatter(raw);
  const { motif, svg } = renderThumbnail({ slug, title, tags });
  writeFileSync(resolve(OUT_DIR, `${slug}.svg`), svg);
  if (!hasImage) {
    writeFileSync(path, raw.replace(/^(tags:.*)$/m, `$1\nimage: "/changelog/${slug}.svg"`));
  }
  console.log(`${motif.padEnd(13)} ${slug}`);
  n++;
}
if (n === 0) { console.error(only ? `no entry "${only}"` : "no entries"); process.exit(1); }
