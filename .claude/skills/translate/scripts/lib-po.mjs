// Shared .po parsing helpers for the /translate skill.
// A .po entry is: optional comment lines (#...), a msgid (one or more quoted
// lines), then a msgstr (one or more quoted lines). Values are the quoted
// segments concatenated, with PO escape sequences decoded.

const UNESCAPE = { '"': '"', "\\": "\\", n: "\n", t: "\t", r: "\r" };

export function unescapePo(s) {
  return s.replace(/\\(["\\ntr])/g, (_m, c) => UNESCAPE[c]);
}

export function escapePo(s) {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
    .replace(/\r/g, "\\r");
}

function stripQuotes(q) {
  const m = q.match(/^"([\s\S]*)"$/);
  return m ? m[1] : "";
}

// Parse into { lines, entries }. Each entry: { comments[], msgid, msgstr,
// msgstrLineIndex, msgstrLineCount }. Line indices point into `lines` so a
// caller can rewrite a msgstr in place and re-join.
export function parsePo(text) {
  const lines = text.split("\n");
  const entries = [];
  let i = 0;
  while (i < lines.length) {
    const comments = [];
    while (i < lines.length && lines[i].startsWith("#")) comments.push(lines[i++]);
    if (i >= lines.length) break;
    if (!lines[i].startsWith("msgid ")) {
      i++;
      continue;
    }
    const msgidQ = [lines[i].slice("msgid ".length)];
    i++;
    while (i < lines.length && lines[i].startsWith('"')) msgidQ.push(lines[i++]);
    if (i >= lines.length || !lines[i].startsWith("msgstr ")) continue;
    const msgstrLineIndex = i;
    const msgstrQ = [lines[i].slice("msgstr ".length)];
    i++;
    while (i < lines.length && lines[i].startsWith('"')) msgstrQ.push(lines[i++]);
    entries.push({
      comments,
      msgid: msgidQ.map((q) => unescapePo(stripQuotes(q))).join(""),
      msgstr: msgstrQ.map((q) => unescapePo(stripQuotes(q))).join(""),
      msgstrLineIndex,
      msgstrLineCount: msgstrQ.length,
    });
  }
  return { lines, entries };
}

// supportedLanguages + languageNativeLabels parsed straight from the source of
// truth so the skill never drifts from the runtime locale list.
export function readLocaleConfig(configPath, readFileSync) {
  const src = readFileSync(configPath, "utf8");
  const listMatch = src.match(/supportedLanguages\s*=\s*\[([\s\S]*?)\]/);
  const codes = [...listMatch[1].matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
  const labelBlock = src.match(/languageNativeLabels[^{]*\{([\s\S]*?)\}/)[1];
  const labels = {};
  for (const m of labelBlock.matchAll(/(\w+)\s*:\s*"([^"]+)"/g)) labels[m[1]] = m[2];
  return { codes, labels };
}
