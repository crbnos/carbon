// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Paints a frame onto a canvas: the sky, the cell backgrounds, the soft
// halos of every light, then the glyphs. Glyphs of one colour that sit side
// by side go out as one fillText, so a frame costs a few hundred calls, not
// one per cell. Non-ASCII glyphs (✓ ● ♪) are drawn alone and centred, since
// a fallback font need not share the monospace advance.

import type { FrameOut } from "./frame";
import type { Grid, Label } from "./grid";
import { blue, css, green, NO_BG, red } from "./grid";

export type Metrics = {
  /** Cell size in CSS pixels. */
  cellWidth: number;
  cellHeight: number;
  /** Where the grid starts, to centre it in the canvas. */
  offsetX: number;
  offsetY: number;
  font: string;
  width: number;
  height: number;
  horizonRow: number;
};

const styles = new Map<number, string>();

function style(color: number) {
  let value = styles.get(color);
  if (!value) {
    value = css(color);
    styles.set(color, value);
  }
  return value;
}

function rgba(color: number, alpha: number) {
  return `rgba(${red(color)},${green(color)},${blue(color)},${alpha})`;
}

/** Drops the lowest bits so neighbouring glyphs share a colour and a run. */
function quantize(color: number) {
  return color & 0xf8f8f8;
}

// Graphemes, so a cut never splits a letter from its marks.
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** A label's whole string over its cells, cut with an ellipsis to fit. */
function drawLabel(ctx: CanvasRenderingContext2D, label: Label, m: Metrics) {
  const room = label.cells * m.cellWidth;
  let text = label.text;
  if (ctx.measureText(text).width > room) {
    const parts = Array.from(graphemes.segment(text), (part) => part.segment);
    while (parts.length > 0 && ctx.measureText(`${text}…`).width > room) {
      parts.pop();
      text = parts.join("");
    }
    text = `${text}…`;
  }
  const left = m.offsetX + label.x * m.cellWidth;
  ctx.fillStyle = style(quantize(label.color));
  ctx.textAlign = label.align;
  ctx.fillText(
    text,
    label.align === "center" ? left + room / 2 : left,
    m.offsetY + label.y * m.cellHeight + m.cellHeight / 2
  );
}

export function paint(
  ctx: CanvasRenderingContext2D,
  grid: Grid,
  frame: FrameOut,
  m: Metrics
) {
  const { cellWidth: cw, cellHeight: ch, offsetX: ox, offsetY: oy } = m;

  const sky = ctx.createLinearGradient(0, 0, 0, oy + m.horizonRow * ch);
  sky.addColorStop(0, style(frame.sky.top));
  sky.addColorStop(1, style(frame.sky.horizon));
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, m.width, m.height);

  for (let r = 0; r < grid.rows; r++) {
    let runStart = -1;
    let runColor = NO_BG;
    const flush = (end: number) => {
      if (runStart < 0 || runColor === NO_BG) return;
      ctx.fillStyle = style(runColor);
      ctx.fillRect(
        ox + runStart * cw,
        oy + r * ch,
        (end - runStart) * cw + 0.6,
        ch + 0.6
      );
    };
    for (let c = 0; c < grid.cols; c++) {
      const bg = grid.bg[r * grid.cols + c] ?? NO_BG;
      const color = bg === NO_BG ? NO_BG : quantize(bg);
      if (color !== runColor) {
        flush(c);
        runStart = c;
        runColor = color;
      }
    }
    flush(grid.cols);
  }

  ctx.globalCompositeOperation = "lighter";
  for (const light of frame.lights) {
    const halo = light.halo ?? 0;
    if (halo <= 0.005) continue;
    const x = ox + light.x * cw;
    const y = oy + light.y * ch;
    const radius = light.radius * ch * 1.7;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, rgba(light.color, Math.min(0.6, halo)));
    gradient.addColorStop(0.4, rgba(light.color, Math.min(0.6, halo) * 0.35));
    gradient.addColorStop(1, rgba(light.color, 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  ctx.globalCompositeOperation = "source-over";

  ctx.font = m.font;
  ctx.textBaseline = "middle";
  for (let r = 0; r < grid.rows; r++) {
    const y = oy + r * ch + ch / 2;
    let run = "";
    let runStart = 0;
    let runColor = -1;
    let pendingSpaces = 0;
    const flush = () => {
      if (run.length > 0) {
        ctx.textAlign = "left";
        ctx.fillStyle = style(runColor);
        ctx.fillText(run, ox + runStart * cw, y);
      }
      run = "";
      runColor = -1;
      pendingSpaces = 0;
    };
    for (let c = 0; c < grid.cols; c++) {
      const i = r * grid.cols + c;
      const code = grid.ch[i] ?? 32;
      if (code === 32) {
        if (run.length > 0) pendingSpaces++;
        continue;
      }
      const color = quantize(grid.fg[i] ?? 0);
      if (code > 126) {
        flush();
        ctx.textAlign = "center";
        ctx.fillStyle = style(color);
        ctx.fillText(String.fromCharCode(code), ox + c * cw + cw / 2, y);
        continue;
      }
      if (run.length > 0 && color === runColor && pendingSpaces < 6) {
        run += " ".repeat(pendingSpaces) + String.fromCharCode(code);
        pendingSpaces = 0;
        continue;
      }
      flush();
      run = String.fromCharCode(code);
      runStart = c;
      runColor = color;
    }
    flush();
  }

  for (const label of grid.labels) drawLabel(ctx, label, m);

  if (frame.flash > 0) {
    ctx.fillStyle = `rgba(232,228,255,${frame.flash * 0.45})`;
    ctx.fillRect(0, 0, m.width, m.height);
  }
}
