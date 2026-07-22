#!/usr/bin/env python3
"""Graph lines of code contributed to a branch by author over time.

Mines `git log --numstat`, aggregates authored (non-noise) line changes per
author into monthly buckets, and writes a self-contained interactive HTML chart.

No third-party dependencies — standard library only.

Usage:
    python3 loc_by_author.py [--branch main] [--top 7] [--metric net]
                             [--by email] [--out loc.html] [--open]

Metrics:
    net        cumulative additions - deletions per author over time (default)
    additions  cumulative additions only
    monthly    per-month net (not cumulative) — shows activity, not totals
"""
from __future__ import annotations

import argparse
import fnmatch
import json
import subprocess
import sys
import webbrowser
from collections import defaultdict
from datetime import date
from pathlib import Path

# --- Files that inflate "authored lines" but aren't hand-written code. ---------
DEFAULT_EXCLUDES = [
    "*.lock",
    "*lock.json",
    "*lock.yaml",
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
    "*.min.js",
    "*.min.css",
    "*.map",
    "*.snap",
    "**/generated/**",
    "**/__generated__/**",
    "**/*.generated.*",
    "packages/database/src/types.ts",  # codegen DB types
    "**/dist/**",
    "**/build/**",
    "**/vendor/**",
    "**/node_modules/**",
    "*.svg",
    "*.png",
    "*.jpg",
    "*.jpeg",
    "*.gif",
    "*.ico",
    "*.woff",
    "*.woff2",
    "*.ttf",
    "*.pdf",
]

# --- Automated committers filtered out unless --include-bots. -------------------
# Note: AI coding agents (Carbon Agent, Claude) are treated as real authors —
# their contributions are of interest, not noise. Only pure CI/dependency bots
# are filtered here.
BOT_MARKERS = ["[bot]", "actions@github"]
BOT_NAMES = {"fiber[bot]", "fiber bot", "dependabot[bot]"}


def is_bot(name: str, email: str) -> bool:
    n, e = name.lower(), email.lower()
    if n in BOT_NAMES:
        return True
    return any(m in e or m in n for m in BOT_MARKERS)


def path_excluded(path: str, patterns: list[str]) -> bool:
    return any(fnmatch.fnmatch(path, pat) for pat in patterns)


def month_key(iso_date: str) -> str:
    # iso_date is YYYY-MM-DD
    return iso_date[:7]


def parse_git_log(branch: str, excludes: list[str], include_bots: bool,
                  since: str | None = None, until: str | None = None):
    """Return (per_key_month_net, per_key_month_add, identity, months_sorted).

    per_*: dict[groupkey][month] -> summed value
    identity: dict[groupkey] -> {"name": display, "names": Counter, "email": ...}
    """
    sentinel = "\x01"
    fmt = f"{sentinel}%ad\t%an\t%ae"
    cmd = [
        "git", "log", branch, "--no-merges",
        "--numstat", "--date=short", f"--pretty=format:{fmt}",
    ]
    if since:
        cmd.append(f"--since={since}")
    if until:
        cmd.append(f"--until={until}")
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        sys.exit(f"git log failed:\n{proc.stderr}")

    net = defaultdict(lambda: defaultdict(int))       # key -> month -> net
    add = defaultdict(lambda: defaultdict(int))       # key -> month -> additions
    name_counts = defaultdict(lambda: defaultdict(int))  # key -> name -> count
    email_of = {}
    months = set()

    cur_key = None
    cur_month = None
    for line in proc.stdout.splitlines():
        if line.startswith(sentinel):
            iso, name, email = line[1:].split("\t")
            if not include_bots and is_bot(name, email):
                cur_key = None
                continue
            cur_key = args_group_key(email, name)
            cur_month = month_key(iso)
            months.add(cur_month)
            name_counts[cur_key][name] += 1
            email_of[cur_key] = email.lower()
        else:
            if cur_key is None or not line.strip():
                continue
            parts = line.split("\t")
            if len(parts) != 3:
                continue
            a_str, d_str, path = parts
            if a_str == "-" or d_str == "-":  # binary
                continue
            if path_excluded(path, excludes):
                continue
            a, d = int(a_str), int(d_str)
            net[cur_key][cur_month] += a - d
            add[cur_key][cur_month] += a

    return net, add, name_counts, email_of, sorted(months)


def merge_identities(net, add, name_counts, email_of, aliases, merge_names):
    """Collapse group keys that are the same person.

    Priority: explicit alias mapping > identical display name (if merge_names) >
    the key itself. Returns merged (net, add, identity).
    """
    # token (lowercased email or name) -> canonical display label
    token_to_canon = {}
    for canon, tokens in (aliases or {}).items():
        for t in tokens:
            token_to_canon[t.lower()] = canon

    def canon_of(key):
        # 1. explicit alias by email or any authored name
        if key in token_to_canon:
            return token_to_canon[key]
        for nm in name_counts[key]:
            if nm.lower() in token_to_canon:
                return token_to_canon[nm.lower()]
        # 2. auto-merge by identical most-common display name
        display = max(name_counts[key].items(), key=lambda kv: kv[1])[0]
        if merge_names:
            return "\x00name:" + display.lower()
        return key

    m_net = defaultdict(lambda: defaultdict(int))
    m_add = defaultdict(lambda: defaultdict(int))
    m_names = defaultdict(lambda: defaultdict(int))
    m_email = {}
    for key in net:
        c = canon_of(key)
        for mo, v in net[key].items():
            m_net[c][mo] += v
        for mo, v in add[key].items():
            m_add[c][mo] += v
        for nm, cnt in name_counts[key].items():
            m_names[c][nm] += cnt
        m_email.setdefault(c, email_of.get(key, ""))

    identity = {}
    for c, counts in m_names.items():
        # explicit alias canon is already a display label; otherwise pick most common
        display = c if not c.startswith("\x00name:") and c in {v for v in token_to_canon.values()} \
            else max(counts.items(), key=lambda kv: kv[1])[0]
        identity[c] = {"name": display, "email": m_email.get(c, "")}

    return m_net, m_add, identity


# group-by strategy is set once from CLI; keep it simple via module global
_GROUP_BY = "email"


def args_group_key(email: str, name: str) -> str:
    return email.lower() if _GROUP_BY == "email" else name


def month_range(first: str, last: str) -> list[str]:
    """Inclusive list of YYYY-MM strings from first to last."""
    fy, fm = int(first[:4]), int(first[5:7])
    ly, lm = int(last[:4]), int(last[5:7])
    out = []
    y, m = fy, fm
    while (y, m) <= (ly, lm):
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m > 12:
            m = 1
            y += 1
    return out


def build_series(net, add, identity, months, top, metric):
    if not months:
        sys.exit("No commits matched — nothing to graph.")
    timeline = month_range(months[0], months[-1])

    source = add if metric in ("additions", "monthly-additions") else net

    # Rank authors by total contribution (net or additions).
    totals = {k: sum(source[k].values()) for k in source}
    ranked = sorted(totals, key=lambda k: totals[k], reverse=True)
    top_keys = ranked[:top]
    other_keys = ranked[top:]

    def cumulative(monthly: dict) -> list[float]:
        vals, run = [], 0
        for mo in timeline:
            run += monthly.get(mo, 0)
            vals.append(run)
        return vals

    def per_month(monthly: dict) -> list[float]:
        return [monthly.get(mo, 0) for mo in timeline]

    shape = per_month if metric in ("monthly", "monthly-additions") else cumulative

    series = []
    for k in top_keys:
        series.append({
            "name": identity[k]["name"],
            "email": identity[k]["email"],
            "values": shape(source[k]),
        })

    if other_keys:
        merged = defaultdict(int)
        for k in other_keys:
            for mo, v in source[k].items():
                merged[mo] += v
        series.append({
            "name": f"Other ({len(other_keys)})",
            "email": "",
            "values": shape(merged),
            "isOther": True,
        })

    return timeline, series


# ------------------------------------------------------------------------------
# HTML rendering — dataviz palette, inline SVG built client-side for hover.
# ------------------------------------------------------------------------------
PALETTE_LIGHT = ["#2a78d6", "#1baf7a", "#eda100", "#008300",
                 "#4a3aa7", "#e34948", "#e87ba4", "#eb6834"]
PALETTE_DARK = ["#3987e5", "#199e70", "#c98500", "#008300",
                "#9085e9", "#e66767", "#d55181", "#d95926"]
OTHER_LIGHT = "#898781"
OTHER_DARK = "#898781"

METRIC_LABEL = {
    "net": "Cumulative net lines (additions − deletions)",
    "additions": "Cumulative lines added",
    "monthly": "Net lines changed per month",
    "monthly-additions": "New lines added per month",
}


def render_html(branch, timeline, series, metric, excluded_count_note):
    payload = {
        "branch": branch,
        "timeline": timeline,
        "series": series,
        "metric": metric,
        "metricLabel": METRIC_LABEL[metric],
        "paletteLight": PALETTE_LIGHT,
        "paletteDark": PALETTE_DARK,
        "otherLight": OTHER_LIGHT,
        "otherDark": OTHER_DARK,
        "note": excluded_count_note,
    }
    data_json = json.dumps(payload)
    return HTML_TEMPLATE.replace("__DATA__", data_json)


HTML_TEMPLATE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lines of code by author</title>
<style>
  :root {
    --surface-1: #fcfcfb; --page: #f9f9f7;
    --text-primary: #0b0b0b; --text-secondary: #52514e; --muted: #898781;
    --grid: #e1e0d9; --axis: #c3c2b7; --border: rgba(11,11,11,0.10);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --surface-1: #1a1a19; --page: #0d0d0d;
      --text-primary: #ffffff; --text-secondary: #c3c2b7; --muted: #898781;
      --grid: #2c2c2a; --axis: #383835; --border: rgba(255,255,255,0.10);
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--page); color: var(--text-primary);
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    padding: 32px;
  }
  .wrap { max-width: 1120px; margin: 0 auto; }
  h1 { font-size: 20px; font-weight: 650; margin: 0 0 2px; }
  .sub { color: var(--text-secondary); font-size: 13px; margin: 0 0 4px; }
  .note { color: var(--muted); font-size: 12px; margin: 0 0 18px; }
  .card {
    background: var(--surface-1); border: 1px solid var(--border);
    border-radius: 12px; padding: 20px 20px 12px; position: relative;
  }
  .legend { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 14px 2px 2px; }
  .legend button {
    display: inline-flex; align-items: center; gap: 7px; background: none;
    border: 0; padding: 3px 4px; cursor: pointer; color: var(--text-secondary);
    font-size: 12.5px; font-family: inherit; border-radius: 6px;
  }
  .legend button.off { opacity: 0.32; }
  .legend button:hover { background: var(--grid); }
  .swatch { width: 11px; height: 11px; border-radius: 3px; flex: none; }
  .controls { display: flex; gap: 8px; margin: 0 0 14px; }
  .controls button {
    font: inherit; font-size: 12.5px; color: var(--text-secondary);
    background: var(--surface-1); border: 1px solid var(--border);
    border-radius: 7px; padding: 5px 11px; cursor: pointer;
  }
  .controls button.active { color: var(--text-primary); border-color: var(--axis); font-weight: 600; }
  svg text { fill: var(--muted); }
  .tip {
    position: absolute; pointer-events: none; background: var(--surface-1);
    border: 1px solid var(--border); border-radius: 8px; padding: 9px 11px;
    font-size: 12px; box-shadow: 0 4px 16px rgba(0,0,0,0.14); min-width: 150px;
    opacity: 0; transition: opacity .08s; z-index: 5;
  }
  .tip .tm { color: var(--text-secondary); font-weight: 600; margin-bottom: 6px; }
  .tip .row { display: flex; align-items: center; gap: 7px; margin: 2px 0;
    color: var(--text-primary); white-space: nowrap; }
  .tip .row .v { margin-left: auto; font-variant-numeric: tabular-nums; padding-left: 14px; }
  table { border-collapse: collapse; width: 100%; font-size: 12.5px; margin-top: 8px; }
  th, td { text-align: right; padding: 5px 10px; border-bottom: 1px solid var(--grid);
    font-variant-numeric: tabular-nums; }
  th:first-child, td:first-child { text-align: left; font-variant-numeric: normal; }
  thead th { color: var(--text-secondary); font-weight: 600; position: sticky; top: 0;
    background: var(--surface-1); }
  #tableView { display: none; max-height: 460px; overflow: auto; }
  #tableView.show { display: block; }
  #chartView.hide { display: none; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Lines of code by author</h1>
  <p class="sub" id="subtitle"></p>
  <p class="note" id="note"></p>
  <div class="controls">
    <button id="btnChart" class="active">Chart</button>
    <button id="btnTable">Table</button>
  </div>
  <div class="card">
    <div id="chartView">
      <svg id="chart" width="100%" viewBox="0 0 1000 460" role="img"></svg>
      <div class="tip" id="tip"></div>
      <div class="legend" id="legend"></div>
    </div>
    <div id="tableView"></div>
  </div>
</div>
<script>
const DATA = __DATA__;
const dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
const pal = dark ? DATA.paletteDark : DATA.paletteLight;
const otherColor = dark ? DATA.otherDark : DATA.otherLight;

function colorFor(i, s) { return s.isOther ? otherColor : pal[i % pal.length]; }

const NS = "http://www.w3.org/2000/svg";
const W = 1000, H = 460;
const M = { top: 18, right: 128, bottom: 34, left: 62 };
const iw = W - M.left - M.right, ih = H - M.top - M.bottom;
const T = DATA.timeline;
const hidden = new Set();

document.getElementById("subtitle").textContent =
  DATA.metricLabel + " · branch " + DATA.branch + " · " + T[0] + " to " + T[T.length-1];
document.getElementById("note").textContent = DATA.note;

function visibleSeries() {
  return DATA.series.map((s, i) => ({ s, i })).filter(o => !hidden.has(o.i));
}
function yMax() {
  let m = 0;
  for (const { s } of visibleSeries())
    for (const v of s.values) if (v > m) m = v;
  return m <= 0 ? 1 : m;
}
function yMin() {
  let m = 0;
  for (const { s } of visibleSeries())
    for (const v of s.values) if (v < m) m = v;
  return m;
}
function niceStep(range, target) {
  const raw = range / target, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  const step = n >= 5 ? 5 : n >= 2 ? 2 : 1;
  return step * mag;
}
function fmt(n) {
  const a = Math.abs(n);
  if (a >= 1e6) return (n/1e6).toFixed(1).replace(/\.0$/,"") + "M";
  if (a >= 1e3) return (n/1e3).toFixed(1).replace(/\.0$/,"") + "k";
  return String(Math.round(n));
}

const xOf = i => M.left + (T.length === 1 ? iw/2 : (i/(T.length-1))*iw);
let yScale;

function el(tag, attrs, text) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (text != null) e.textContent = text;
  return e;
}

function draw() {
  const svg = document.getElementById("chart");
  svg.innerHTML = "";
  const ymax = yMax(), ymin = yMin();
  const step = niceStep(ymax - ymin, 6);
  const top = Math.ceil(ymax / step) * step;
  const bot = Math.floor(ymin / step) * step;
  yScale = v => M.top + ih - ((v - bot) / (top - bot)) * ih;

  // gridlines + y labels
  for (let g = bot; g <= top + 1e-6; g += step) {
    const y = yScale(g);
    svg.appendChild(el("line", { x1: M.left, y1: y, x2: M.left + iw, y2: y,
      stroke: "var(--grid)", "stroke-width": g === 0 ? 1.4 : 1,
      stroke: g === 0 ? "var(--axis)" : "var(--grid)" }));
    svg.appendChild(el("text", { x: M.left - 8, y: y + 4, "text-anchor": "end",
      "font-size": 11 }, fmt(g)));
  }
  // x labels — every ~Nth month, always the last; drop a periodic one that
  // would collide with the forced last label.
  const stepX = Math.max(1, Math.round(T.length / 8));
  for (let i = 0; i < T.length; i++) {
    const isLast = i === T.length - 1;
    if (!isLast && (i % stepX !== 0 || (T.length - 1 - i) < stepX * 0.6)) continue;
    svg.appendChild(el("text", { x: xOf(i), y: H - 12, "text-anchor": "middle",
      "font-size": 11 }, T[i]));
  }

  // lines
  const endLabels = [];
  for (const { s, i } of visibleSeries()) {
    let d = "";
    s.values.forEach((v, k) => { d += (k ? "L" : "M") + xOf(k) + " " + yScale(v); });
    svg.appendChild(el("path", { d, fill: "none", stroke: colorFor(i, s),
      "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
    const last = s.values[s.values.length - 1];
    endLabels.push({ y: yScale(last), name: s.name, color: colorFor(i, s) });
  }
  // direct labels at line ends, de-collided greedily top→bottom (min 13px gap).
  // Series that can't get clear space fall back to the legend.
  endLabels.sort((a, b) => a.y - b.y);
  let lastY = -Infinity;
  for (const L of endLabels) {
    let y = L.y;
    if (y - lastY < 13) y = lastY + 13;  // nudge down to avoid overlap
    if (y > M.top + ih + 4) continue;     // ran out of room — legend covers it
    lastY = y;
    svg.appendChild(el("text", { x: M.left + iw + 8, y: y + 4,
      "font-size": 11.5, fill: L.color },
      L.name.length > 16 ? L.name.slice(0, 15) + "…" : L.name));
  }

  // crosshair holder
  svg.appendChild(el("line", { id: "cross", x1: 0, y1: M.top, x2: 0, y2: M.top + ih,
    stroke: "var(--axis)", "stroke-width": 1, opacity: 0 }));
  const dots = el("g", { id: "dots" });
  svg.appendChild(dots);
}

// hover
const tip = document.getElementById("tip");
const svg = document.getElementById("chart");
svg.addEventListener("mousemove", ev => {
  const r = svg.getBoundingClientRect();
  const px = (ev.clientX - r.left) / r.width * W;
  let idx = Math.round((px - M.left) / iw * (T.length - 1));
  idx = Math.max(0, Math.min(T.length - 1, idx));
  const cross = document.getElementById("cross");
  const dots = document.getElementById("dots");
  if (!cross) return;
  cross.setAttribute("x1", xOf(idx)); cross.setAttribute("x2", xOf(idx));
  cross.setAttribute("opacity", 1);
  dots.innerHTML = "";
  const rows = visibleSeries().map(({ s, i }) => ({ s, i, v: s.values[idx] }))
    .sort((a, b) => b.v - a.v);
  for (const { s, i, v } of rows) {
    const dot = el("circle", { cx: xOf(idx), cy: yScale(v), r: 3.5,
      fill: colorFor(i, s), stroke: "var(--surface-1)", "stroke-width": 2 });
    dots.appendChild(dot);
  }
  let html = '<div class="tm">' + T[idx] + '</div>';
  for (const { s, i, v } of rows)
    html += '<div class="row"><span class="swatch" style="background:' +
      colorFor(i, s) + '"></span>' + s.name + '<span class="v">' + v.toLocaleString() +
      '</span></div>';
  tip.innerHTML = html;
  tip.style.opacity = 1;
  const chartRect = svg.getBoundingClientRect();
  let lx = ev.clientX - chartRect.left + 16;
  if (lx + 190 > chartRect.width) lx = ev.clientX - chartRect.left - 190;
  tip.style.left = lx + "px";
  tip.style.top = (ev.clientY - chartRect.top - 10) + "px";
});
svg.addEventListener("mouseleave", () => {
  tip.style.opacity = 0;
  const c = document.getElementById("cross"); if (c) c.setAttribute("opacity", 0);
  const d = document.getElementById("dots"); if (d) d.innerHTML = "";
});

// legend
const legend = document.getElementById("legend");
DATA.series.forEach((s, i) => {
  const b = document.createElement("button");
  b.innerHTML = '<span class="swatch" style="background:' + colorFor(i, s) +
    '"></span>' + s.name;
  b.onclick = () => {
    if (hidden.has(i)) hidden.delete(i); else hidden.add(i);
    b.classList.toggle("off");
    draw();
  };
  legend.appendChild(b);
});

// table
function buildTable() {
  const tv = document.getElementById("tableView");
  let h = "<table><thead><tr><th>Month</th>";
  DATA.series.forEach(s => h += "<th>" + s.name + "</th>");
  h += "</tr></thead><tbody>";
  T.forEach((mo, k) => {
    h += "<tr><td>" + mo + "</td>";
    DATA.series.forEach(s => h += "<td>" + s.values[k].toLocaleString() + "</td>");
    h += "</tr>";
  });
  h += "</tbody></table>";
  tv.innerHTML = h;
}
buildTable();

const btnChart = document.getElementById("btnChart");
const btnTable = document.getElementById("btnTable");
btnChart.onclick = () => {
  btnChart.classList.add("active"); btnTable.classList.remove("active");
  document.getElementById("chartView").classList.remove("hide");
  document.getElementById("tableView").classList.remove("show");
};
btnTable.onclick = () => {
  btnTable.classList.add("active"); btnChart.classList.remove("active");
  document.getElementById("chartView").classList.add("hide");
  document.getElementById("tableView").classList.add("show");
};

draw();
</script>
</body>
</html>
"""


def main():
    global _GROUP_BY
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--branch", default="main")
    p.add_argument("--top", type=int, default=7, help="top N authors; rest → Other")
    p.add_argument("--metric",
                   choices=["monthly-additions", "monthly", "net", "additions"],
                   default="monthly-additions",
                   help="monthly-additions=new lines/month (default), monthly=net/month, "
                        "net=cumulative net, additions=cumulative added")
    p.add_argument("--by", choices=["email", "name"], default="email",
                   help="group commits by author email (merges aliases) or name")
    p.add_argument("--since", help="only commits after this date, e.g. '3 months ago' or 2026-04-16")
    p.add_argument("--until", help="only commits before this date")
    p.add_argument("--include-bots", action="store_true")
    p.add_argument("--no-merge-names", action="store_true",
                   help="don't auto-merge groups that share a display name")
    p.add_argument("--aliases", help="JSON file: {\"Canonical Name\": [\"email\", \"altname\", ...]}")
    p.add_argument("--exclude", action="append", default=[],
                   help="extra glob(s) to exclude; repeatable")
    p.add_argument("--out", default=str(Path(__file__).parent / "loc-by-author.html"))
    p.add_argument("--open", action="store_true", help="open the HTML when done")
    args = p.parse_args()

    _GROUP_BY = args.by
    excludes = DEFAULT_EXCLUDES + args.exclude

    aliases = {}
    if args.aliases:
        aliases = json.loads(Path(args.aliases).read_text())

    net, add, name_counts, email_of, months = parse_git_log(
        args.branch, excludes, args.include_bots, args.since, args.until)
    net, add, identity = merge_identities(
        net, add, name_counts, email_of, aliases, not args.no_merge_names)
    timeline, series = build_series(net, add, identity, months, args.top, args.metric)

    note = (f"Authors grouped by {args.by} · "
            f"{'bots included' if args.include_bots else 'bots excluded'} · "
            f"lockfiles/generated/binary files excluded")
    html = render_html(args.branch, timeline, series, args.metric, note)

    out = Path(args.out)
    out.write_text(html, encoding="utf-8")

    print(f"Wrote {out}")
    print(f"Branch {args.branch}: {len(timeline)} months, "
          f"{len(series)} series (top {args.top} + Other), metric={args.metric}")
    # For cumulative metrics the running total is the last point; for per-month
    # metrics it's the sum across months.
    cumulative_metric = args.metric in ("net", "additions")
    label = "total" if cumulative_metric else "sum/period"
    print(f"  {'':>12}  ({label})")
    top_totals = sorted(
        ((s["name"], s["values"][-1] if cumulative_metric else sum(s["values"]))
         for s in series if not s.get("isOther")),
        key=lambda kv: kv[1], reverse=True)
    for name, val in top_totals:
        print(f"  {val:>12,}  {name}")
    if args.open:
        webbrowser.open(out.resolve().as_uri())


if __name__ == "__main__":
    main()
