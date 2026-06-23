/* Shared primitives for the on-brand editorial SVGs — warm paper palette, DM Sans
 * (inherited), #00B0FF accent, made=blue / bought=amber tags matching the content
 * badges. Both the static `illustrations.tsx` registry and the data-driven
 * `status-flow.tsx` import from here so every diagram stays visually locked.
 * Colors are kept as constants in SVG attributes (not Tailwind classes) to match the
 * surrounding illustration code and keep the geometry/paint in one place. */

export const INK = "#262323";
export const INK_60 = "rgba(38,35,35,0.6)";
export const INK_45 = "rgba(38,35,35,0.45)";
export const LINE = "#D8D7D2";
export const BRAND = "#00B0FF";
export const BRAND_INK = "#1E84B0";

export const TAG = {
  made: { fill: "#DFF5FF", stroke: "#A9DAF3", text: "#3583A8" },
  bought: { fill: "#FFF2D8", stroke: "#E6CFA3", text: "#9C7136" },
  neutral: { fill: "#EFEFEB", stroke: "#DADAD5", text: "rgba(38,35,35,0.55)" },
};

export function Box({
  x,
  y,
  w,
  h,
  label,
  sub,
  accent,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={10}
        fill={accent ? "#EAF8FF" : "#FBFBF8"}
        stroke={accent ? BRAND : LINE}
        strokeWidth={1.4}
      />
      <text
        x={x + w / 2}
        y={sub ? y + h / 2 - 4 : y + h / 2 + 5}
        textAnchor="middle"
        fontSize="14"
        fontWeight={530}
        fill={accent ? BRAND_INK : INK}
      >
        {label}
      </text>
      {sub && (
        <text x={x + w / 2} y={y + h / 2 + 14} textAnchor="middle" fontSize="11.5" fill={INK_45}>
          {sub}
        </text>
      )}
    </g>
  );
}

export function Arrow({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const ah = 5;
  return (
    <g stroke={INK_45} strokeWidth={1.4} fill="none">
      <line x1={x1} y1={y1} x2={x2} y2={y2} />
      <path
        d={`M ${x2 - ah * Math.cos(ang - 0.5)} ${y2 - ah * Math.sin(ang - 0.5)} L ${x2} ${y2} L ${x2 - ah * Math.cos(ang + 0.5)} ${y2 - ah * Math.sin(ang + 0.5)}`}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  );
}

export function Tag({ x, y, kind, label }: { x: number; y: number; kind: keyof typeof TAG; label: string }) {
  const t = TAG[kind];
  const w = label.length * 6.4 + 16;
  return (
    <g>
      <rect x={x} y={y} width={w} height={18} rx={9} fill={t.fill} stroke={t.stroke} strokeWidth={1} />
      <text x={x + w / 2} y={y + 12.5} textAnchor="middle" fontSize="10" fontWeight={500} fill={t.text}>
        {label}
      </text>
    </g>
  );
}
