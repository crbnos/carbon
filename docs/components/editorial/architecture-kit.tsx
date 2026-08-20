/* Primitives for the hand-drawn architecture diagrams (`architecture-diagrams.tsx`).
 *
 * These are laid out by hand rather than generated, because a generated one could not be
 * read at rest: an auto-layout engine spreads a dozen nodes over ~2,000px, and the reading
 * column then shrinks that to a quarter size. Everything here is designed on a 740-unit
 * canvas instead — close to the real render width, so a 14px label renders at about 14px.
 * That constraint is the point: at this size only short labels fit, which is what keeps
 * the diagrams legible without zooming.
 *
 * The vocabulary carries meaning, so a reader can decode a shape before reading it:
 *   Node      a service or process       Card      something outside Carbon
 *   Store     a datastore (cylinder)     Boundary  a system that owns what's inside it
 *   Edge      a connector                Badge     a qualifier on a node
 */

import type { ReactNode } from "react";

export const INK = "#262323";
const INK_60 = "rgba(38,35,35,0.6)";
export const INK_45 = "rgba(38,35,35,0.45)";
const INK_35 = "rgba(38,35,35,0.35)";
export const LINE = "#D8D7D2";
const PAPER = "#FBFBF8";

/* Fill / stroke / text per role. The stroke is the categorical slot; the text is a
 * deeper step of it (the slot hues themselves fail 4.5:1 as text). `plain` is the
 * default — colour is for the nodes that carry the story, not every box. */
export const TONE = {
  plain: { fill: PAPER, stroke: LINE, text: INK },
  app: { fill: "#E8F1FC", stroke: "#2A78D6", text: "#1F5FA8" },
  svc: { fill: "#E3F5E3", stroke: "#008300", text: "#006B00" },
  data: { fill: "#FCEEF3", stroke: "#E87BA4", text: "#B04A72" },
  async: { fill: "#FDF3E0", stroke: "#EDA100", text: "#8A6000" },
} as const;

export type Tone = keyof typeof TONE;

export function ArrowDefs() {
  return (
    <defs>
      <marker id="ah" viewBox="0 0 8 8" refX="6.4" refY="4" markerWidth="7" markerHeight="7" orient="auto">
        <path d="M1 1.4 L6.2 4 L1 6.6" fill="none" stroke={INK_45} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </marker>
      <marker id="ah-soft" viewBox="0 0 8 8" refX="6.4" refY="4" markerWidth="7" markerHeight="7" orient="auto">
        <path d="M1 1.4 L6.2 4 L1 6.6" fill="none" stroke={INK_35} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </marker>
    </defs>
  );
}

export function Node({
  x,
  y,
  w,
  h,
  label,
  sub,
  tone = "plain",
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  sub?: string;
  tone?: Tone;
}) {
  const t = TONE[tone];
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={11} fill={t.fill} stroke={t.stroke} strokeWidth={1.4} />
      <text
        x={x + w / 2}
        y={sub ? y + h / 2 - 3 : y + h / 2 + 5}
        textAnchor="middle"
        fontSize="14"
        fontWeight={545}
        fill={t.text}
      >
        {label}
      </text>
      {sub && (
        <text x={x + w / 2} y={y + h / 2 + 14} textAnchor="middle" fontSize="11" fill={INK_45}>
          {sub}
        </text>
      )}
    </g>
  );
}

/* Something Carbon talks to but does not run — a person's browser, another company's
 * system. The doubled base line reads as a physical thing sitting on a surface, which is
 * what separates it at a glance from the services Carbon owns. */
export function Card({
  x,
  y,
  w,
  h,
  label,
  sub,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  sub?: string;
}) {
  return (
    <g>
      <rect x={x + 7} y={y + h + 3} width={w - 14} height={4} rx={2} fill="none" stroke={LINE} strokeWidth={1.2} />
      <rect x={x} y={y} width={w} height={h} rx={11} fill="#FFFFFF" stroke={LINE} strokeWidth={1.4} />
      <text x={x + w / 2} y={sub ? y + h / 2 - 3 : y + h / 2 + 5} textAnchor="middle" fontSize="14" fontWeight={545} fill={INK}>
        {label}
      </text>
      {sub && (
        <text x={x + w / 2} y={y + h / 2 + 14} textAnchor="middle" fontSize="11" fill={INK_45}>
          {sub}
        </text>
      )}
    </g>
  );
}

/* Cylinder. `y` is the top of the body, `h` its full height including both caps. */
export function Store({
  x,
  y,
  w,
  h,
  label,
  sub,
  tone = "data",
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  sub?: string;
  tone?: Tone;
}) {
  const t = TONE[tone];
  const ry = 9;
  const body = h - ry * 2;
  return (
    <g>
      <path
        d={`M ${x} ${y + ry} v ${body} a ${w / 2} ${ry} 0 0 0 ${w} 0 v ${-body}`}
        fill={t.fill}
        stroke={t.stroke}
        strokeWidth={1.4}
      />
      <ellipse cx={x + w / 2} cy={y + ry} rx={w / 2} ry={ry} fill="#FFFFFF" stroke={t.stroke} strokeWidth={1.4} />
      <text x={x + w / 2} y={y + ry + body / 2 + (sub ? -1 : 5)} textAnchor="middle" fontSize="14" fontWeight={545} fill={t.text}>
        {label}
      </text>
      {sub && (
        <text x={x + w / 2} y={y + ry + body / 2 + 15} textAnchor="middle" fontSize="11" fill={INK_45}>
          {sub}
        </text>
      )}
    </g>
  );
}

/* A system that owns everything inside it. The label sits on the boundary line itself,
 * in a paper-filled gap, so the rule reads as continuous. */
export function Boundary({
  x,
  y,
  w,
  h,
  label,
  children,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  children?: ReactNode;
}) {
  const tw = label.length * 6.6 + 18;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={14} fill="none" stroke={LINE} strokeWidth={1.2} strokeDasharray="5 5" />
      <rect x={x + 22} y={y - 7} width={tw} height={14} fill="#FBFBFB" />
      <text x={x + 22 + tw / 2} y={y + 4} textAnchor="middle" fontSize="10" fontWeight={600} letterSpacing="0.1em" fill={INK_45}>
        {label.toUpperCase()}
      </text>
      {children}
    </g>
  );
}

/* Small pill — a status or qualifier attached to a node, not a node itself. */
export function Badge({ x, y, label, tone = "plain" }: { x: number; y: number; label: string; tone?: Tone }) {
  const t = TONE[tone];
  const w = label.length * 5.6 + 18;
  return (
    <g>
      <rect x={x - w / 2} y={y} width={w} height={19} rx={9.5} fill={t.fill} stroke={t.stroke} strokeWidth={1} />
      <text x={x} y={y + 13} textAnchor="middle" fontSize="10" fontWeight={560} fill={t.text}>
        {label}
      </text>
    </g>
  );
}

/* SVG has no text wrapping, so multi-line copy is authored as an explicit array of
 * lines. Keeping the break points by hand is a feature here — it stops a diagram from
 * silently reflowing into something ugly when a label changes. */
export function Lines({
  x,
  y,
  lines,
  size = 11,
  fill = INK_60,
  anchor = "start",
  lead = 14,
}: {
  x: number;
  y: number;
  lines: string[];
  size?: number;
  fill?: string;
  anchor?: "start" | "middle";
  lead?: number;
}) {
  return (
    <text x={x} y={y} textAnchor={anchor} fontSize={size} fill={fill}>
      {lines.map((l, i) => (
        <tspan key={l} x={x} dy={i ? lead : 0}>
          {l}
        </tspan>
      ))}
    </text>
  );
}

/* Mono uppercase section label — the same eyebrow the Boundary uses, free-standing. */
export function Eyebrow({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <text x={x} y={y} fontSize="10" fontWeight={600} letterSpacing="0.1em" fill={INK_45}>
      {label.toUpperCase()}
    </text>
  );
}

/* Orthogonal connector. `pts` are absolute points; the line is drawn through them in
 * order, so a right-angle route is just three points. */
export function Edge({
  pts,
  label,
  labelAt,
  soft,
  dashed,
}: {
  pts: [number, number][];
  label?: string;
  labelAt?: [number, number];
  soft?: boolean;
  dashed?: boolean;
}) {
  const d = pts.map(([px, py], i) => `${i ? "L" : "M"} ${px} ${py}`).join(" ");
  const [lx, ly] = labelAt ?? [0, 0];
  return (
    <g>
      <path
        d={d}
        fill="none"
        stroke={soft ? INK_35 : INK_45}
        strokeWidth={soft ? 1.1 : 1.3}
        strokeDasharray={dashed ? "4 4" : undefined}
        strokeLinecap="round"
        strokeLinejoin="round"
        markerEnd={soft ? "url(#ah-soft)" : "url(#ah)"}
      />
      {label && labelAt && (
        <>
          <rect x={lx - (label.length * 5.4) / 2 - 5} y={ly - 9} width={label.length * 5.4 + 10} height={15} rx={4} fill="#FBFBFB" />
          <text x={lx} y={ly + 2} textAnchor="middle" fontSize="10.5" fill={INK_60}>
            {label}
          </text>
        </>
      )}
    </g>
  );
}
