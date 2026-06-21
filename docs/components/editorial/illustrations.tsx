export type IllustrationKey =
  | "flow-overview"
  | "order-split"
  | "bom-tree"
  | "demand-forecast"
  | "planning-engine"
  | "shopfloor-loop"
  | "eight-d"
  | "traceability-graph"
  | "method-types"
  | "kit-vs-subassembly"
  | "reorder-policy"
  | "outside-processing"
  | "mes-station"
  | "issue-workflow"
  | "schedule-board"
  | "get-method"
  | "conversion-factor"
  | "opportunity-thread"
  | "cash-cycle"
  | "rfq-fanout"
  | "receive-bill-axes"
  | "wip-inflow"
  | "wip-to-cogs"
  | "depreciation-curve"
  | "asset-exit";

/* On-brand editorial illustrations — warm paper palette, DM Sans (inherited),
 * #00B0FF accent, made=blue / bought=amber tags matching the content badges.
 * Each is a responsive SVG (w-full h-auto) sized for the 620px reading column. */

const INK = "#262323";
const INK_60 = "rgba(38,35,35,0.6)";
const INK_45 = "rgba(38,35,35,0.45)";
const LINE = "#D8D7D2";
const BRAND = "#00B0FF";
const BRAND_INK = "#1E84B0";

const TAG = {
  made: { fill: "#DFF5FF", stroke: "#A9DAF3", text: "#3583A8" },
  bought: { fill: "#FFF2D8", stroke: "#E6CFA3", text: "#9C7136" },
  neutral: { fill: "#EFEFEB", stroke: "#DADAD5", text: "rgba(38,35,35,0.55)" },
};

function Box({
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

function Arrow({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
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

function Tag({ x, y, kind, label }: { x: number; y: number; kind: keyof typeof TAG; label: string }) {
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

function FlowOverview() {
  const steps = ["Order", "Build", "Plan", "Floor", "Quality", "Ship"];
  const w = 132;
  const pitch = 150;
  const y = 30;
  return (
    <svg viewBox="0 0 912 92" className="w-full h-auto" role="img" aria-label="Carbon flow overview">
      {steps.map((s, i) => {
        const x = 6 + i * pitch;
        return (
          <g key={s}>
            {i > 0 && <Arrow x1={x - 18} y1={y + 26} x2={x - 2} y2={y + 26} />}
            <Box x={x} y={y} w={w} h={52} label={s} accent={i === 0} />
            <text x={x + 14} y={y + 16} fontSize="10" fontWeight={500} fill={INK_45} fontFamily="var(--font-mono)">
              {i + 1}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function OrderSplit() {
  const weeks = [
    { label: "Week 1 · 30 units", sub: "Released", accent: true },
    { label: "Week 2 · 30 units", sub: "Planned" },
    { label: "Week 3 · 30 units", sub: "Planned" },
  ];
  return (
    <svg viewBox="0 0 720 210" className="w-full h-auto" role="img" aria-label="Order split into jobs">
      <Box x={14} y={75} w={170} h={60} label="90 units" sub="1 sales order" />
      {weeks.map((wk, i) => {
        const y = 16 + i * 64;
        return (
          <g key={wk.label}>
            <path
              d={`M 184 105 C 280 105, 300 ${y + 24}, 392 ${y + 24}`}
              fill="none"
              stroke={LINE}
              strokeWidth={1.4}
            />
            <Box x={394} y={y} w={312} h={48} label={wk.label} sub={wk.sub} accent={wk.accent} />
          </g>
        );
      })}
    </svg>
  );
}

function BomTree() {
  return (
    <svg viewBox="0 0 720 312" className="w-full h-auto" role="img" aria-label="Robot bill of materials">
      {/* edges */}
      <g stroke={LINE} strokeWidth={1.4} fill="none">
        <path d="M 360 56 L 360 84 M 170 84 L 550 84 M 170 84 L 170 104 M 550 84 L 550 104" />
        <path d="M 170 156 L 170 184 M 80 184 L 260 184 M 80 184 L 80 208 M 260 184 L 260 208" />
        <path d="M 550 156 L 550 184 M 460 184 L 640 184 M 460 184 L 460 208 M 640 184 L 640 208" />
      </g>
      <Box x={290} y={12} w={140} h={44} label="Robot" sub="assembly" accent />
      <Box x={100} y={104} w={140} h={52} label="Arm" sub="made · to order" />
      <Box x={480} y={104} w={140} h={52} label="Leg" sub="made" />
      {[
        { x: 12, label: "Arm part", kind: "made" as const },
        { x: 188, label: "Arm motor", kind: "bought" as const },
        { x: 392, label: "Leg part", kind: "made" as const },
        { x: 568, label: "Leg motor", kind: "bought" as const },
      ].map((leaf) => (
        <g key={leaf.label}>
          <rect x={leaf.x} y={208} width={140} height={56} rx={9} fill="#FBFBF8" stroke={LINE} strokeWidth={1.4} />
          <text x={leaf.x + 70} y={230} textAnchor="middle" fontSize="13.5" fontWeight={530} fill={INK}>
            {leaf.label}
          </text>
          <g transform={`translate(${leaf.x + 70 - (leaf.kind === "made" ? 58 : 64)}, 240)`}>
            <Tag x={0} y={0} kind={leaf.kind} label={leaf.kind} />
            <Tag x={leaf.kind === "made" ? 52 : 58} y={0} kind="neutral" label="picked" />
          </g>
        </g>
      ))}
    </svg>
  );
}

function DemandForecast() {
  const data = [
    { wk: "Wk 1", qty: 30, forecast: false },
    { wk: "Wk 2", qty: 30, forecast: false },
    { wk: "Wk 3", qty: 30, forecast: false },
    { wk: "Wk 4", qty: 50, forecast: true },
    { wk: "Wk 5", qty: 70, forecast: true },
  ];
  const base = 196;
  const scale = 1.7;
  return (
    <svg viewBox="0 0 720 248" className="w-full h-auto" role="img" aria-label="Demand forecast by week">
      <line x1={40} y1={base} x2={700} y2={base} stroke={LINE} strokeWidth={1.4} />
      {data.map((d, i) => {
        const x = 70 + i * 126;
        const h = d.qty * scale;
        return (
          <g key={d.wk}>
            <rect
              x={x}
              y={base - h}
              width={84}
              height={h}
              rx={6}
              fill={d.forecast ? "#EAF8FF" : "#E7E7E1"}
              stroke={d.forecast ? BRAND : "#C9C8C2"}
              strokeWidth={1.4}
              strokeDasharray={d.forecast ? "4 3" : undefined}
            />
            <text x={x + 42} y={base - h - 8} textAnchor="middle" fontSize="13" fontWeight={600} fill={d.forecast ? BRAND_INK : INK}>
              {d.qty}
            </text>
            <text x={x + 42} y={base + 18} textAnchor="middle" fontSize="11.5" fill={INK_60}>
              {d.wk}
            </text>
          </g>
        );
      })}
      {/* legend */}
      <g>
        <rect x={430} y={14} width={16} height={12} rx={3} fill="#E7E7E1" stroke="#C9C8C2" strokeWidth={1.2} />
        <text x={452} y={24} fontSize="11.5" fill={INK_60}>Confirmed orders</text>
        <rect x={560} y={14} width={16} height={12} rx={3} fill="#EAF8FF" stroke={BRAND} strokeWidth={1.2} strokeDasharray="3 2" />
        <text x={582} y={24} fontSize="11.5" fill={INK_60}>Forecast</text>
      </g>
    </svg>
  );
}

function PlanningEngine() {
  return (
    <svg viewBox="0 0 720 212" className="w-full h-auto" role="img" aria-label="Planning engine">
      <Box x={16} y={78} w={188} h={56} label="Demand" sub="orders + forecast" accent />
      <Arrow x1={204} y1={70} x2={438} y2={48} />
      <Arrow x1={204} y1={120} x2={438} y2={160} />
      <Box x={440} y={22} w={266} h={52} label="Production planning" sub="→ jobs to build" />
      <Box x={440} y={134} w={266} h={52} label="Purchasing planning" sub="→ POs to raise" />
    </svg>
  );
}

function ShopfloorLoop() {
  const spokes = [
    { y: 14, label: "Backflush inventory", kind: "green" },
    { y: 74, label: "Log labor & cost", kind: "neutral" },
    { y: 134, label: "Scan serial / lot", kind: "brand" },
  ];
  return (
    <svg viewBox="0 0 720 200" className="w-full h-auto" role="img" aria-label="Shop floor reporting">
      <Box x={20} y={74} w={196} h={56} label="Operation" sub="reports complete" accent />
      {spokes.map((s) => (
        <g key={s.label}>
          <Arrow x1={216} y1={102} x2={446} y2={s.y + 24} />
          <rect x={448} y={s.y} width={258} height={48} rx={9} fill="#FBFBF8" stroke={LINE} strokeWidth={1.4} />
          <text x={468} y={s.y + 29} fontSize="13.5" fontWeight={500} fill={INK}>
            {s.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

function EightD() {
  const steps = ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8"];
  const subs = ["Team", "Define", "Contain", "Root cause", "Correct", "Implement", "Prevent", "Close"];
  const w = 78;
  const pitch = 88;
  const y = 46;
  return (
    <svg viewBox="0 0 720 124" className="w-full h-auto" role="img" aria-label="8D quality flow">
      {steps.map((s, i) => {
        const x = 8 + i * pitch;
        const active = i === 2;
        return (
          <g key={s}>
            {i > 0 && <Arrow x1={x - 10} y1={y + 23} x2={x - 1} y2={y + 23} />}
            <Box x={x} y={y} w={w} h={46} label={s} sub={subs[i]} accent={active} />
          </g>
        );
      })}
      <text x={8} y={26} fontSize="11.5" fill={INK_60}>
        Containment (D3) shows on the shop floor immediately.
      </text>
    </svg>
  );
}

function TraceabilityGraph() {
  return (
    <svg viewBox="0 0 720 300" className="w-full h-auto" role="img" aria-label="Traceability graph">
      <g stroke={LINE} strokeWidth={1.4} fill="none">
        <path d="M 360 58 L 360 84 M 175 84 L 545 84 M 175 84 L 175 104 M 545 84 L 545 104" />
        <path d="M 175 156 L 175 182 M 90 182 L 260 182 M 90 182 L 90 204 M 260 182 L 260 204" />
        <path d="M 545 156 L 545 182 M 460 182 L 630 182 M 460 182 L 460 204 M 630 182 L 630 204" />
      </g>
      <Box x={278} y={12} w={164} h={46} label="Robot #0001" sub="serial" accent />
      <Box x={105} y={104} w={140} h={52} label="Arm" sub="built 2026-06-18" />
      <Box x={475} y={104} w={140} h={52} label="Leg" sub="built 2026-06-19" />
      {[
        { x: 20, label: "Arm part", sub: "heat H-22" },
        { x: 190, label: "Arm motor", sub: "lot M-4471" },
        { x: 390, label: "Leg part", sub: "heat H-22" },
        { x: 560, label: "Leg motor", sub: "lot M-4472" },
      ].map((leaf) => (
        <Box key={leaf.label} x={leaf.x} y={204} w={140} h={50} label={leaf.label} sub={leaf.sub} />
      ))}
    </svg>
  );
}

function MethodTypes() {
  const lanes = [
    { method: "Make", box: "Becomes a job", sub: "its own routing", kind: "made" as const, y: 12 },
    { method: "Purchase", box: "Becomes a PO", sub: "from a supplier", kind: "bought" as const, y: 86 },
    { method: "Pull", box: "Pulled from stock", sub: "on hand", kind: "neutral" as const, y: 160 },
  ];
  return (
    <svg viewBox="0 0 720 220" className="w-full h-auto" role="img" aria-label="Method types: make, buy, pick">
      <Box x={16} y={82} w={150} h={56} label="Part" sub="method type" accent />
      {lanes.map((l) => {
        const ex = 442;
        const ey = l.y + 24;
        const mx = (166 + ex) / 2;
        const my = (110 + ey) / 2;
        const tagW = l.method.length * 6.4 + 16;
        return (
          <g key={l.method}>
            <Arrow x1={166} y1={110} x2={ex - 2} y2={ey} />
            <rect x={mx - tagW / 2} y={my - 9} width={tagW} height={18} rx={9} fill="#F5F5F2" />
            <Tag x={mx - tagW / 2} y={my - 9} kind={l.kind} label={l.method} />
            <Box x={ex} y={l.y} w={264} h={48} label={l.box} sub={l.sub} />
          </g>
        );
      })}
    </svg>
  );
}

function KitVsSubassembly() {
  return (
    <svg viewBox="0 0 720 250" className="w-full h-auto" role="img" aria-label="Kit versus subassembly">
      <line x1={360} y1={18} x2={360} y2={232} stroke={LINE} strokeWidth={1.2} strokeDasharray="4 5" />

      {/* Subassembly — builds as its own job */}
      <text x={24} y={26} fontSize="11.5" fontWeight={600} fill={INK_60} fontFamily="var(--font-mono)">
        SUBASSEMBLY
      </text>
      <Box x={110} y={42} w={150} h={46} label="Arm" sub="make to order" />
      <Arrow x1={185} y1={88} x2={185} y2={118} />
      <Box x={100} y={118} w={170} h={48} label="Arm job" sub="own routing" accent />
      <g stroke={LINE} strokeWidth={1.4} fill="none">
        <path d="M 185 166 L 185 184 M 145 184 L 265 184 M 145 184 L 145 198 M 265 184 L 265 198" />
      </g>
      <Box x={90} y={198} w={110} h={38} label="Part" />
      <Box x={210} y={198} w={110} h={38} label="Motor" />

      {/* Kit — components issued straight into the parent */}
      <text x={400} y={26} fontSize="11.5" fontWeight={600} fill={INK_60} fontFamily="var(--font-mono)">
        KIT
      </text>
      <Box x={465} y={42} w={150} h={46} label="Arm" sub="make to order" />
      <Arrow x1={540} y1={88} x2={540} y2={116} />
      <rect x={442} y={116} width={196} height={106} rx={12} fill="#EAF8FF" stroke={BRAND} strokeWidth={1.4} strokeDasharray="5 4" />
      <text x={540} y={137} textAnchor="middle" fontSize="10.5" fontWeight={600} fill={BRAND_INK} fontFamily="var(--font-mono)">
        ISSUED TOGETHER
      </text>
      <rect x={462} y={148} width={156} height={28} rx={7} fill="#FBFBF8" stroke={LINE} strokeWidth={1.3} />
      <text x={540} y={166} textAnchor="middle" fontSize="12.5" fontWeight={500} fill={INK}>
        Part
      </text>
      <rect x={462} y={184} width={156} height={28} rx={7} fill="#FBFBF8" stroke={LINE} strokeWidth={1.3} />
      <text x={540} y={202} textAnchor="middle" fontSize="12.5" fontWeight={500} fill={INK}>
        Motor
      </text>
    </svg>
  );
}

function ReorderPolicy() {
  const maxY = 58;
  const ropY = 150;
  const baseY = 204;
  const x0 = 92;
  const xEnd = 620;
  const pts = "96,58 220,150 220,58 348,150 348,58 476,150 476,58 612,150";
  return (
    <svg viewBox="0 0 720 240" className="w-full h-auto" role="img" aria-label="Reorder point policy">
      {/* axes */}
      <line x1={x0} y1={28} x2={x0} y2={baseY} stroke={LINE} strokeWidth={1.4} />
      <line x1={x0} y1={baseY} x2={668} y2={baseY} stroke={LINE} strokeWidth={1.4} />
      {/* thresholds */}
      <line x1={x0} y1={maxY} x2={xEnd} y2={maxY} stroke={INK_45} strokeWidth={1.2} strokeDasharray="5 4" />
      <line x1={x0} y1={ropY} x2={xEnd} y2={ropY} stroke={BRAND} strokeWidth={1.2} strokeDasharray="5 4" />
      {/* on-hand sawtooth */}
      <polyline
        points={pts}
        fill="none"
        stroke={BRAND}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* order placements at reorder crossings */}
      {[220, 348, 476].map((x) => (
        <circle key={x} cx={x} cy={ropY} r={3.6} fill={BRAND} />
      ))}
      {/* labels */}
      <text x={xEnd + 6} y={maxY + 4} fontSize="11.5" fill={INK_60}>
        Maximum
      </text>
      <text x={xEnd + 6} y={ropY + 4} fontSize="11.5" fill={BRAND_INK}>
        Reorder point
      </text>
      <text
        x={x0 - 8}
        y={34}
        textAnchor="end"
        fontSize="11"
        fill={INK_45}
        fontFamily="var(--font-mono)"
        transform={`rotate(-90 ${x0 - 8} 34)`}
      >
        on hand
      </text>
      <text x={x0 + 4} y={224} fontSize="11" fill={INK_45} fontFamily="var(--font-mono)">
        time →
      </text>
      {/* order annotation */}
      <rect x={232} y={118} width={94} height={18} rx={9} fill="#F5F5F2" />
      <Tag x={232} y={118} kind="neutral" label="order placed" />
    </svg>
  );
}

function OutsideProcessing() {
  return (
    <svg viewBox="0 0 720 188" className="w-full h-auto" role="img" aria-label="Outside processing operation">
      <Box x={16} y={30} w={168} h={52} label="Mill" sub="in-house" />
      <Arrow x1={184} y1={56} x2={210} y2={56} />
      {/* the outside step */}
      <rect x={212} y={30} width={168} height={52} rx={10} fill="#FFF8EC" stroke={TAG.bought.stroke} strokeWidth={1.5} strokeDasharray="5 4" />
      <text x={296} y={52} textAnchor="middle" fontSize="14" fontWeight={530} fill={INK}>
        Anodize
      </text>
      <text x={296} y={68} textAnchor="middle" fontSize="11.5" fill={TAG.bought.text}>
        outside
      </text>
      <Arrow x1={380} y1={56} x2={406} y2={56} />
      <Box x={408} y={30} w={168} h={52} label="Assemble" sub="in-house" />
      {/* branch out to the supplier PO */}
      <Arrow x1={296} y1={82} x2={296} y2={116} />
      <rect x={196} y={118} width={200} height={50} rx={10} fill="#FFF8EC" stroke={TAG.bought.stroke} strokeWidth={1.4} />
      <text x={296} y={140} textAnchor="middle" fontSize="13" fontWeight={530} fill={INK}>
        Outside Processing PO
      </text>
      <text x={296} y={157} textAnchor="middle" fontSize="11" fill={TAG.bought.text}>
        supplier rate + lead time
      </text>
    </svg>
  );
}

function MesStation() {
  const pills = [
    { label: "Setup", active: false },
    { label: "Labor", active: true },
    { label: "Machine", active: false },
  ];
  const qty = ["Log Completed", "Log Scrap", "Log Rework"];
  return (
    <svg viewBox="0 0 720 232" className="w-full h-auto" role="img" aria-label="MES operation station">
      <rect x={120} y={12} width={480} height={208} rx={16} fill="#FBFBF8" stroke={LINE} strokeWidth={1.6} />
      <text x={142} y={44} fontSize="11" fontWeight={600} fill={INK_45} fontFamily="var(--font-mono)">
        ARM · MILL OD
      </text>
      {/* setup / labor / machine time toggles */}
      {pills.map((p, i) => {
        const x = 142 + i * 150;
        return (
          <g key={p.label}>
            <rect
              x={x}
              y={58}
              width={140}
              height={42}
              rx={21}
              fill={p.active ? "#EAF8FF" : "#FFFFFF"}
              stroke={p.active ? BRAND : LINE}
              strokeWidth={1.4}
            />
            <circle
              cx={x + 24}
              cy={79}
              r={6}
              fill={p.active ? BRAND : "none"}
              stroke={p.active ? BRAND : INK_45}
              strokeWidth={1.4}
            />
            <text x={x + 40} y={84} fontSize="14" fontWeight={530} fill={p.active ? BRAND_INK : INK}>
              {p.label}
            </text>
          </g>
        );
      })}
      {/* quantity actions */}
      {qty.map((q, i) => {
        const x = 142 + i * 150;
        return (
          <g key={q}>
            <rect x={x} y={114} width={140} height={38} rx={9} fill="#FFFFFF" stroke={LINE} strokeWidth={1.3} />
            <text x={x + 70} y={138} textAnchor="middle" fontSize="12.5" fontWeight={500} fill={INK_60}>
              {q}
            </text>
          </g>
        );
      })}
      {/* finish */}
      <rect x={142} y={166} width={440} height={40} rx={11} fill={INK} />
      <text x={362} y={191} textAnchor="middle" fontSize="14" fontWeight={560} fill="#F5F5F2">
        Finish
      </text>
    </svg>
  );
}

function IssueWorkflow() {
  const life = [
    { label: "Registered", x: 40, accent: false },
    { label: "In Progress", x: 285, accent: true },
    { label: "Closed", x: 530, accent: false },
  ];
  const actions = [
    { label: "Containment", floor: true },
    { label: "Corrective", floor: false },
    { label: "Preventive", floor: false },
    { label: "Verification", floor: false },
    { label: "Communication", floor: false },
  ];
  return (
    <svg viewBox="0 0 720 214" className="w-full h-auto" role="img" aria-label="Issue workflow and actions">
      {/* lifecycle */}
      {life.map((s, i) => (
        <g key={s.label}>
          {i > 0 && <Arrow x1={life[i - 1].x + 156} y1={43} x2={s.x - 6} y2={43} />}
          <Box x={s.x} y={20} w={150} h={46} label={s.label} accent={s.accent} />
        </g>
      ))}
      {/* connector from In Progress down to the action bar */}
      <g stroke={LINE} strokeWidth={1.4} fill="none">
        <path d="M 360 66 L 360 104 M 84 104 L 628 104" />
        {[84, 220, 356, 492, 628].map((x) => (
          <path key={x} d={`M ${x} 104 L ${x} 128`} />
        ))}
      </g>
      {/* required-action tasks */}
      {actions.map((a, i) => {
        const x = 20 + i * 136;
        return (
          <g key={a.label}>
            <rect
              x={x}
              y={128}
              width={128}
              height={42}
              rx={10}
              fill={a.floor ? "#FFF2D8" : "#FBFBF8"}
              stroke={a.floor ? TAG.bought.stroke : LINE}
              strokeWidth={1.4}
            />
            <text
              x={x + 64}
              y={154}
              textAnchor="middle"
              fontSize="11.5"
              fontWeight={530}
              fill={a.floor ? TAG.bought.text : INK}
            >
              {a.label}
            </text>
            {a.floor && (
              <text x={x + 64} y={186} textAnchor="middle" fontSize="10" fill={INK_45} fontFamily="var(--font-mono)">
                on the floor
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function ScheduleBoard() {
  const wc = [
    { name: "CNC", cards: ["Arm op", "Leg op"], accentLast: false },
    { name: "Deburr", cards: ["Arm op"], accentLast: false },
    { name: "Assembly", cards: ["Robot"], accentLast: true },
  ];
  const wk = [
    { name: "Wk 1", card: "Job · 30", accent: true },
    { name: "Wk 2", card: "Job · 30", accent: false },
    { name: "Wk 3", card: "Job · 30", accent: false },
  ];
  return (
    <svg viewBox="0 0 720 222" className="w-full h-auto" role="img" aria-label="Schedule boards by work center and by date">
      <text x={16} y={22} fontSize="11" fontWeight={600} fill={INK_45} fontFamily="var(--font-mono)">
        BY WORK CENTER
      </text>
      {wc.map((c, i) => {
        const x = 16 + i * 112;
        return (
          <g key={c.name}>
            <rect x={x} y={34} width={104} height={172} rx={9} fill="#F1F1EC" stroke={LINE} strokeWidth={1.2} />
            <text x={x + 52} y={52} textAnchor="middle" fontSize="11.5" fontWeight={530} fill={INK_60}>
              {c.name}
            </text>
            {c.cards.map((cd, j) => {
              const acc = c.accentLast && j === c.cards.length - 1;
              return (
                <g key={cd}>
                  <rect
                    x={x + 8}
                    y={64 + j * 40}
                    width={88}
                    height={32}
                    rx={7}
                    fill={acc ? "#EAF8FF" : "#FFFFFF"}
                    stroke={acc ? BRAND : LINE}
                    strokeWidth={1.3}
                  />
                  <text
                    x={x + 52}
                    y={84 + j * 40}
                    textAnchor="middle"
                    fontSize="11.5"
                    fontWeight={500}
                    fill={acc ? BRAND_INK : INK}
                  >
                    {cd}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })}
      <line x1={372} y1={18} x2={372} y2={208} stroke={LINE} strokeWidth={1.2} strokeDasharray="4 5" />
      <text x={388} y={22} fontSize="11" fontWeight={600} fill={INK_45} fontFamily="var(--font-mono)">
        BY DATE
      </text>
      {wk.map((c, i) => {
        const x = 388 + i * 110;
        return (
          <g key={c.name}>
            <rect x={x} y={34} width={104} height={172} rx={9} fill="#F1F1EC" stroke={LINE} strokeWidth={1.2} />
            <text x={x + 52} y={52} textAnchor="middle" fontSize="11.5" fontWeight={530} fill={INK_60}>
              {c.name}
            </text>
            <rect
              x={x + 8}
              y={64}
              width={88}
              height={36}
              rx={7}
              fill={c.accent ? "#EAF8FF" : "#FFFFFF"}
              stroke={c.accent ? BRAND : LINE}
              strokeWidth={1.3}
            />
            <text
              x={x + 52}
              y={86}
              textAnchor="middle"
              fontSize="11.5"
              fontWeight={500}
              fill={c.accent ? BRAND_INK : INK}
            >
              {c.card}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function GetMethod() {
  return (
    <svg viewBox="0 0 720 150" className="w-full h-auto" role="img" aria-label="Get Method copies the recipe into the job">
      <Box x={40} y={40} w={190} h={66} label="Part" sub="master method" />
      <Box x={490} y={40} w={190} h={66} label="Job" sub="working copy" accent />
      {/* copy down */}
      <Arrow x1={232} y1={62} x2={488} y2={62} />
      <text x={360} y={52} textAnchor="middle" fontSize="12" fontWeight={600} fill={BRAND_INK} fontFamily="var(--font-mono)">
        Get Method
      </text>
      {/* push proven change back up (dashed, reversed) */}
      <g stroke={INK_45} strokeWidth={1.4} fill="none">
        <line x1={488} y1={92} x2={238} y2={92} strokeDasharray="5 4" />
        <path d="M 248 87 L 238 92 L 248 97" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <text x={360} y={108} textAnchor="middle" fontSize="11" fill={INK_45}>
        push a proven change back up
      </text>
    </svg>
  );
}

function ConversionFactor() {
  const units = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  return (
    <svg viewBox="0 0 720 150" className="w-full h-auto" role="img" aria-label="Conversion factor turns a purchased box into stocked units">
      {/* purchased box */}
      <rect x={70} y={44} width={160} height={62} rx={10} fill="#FFF8EC" stroke={TAG.bought.stroke} strokeWidth={1.5} />
      <text x={150} y={72} textAnchor="middle" fontSize="15" fontWeight={530} fill={INK}>
        1 Box
      </text>
      <text x={150} y={90} textAnchor="middle" fontSize="11.5" fill={TAG.bought.text}>
        purchase unit
      </text>
      {/* conversion */}
      <Arrow x1={232} y1={75} x2={384} y2={75} />
      <text x={308} y={66} textAnchor="middle" fontSize="15" fontWeight={600} fill={BRAND_INK}>
        × 10
      </text>
      <text x={308} y={94} textAnchor="middle" fontSize="10.5" fill={INK_45} fontFamily="var(--font-mono)">
        conversion factor
      </text>
      {/* stocked units */}
      {units.map((n) => {
        const x = 410 + (n % 5) * 29;
        const y = 46 + Math.floor(n / 5) * 29;
        return <rect key={n} x={x} y={y} width={22} height={22} rx={5} fill="#EAF8FF" stroke={BRAND} strokeWidth={1.2} />;
      })}
      <line x1={404} y1={106} x2={560} y2={106} stroke={LINE} strokeWidth={1.6} />
      <text x={482} y={126} textAnchor="middle" fontSize="11.5" fill={INK_60}>
        10 Each · stocked
      </text>
    </svg>
  );
}

function OpportunityThread() {
  const docs = [
    { x: 20, label: "Sales RFQ", sub: "salesRfqId", accent: false },
    { x: 270, label: "Quote", sub: "quoteId", accent: false },
    { x: 520, label: "Sales order", sub: "salesOrderId", accent: true },
  ];
  return (
    <svg viewBox="0 0 720 200" className="w-full h-auto" role="img" aria-label="One opportunity threads RFQ, quote, and order">
      {/* the three documents, left to right */}
      <Arrow x1={200} y1={47} x2={268} y2={47} />
      <Arrow x1={450} y1={47} x2={518} y2={47} />
      {docs.map((d) => (
        <Box key={d.label} x={d.x} y={20} w={180} h={54} label={d.label} sub={d.sub} accent={d.accent} />
      ))}
      {/* dashed connectors down to the opportunity that holds all three */}
      <g stroke={LINE} strokeWidth={1.4} strokeDasharray="4 4" fill="none">
        {[110, 360, 610].map((x) => (
          <line key={x} x1={x} y1={74} x2={x} y2={130} />
        ))}
      </g>
      <Box x={20} y={130} w={680} h={50} label="Opportunity" sub="one thread — any slot can be empty" />
    </svg>
  );
}

function CashCycle() {
  const steps = [
    { x: 10, w: 160, label: "Sales order", sub: "To Ship and Invoice", accent: true },
    { x: 205, w: 150, label: "Shipment", sub: "Posted", accent: false },
    { x: 390, w: 150, label: "Invoice", sub: "Submitted", accent: false },
    { x: 575, w: 135, label: "Paid", sub: "datePaid set", accent: true },
  ];
  const gaps = [
    { x: 170, label: "post" },
    { x: 355, label: "bill" },
    { x: 540, label: "pay" },
  ];
  return (
    <svg viewBox="0 0 720 150" className="w-full h-auto" role="img" aria-label="Order to cash in four posted steps">
      {gaps.map((g) => (
        <g key={g.label}>
          <text x={g.x + 17} y={42} textAnchor="middle" fontSize="11" fontWeight={600} fill={BRAND_INK} fontFamily="var(--font-mono)">
            {g.label}
          </text>
          <Arrow x1={g.x} y1={78} x2={g.x + 33} y2={78} />
        </g>
      ))}
      {steps.map((s) => (
        <Box key={s.label} x={s.x} y={50} w={s.w} h={56} label={s.label} sub={s.sub} accent={s.accent} />
      ))}
      <text x={360} y={132} textAnchor="middle" fontSize="11.5" fill={INK_60}>
        Each step is its own posted move — none auto-chains.
      </text>
    </svg>
  );
}

function RfqFanout() {
  const quotes = [
    { y: 12, label: "Supplier A", sub: "$12.40 · 3 wk", win: false },
    { y: 82, label: "Supplier B", sub: "$11.80 · 2 wk", win: true },
    { y: 152, label: "Supplier C", sub: "$12.10 · 4 wk", win: false },
  ];
  return (
    <svg viewBox="0 0 720 212" className="w-full h-auto" role="img" aria-label="One RFQ fans out to supplier quotes, then converts the winner to a PO">
      <Box x={16} y={78} w={170} h={56} label="Purchasing RFQ" sub="one request" accent />
      {/* fan out to one supplier quote each */}
      <g stroke={LINE} strokeWidth={1.4} fill="none">
        {quotes.map((q) => (
          <path key={q.label} d={`M 186 106 C 250 106, 250 ${q.y + 24}, 300 ${q.y + 24}`} />
        ))}
      </g>
      {quotes.map((q) => (
        <g key={q.label}>
          <Box x={300} y={q.y} w={200} h={48} label={q.label} sub={q.sub} accent={q.win} />
          {q.win && <Tag x={444} y={q.y - 9} kind="made" label="chosen" />}
        </g>
      ))}
      {/* winner converts to the order */}
      <Arrow x1={500} y1={106} x2={556} y2={106} />
      <Box x={558} y={78} w={150} h={56} label="Purchase order" sub="from winner" accent />
    </svg>
  );
}

function ReceiveBillAxes() {
  const rows = [
    { tag: "RECEIVE", y: 24, post: "Receipt posts", postSub: "→ quantityReceived", flag: "Received ✓", flagSub: "receivedComplete" },
    { tag: "INVOICE", y: 128, post: "Bill posts", postSub: "→ quantityInvoiced", flag: "Invoiced ✓", flagSub: "invoicedComplete" },
  ];
  return (
    <svg viewBox="0 0 720 200" className="w-full h-auto" role="img" aria-label="A purchase order line tracked on two independent axes, received and invoiced">
      {rows.map((r) => (
        <g key={r.tag}>
          <text x={20} y={r.y - 6} fontSize="11" fontWeight={600} fill={INK_45} fontFamily="var(--font-mono)">
            {r.tag}
          </text>
          <Box x={20} y={r.y} w={200} h={52} label={r.post} sub={r.postSub} />
          <Arrow x1={220} y1={r.y + 26} x2={252} y2={r.y + 26} />
          <Box x={254} y={r.y} w={190} h={52} label={r.flag} sub={r.flagSub} />
        </g>
      ))}
      {/* both flags converge on the same line */}
      <g stroke={INK_45} strokeWidth={1.4} fill="none">
        <path d="M 444 50 C 500 50, 500 96, 538 100" />
        <path d="M 444 154 C 500 154, 500 124, 538 120" />
      </g>
      <Box x={540} y={82} w={168} h={56} label="Line completed" sub="both flags true" accent />
    </svg>
  );
}

function WipInflow() {
  return (
    <svg viewBox="0 0 720 180" className="w-full h-auto" role="img" aria-label="Two streams feed a job's work in process">
      <Box x={24} y={22} w={216} h={52} label="Material" sub="issued / backflushed" />
      <Box x={24} y={106} w={216} h={52} label="Labor & machine" sub="production events" />
      {/* both streams debit WIP */}
      <Arrow x1={240} y1={48} x2={426} y2={80} />
      <Arrow x1={240} y1={132} x2={426} y2={98} />
      <text x={336} y={58} textAnchor="middle" fontSize="10.5" fill={INK_45}>
        cost out of inventory
      </text>
      <text x={336} y={126} textAnchor="middle" fontSize="10.5" fill={INK_45}>
        hours × work-center rate
      </text>
      <Box x={428} y={56} w={244} h={66} label="Work in process" sub="a GL account balance" accent />
      <text x={550} y={140} textAnchor="middle" fontSize="11" fill={INK_60}>
        cleared when the job finishes
      </text>
    </svg>
  );
}

function WipToCogs() {
  const main = [
    { x: 16, label: "Work in process", sub: "job's balance", accent: true },
    { x: 246, label: "Inventory", sub: "finished goods", accent: false },
    { x: 466, label: "COGS", sub: "cost of goods sold", accent: false },
  ];
  return (
    <svg viewBox="0 0 720 200" className="w-full h-auto" role="img" aria-label="WIP flows to inventory, then to COGS; residual sweeps to variance at close">
      {/* finish → sell along the top */}
      <text x={220} y={50} textAnchor="middle" fontSize="11" fontWeight={600} fill={BRAND_INK} fontFamily="var(--font-mono)">finish</text>
      <Arrow x1={196} y1={63} x2={244} y2={63} />
      <text x={440} y={50} textAnchor="middle" fontSize="11" fontWeight={600} fill={BRAND_INK} fontFamily="var(--font-mono)">sell</text>
      <Arrow x1={416} y1={63} x2={464} y2={63} />
      {main.map((m) => (
        <Box key={m.label} x={m.x} y={34} w={m.x === 16 ? 180 : 170} h={58} label={m.label} sub={m.sub} accent={m.accent} />
      ))}
      {/* residual swept to variance at close */}
      <g stroke={INK_45} strokeWidth={1.4} fill="none">
        <line x1={106} y1={92} x2={106} y2={140} />
        <path d="M 101 130 L 106 140 L 111 130" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <text x={118} y={120} fontSize="10.5" fill={INK_45} fontFamily="var(--font-mono)">close</text>
      <Box x={16} y={140} w={230} h={52} label="Production Variance" sub="residual swept at close" />
    </svg>
  );
}

function DepreciationCurve() {
  const x0 = 96;
  const baseY = 200;
  const xEnd = 600;
  const costY = 44;
  const residualY = 168;
  return (
    <svg viewBox="0 0 720 240" className="w-full h-auto" role="img" aria-label="Net book value declining from cost to residual value">
      {/* axes */}
      <line x1={x0} y1={28} x2={x0} y2={baseY} stroke={LINE} strokeWidth={1.4} />
      <line x1={x0} y1={baseY} x2={664} y2={baseY} stroke={LINE} strokeWidth={1.4} />
      {/* residual floor */}
      <line x1={x0} y1={residualY} x2={xEnd} y2={residualY} stroke={INK_45} strokeWidth={1.2} strokeDasharray="5 4" />
      <text x={xEnd + 6} y={residualY + 4} fontSize="11.5" fill={INK_60}>residual value</text>
      {/* cost start */}
      <circle cx={x0} cy={costY} r={3.6} fill={INK} />
      <text x={x0 + 8} y={costY - 4} fontSize="11.5" fill={INK_60}>acquisition cost</text>
      {/* straight line */}
      <line x1={x0} y1={costY} x2={xEnd} y2={residualY} stroke={INK} strokeWidth={2} strokeLinecap="round" />
      {/* declining balance */}
      <path d={`M ${x0} ${costY} C 200 132, 360 164, ${xEnd} ${residualY}`} fill="none" stroke={BRAND} strokeWidth={2} strokeLinecap="round" />
      {/* legend */}
      <g>
        <line x1={360} y1={44} x2={384} y2={44} stroke={INK} strokeWidth={2} />
        <text x={392} y={48} fontSize="11.5" fill={INK_60}>Straight line</text>
        <line x1={500} y1={44} x2={524} y2={44} stroke={BRAND} strokeWidth={2} />
        <text x={532} y={48} fontSize="11.5" fill={INK_60}>Declining balance</text>
      </g>
      {/* axis labels */}
      <text x={x0 - 8} y={36} textAnchor="end" fontSize="11" fill={INK_45} fontFamily="var(--font-mono)" transform={`rotate(-90 ${x0 - 8} 36)`}>book value</text>
      <text x={x0 + 4} y={222} fontSize="11" fill={INK_45} fontFamily="var(--font-mono)">time →</text>
    </svg>
  );
}

function AssetExit() {
  return (
    <svg viewBox="0 0 720 210" className="w-full h-auto" role="img" aria-label="An asset leaves the books by sale or disposal">
      <Box x={20} y={76} w={190} h={58} label="Asset" sub="Active / Fully Depreciated" accent />
      {/* sell → sales order (money in) */}
      <text x={252} y={60} textAnchor="middle" fontSize="11" fontWeight={600} fill={BRAND_INK} fontFamily="var(--font-mono)">Sell</text>
      <Arrow x1={210} y1={92} x2={298} y2={56} />
      <Box x={300} y={30} w={230} h={52} label="Sales order" sub="drafted at net book value" />
      <Tag x={540} y={47} kind="made" label="money in" />
      {/* dispose → write-off (no proceeds) */}
      <text x={252} y={156} textAnchor="middle" fontSize="11" fontWeight={600} fill={INK_60} fontFamily="var(--font-mono)">Dispose</text>
      <Arrow x1={210} y1={118} x2={298} y2={158} />
      <Box x={300} y={140} w={230} h={52} label="Write-off" sub="remaining NBV → loss" />
      <Tag x={540} y={157} kind="neutral" label="retire" />
    </svg>
  );
}

export const illustrations: Record<IllustrationKey, () => React.ReactElement> = {
  "flow-overview": FlowOverview,
  "order-split": OrderSplit,
  "bom-tree": BomTree,
  "demand-forecast": DemandForecast,
  "planning-engine": PlanningEngine,
  "shopfloor-loop": ShopfloorLoop,
  "eight-d": EightD,
  "traceability-graph": TraceabilityGraph,
  "method-types": MethodTypes,
  "kit-vs-subassembly": KitVsSubassembly,
  "reorder-policy": ReorderPolicy,
  "outside-processing": OutsideProcessing,
  "mes-station": MesStation,
  "issue-workflow": IssueWorkflow,
  "schedule-board": ScheduleBoard,
  "get-method": GetMethod,
  "conversion-factor": ConversionFactor,
  "opportunity-thread": OpportunityThread,
  "cash-cycle": CashCycle,
  "rfq-fanout": RfqFanout,
  "receive-bill-axes": ReceiveBillAxes,
  "wip-inflow": WipInflow,
  "wip-to-cogs": WipToCogs,
  "depreciation-curve": DepreciationCurve,
  "asset-exit": AssetExit,
};
