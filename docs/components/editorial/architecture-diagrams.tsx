/* Hand-laid architecture diagrams for /docs/platform/architecture. See `architecture-kit.tsx`
 * for the shape vocabulary and why these are drawn by hand rather than generated.
 *
 * Editing one means moving coordinates. That is the trade: an auto-layout engine is
 * cheaper to edit and produces something no one can read in a reading column. Keep the
 * canvas near 740 units wide — it is what forces labels short enough to stay legible.
 *
 * Colour is spent, not sprinkled: most boxes are paper and hairline, and a tone is used
 * only where it carries the point of that particular diagram. */

import type { ReactElement } from "react";
import {
  ArrowDefs,
  Badge,
  Boundary,
  Card,
  Edge,
  Eyebrow,
  INK,
  INK_45,
  Lines,
  LINE,
  Node,
  Store,
} from "./architecture-kit";

export type ArchitectureDiagramKey = "map" | "click" | "doors" | "paths" | "events" | "runs" | "triage";

/* Part 1. The spine only: people, the two apps, Supabase over Postgres, and the event
 * loop back into the ERP. Redis and the Assembler are deliberately absent — they are
 * side services, the prose covers them, and drawing them buried the loop that matters. */
function Map() {
  const chips = [
    { x: 34, w: 112, label: "PostgREST" },
    { x: 158, w: 82, label: "Auth" },
    { x: 252, w: 94, label: "Storage" },
    { x: 358, w: 98, label: "Realtime" },
    { x: 468, w: 158, label: "Edge functions" },
  ];
  return (
    <svg viewBox="0 0 740 596" className="w-full h-auto" role="img" aria-label="How Carbon fits together">
      <ArrowDefs />

      <Card x={16} y={14} w={190} h={48} label="Shop floor" sub="tablet" />
      <Card x={236} y={14} w={190} h={48} label="Office staff" sub="browser" />
      <Card x={456} y={14} w={190} h={48} label="Customer" sub="share link" />

      <Edge pts={[[111, 69], [111, 112], [181, 112], [181, 128]]} />
      <Edge pts={[[331, 69], [331, 112], [451, 112], [451, 128]]} />
      <Edge pts={[[551, 69], [551, 112], [511, 112], [511, 128]]} />

      <Boundary x={16} y={100} w={630} h={100} label="Carbon" />
      <Node x={56} y={128} w={250} h={56} label="MES" sub="the shop floor app" tone="app" />
      <Node x={356} y={128} w={250} h={56} label="ERP" sub="the office app, and where jobs run" tone="app" />

      <Edge pts={[[181, 184], [181, 240]]} />
      <Edge pts={[[481, 184], [481, 240]]} label="every read and write" labelAt={[331, 214]} />

      <Boundary x={16} y={240} w={630} h={250} label="Supabase" />
      {chips.map((c) => (
        <Node key={c.label} x={c.x} y={272} w={c.w} h={42} label={c.label} />
      ))}
      {chips.map((c) => (
        <path key={c.label} d={`M ${c.x + c.w / 2} 314 V 340`} fill="none" stroke="rgba(38,35,35,0.35)" strokeWidth={1.1} />
      ))}
      <path d="M 90 340 H 547" fill="none" stroke="rgba(38,35,35,0.35)" strokeWidth={1.1} />
      <Edge pts={[[331, 340], [331, 372]]} soft />

      <Store x={251} y={372} w={160} h={76} label="Postgres" sub="the source of truth" />

      <Edge pts={[[331, 448], [331, 508], [436, 508], [436, 522]]} label="subscribed writes queue an event" labelAt={[383, 502]} />

      <Node x={336} y={522} w={200} h={56} label="Inngest" sub="background jobs" tone="async" />
      <Node x={56} y={522} w={200} h={56} label="Outside world" sub="email, Slack, Xero" />

      <Edge pts={[[336, 550], [256, 550]]} />
      <Edge pts={[[536, 550], [690, 550], [690, 156], [606, 156]]} label="runs the job in the ERP" labelAt={[613, 538]} />
    </svg>
  );
}

/* Part 2, the short version. The section promises "pick this apart and you have seen
 * every layer", so the layers have to be IN the picture — they are the three lanes, and
 * every hop visibly crosses one. A flat list of the same steps reads as prose, not a
 * diagram; short hop labels are what keep this one readable. */
function Click() {
  const L = { browser: 140, erp: 390, pg: 620 };
  type Hop = { from: number; to: number; label: string; back?: boolean; note?: boolean };
  const hops: Hop[] = [
    { from: L.browser, to: L.browser, label: "the form is checked against a zod schema" },
    { from: L.browser, to: L.erp, label: "POST the fields" },
    { from: L.erp, to: L.erp, label: "a POST? and may this user create purchasing?" },
    { from: L.erp, to: L.pg, label: "ask for the next order number" },
    { from: L.pg, to: L.erp, label: '"PO000123"', back: true },
    { from: L.erp, to: L.pg, label: "insert the order, delivery and payment rows" },
    { from: L.pg, to: L.pg, label: "a trigger quietly queues an event", note: true },
    { from: L.pg, to: L.erp, label: "the new row id", back: true },
    { from: L.erp, to: L.browser, label: "302 redirect to the new order's page", back: true },
    { from: L.browser, to: L.erp, label: "GET that page — the loader runs" },
    { from: L.erp, to: L.pg, label: "read the purchaseOrders view" },
    { from: L.pg, to: L.erp, label: "the order, with totals already calculated", back: true },
    { from: L.erp, to: L.browser, label: "the finished page", back: true },
  ];

  const top = 108;
  const pitch = 42;
  const ruleY = top + hops.length * pitch + 6;
  const h = ruleY + 104;

  return (
    <svg viewBox={`0 0 740 ${h}`} className="w-full h-auto" role="img" aria-label="One click, all the way down">
      <ArrowDefs />

      <Card x={55} y={22} w={170} h={46} label="Browser" />
      <Node x={305} y={22} w={170} h={46} label="ERP server" tone="app" />
      <Node x={535} y={22} w={170} h={46} label="Postgres" tone="data" />

      {Object.values(L).map((x) => (
        <path key={x} d={`M ${x} 74 V ${ruleY - 10}`} stroke={LINE} strokeWidth={1.2} fill="none" />
      ))}

      <Eyebrow x={16} y={top - 24} label="The save" />
      <Eyebrow x={16} y={top + 8 * pitch - 14} label="The redirect" />

      {hops.map((hop, i) => {
        const y = top + i * pitch;
        if (hop.from === hop.to) {
          // Self-hop: a small loop hanging off the right of the lane, so work that happens
          // inside one layer still reads as a beat in the sequence.
          // The rightmost lane loops to its left, or the label runs off the canvas.
          const flip = hop.from > 500;
          const d = flip
            ? `M ${hop.from} ${y - 9} h -22 a 9 9 0 0 0 0 18 h 22`
            : `M ${hop.from} ${y - 9} h 22 a 9 9 0 0 1 0 18 h -22`;
          return (
            <g key={hop.label}>
              <path
                d={d}
                fill="none"
                stroke={hop.note ? "#EDA100" : "rgba(38,35,35,0.45)"}
                strokeWidth={1.3}
                markerEnd={hop.note ? undefined : "url(#ah)"}
              />
              <text
                x={flip ? hop.from - 40 : hop.from + 40}
                y={y + 13}
                textAnchor={flip ? "end" : "start"}
                fontSize="11"
                fill={hop.note ? "#8A6000" : INK}
              >
                {hop.label}
              </text>
            </g>
          );
        }
        const mid = (hop.from + hop.to) / 2;
        return (
          <g key={hop.label}>
            <Edge pts={[[hop.from, y], [hop.to, y]]} soft={hop.back} dashed={hop.back} />
            <text x={mid} y={y - 8} textAnchor="middle" fontSize="11" fill={hop.back ? INK_45 : INK}>
              {hop.label}
            </text>
          </g>
        );
      })}

      <path d={`M 16 ${ruleY} H 724`} stroke={LINE} strokeWidth={1.2} strokeDasharray="5 5" fill="none" />
      <text x={724} y={ruleY - 10} textAnchor="end" fontSize="10.5" fill={INK_45}>
        the user's request is finished here
      </text>

      <Eyebrow x={16} y={ruleY + 30} label="Later, on its own" />
      <Edge pts={[[L.pg, ruleY + 10], [L.pg, ruleY + 52]]} dashed soft />
      <Node x={490} y={ruleY + 52} w={215} h={46} label="Background job" sub="indexes the order for search" tone="async" />
      <Lines x={16} y={ruleY + 54} lines={["Nobody waited for this. The page", "had already rendered."]} size={11} />
    </svg>
  );
}

/* Part 3.3. The four doors, as columns rather than a flowchart — the thing a reader needs
 * is a side-by-side comparison of what each one does about RLS, and columns give that for
 * free. The badge row is the answer; the arrows are just plumbing. */
function Doors() {
  const doors = [
    { x: 16, label: "supabase-js", sub: "user scoped", rls: "rules ON", tone: "svc" as const, why: "the default" },
    { x: 196, label: "supabase-js", sub: "service role", rls: "rules OFF", tone: "async" as const, why: "needs to see everything" },
    { x: 376, label: "Kysely", sub: "direct SQL", rls: "rules OFF", tone: "async" as const, why: "needs a real transaction" },
    { x: 556, label: "Edge function", sub: "Deno", rls: "rules OFF", tone: "async" as const, why: "heavy set-based work" },
  ];
  const w = 168;
  return (
    <svg viewBox="0 0 740 486" className="w-full h-auto" role="img" aria-label="Four ways into the database">
      <ArrowDefs />
      <Node x={270} y={16} w={200} h={52} label="Server code" sub="loader, action, or job" tone="app" />

      {doors.map((d) => {
        const cx = d.x + w / 2;
        return (
          <g key={d.sub}>
            <Edge pts={[[370, 68], [370, 94], [cx, 94], [cx, 118]]} soft />
            <Node x={d.x} y={118} w={w} h={58} label={d.label} sub={d.sub} />
            <Badge x={cx} y={190} label={d.rls} tone={d.tone} />
            <text x={cx} y={228} textAnchor="middle" fontSize="11" fill={INK_45}>
              {d.why}
            </text>
          </g>
        );
      })}

      <Edge pts={[[100, 240], [100, 268], [188, 268], [188, 292]]} soft />
      <Edge pts={[[280, 240], [280, 268], [188, 268]]} soft />
      <Node x={108} y={292} w={160} h={46} label="PostgREST" />

      <Edge pts={[[188, 338], [188, 380], [370, 380], [370, 404]]} />
      <Edge pts={[[460, 240], [460, 380], [370, 380]]} />
      <Edge pts={[[640, 240], [640, 380], [370, 380]]} />

      <Store x={290} y={404} w={160} h={72} label="Postgres" />
    </svg>
  );
}

/* Part 3.4. Two rails, deliberately parallel, because the point is that they are separate
 * paths over the same data — writes land in a table, reads come back through a view. */
function Paths() {
  return (
    <svg viewBox="0 0 740 292" className="w-full h-auto" role="img" aria-label="Write path and read path">
      <ArrowDefs />

      <Boundary x={16} y={26} w={708} h={92} label="Write path" />
      <Node x={48} y={54} w={140} h={44} label="action" tone="app" />
      <Edge pts={[[188, 76], [248, 76]]} />
      <Node x={248} y={54} w={180} h={44} label="service upsert" tone="app" />
      <Edge pts={[[428, 76], [488, 76]]} />
      <Node x={488} y={54} w={200} h={44} label="purchaseOrder table" tone="data" />

      <Boundary x={16} y={174} w={708} h={92} label="Read path" />
      <Node x={48} y={202} w={140} h={44} label="loader" tone="app" />
      <Edge pts={[[188, 224], [248, 224]]} />
      <Node x={248} y={202} w={180} h={44} label="service get" tone="app" />
      <Edge pts={[[428, 224], [488, 224]]} />
      <Node x={488} y={202} w={200} h={44} label="purchaseOrders view" tone="data" />

      <Edge pts={[[588, 98], [588, 202]]} dashed soft label="the view reads the table, and joins the rest" labelAt={[588, 150]} />
    </svg>
  );
}

/* Part 4. The chain nothing in the calling code can see. Two things earn their space: the
 * trigger and the queue sit inside Postgres (which is why the enqueue is transactional),
 * and the fan-out at the bottom shows what a subscribed write actually costs. The top node
 * must keep saying "opted-in tables" — only ~90 carry the trigger, and even those enqueue
 * nothing without an active eventSystemSubscription for that company and operation. */
function Events() {
  const handlers = ["Search", "Workflows", "Webhooks", "Audit log", "Sync", "Embeddings"];
  const hw = 108;
  const hgap = 12;
  const hx = (i: number) => 20 + i * (hw + hgap);
  return (
    <svg viewBox="0 0 740 660" className="w-full h-auto" role="img" aria-label="What happens after a write">
      <ArrowDefs />

      <Node x={215} y={14} w={310} h={56} label="A write" sub="to one of the ~90 opted-in tables" tone="app" />
      <Edge pts={[[370, 70], [370, 104]]} />

      <Boundary x={16} y={104} w={708} h={210} label="Inside Postgres" />
      <Node x={215} y={132} w={310} h={56} label="Trigger" sub="dispatch_event_batch, same transaction" tone="data" />
      <Edge pts={[[290, 188], [290, 216], [170, 216], [170, 232]]} soft label="one per matching subscription" labelAt={[196, 210]} />
      <Edge pts={[[450, 188], [450, 216], [570, 216], [570, 240]]} soft />
      <Store x={80} y={232} w={180} h={68} label="PGMQ" sub="a queue, in tables" />
      <Node x={455} y={240} w={230} h={52} label="wake_event_queue" sub="an HTTP ping after commit" tone="data" />

      <Edge pts={[[570, 292], [570, 340]]} label="pg_net" labelAt={[600, 320]} />
      <Node x={475} y={340} w={190} h={48} label="event-wake" sub="edge function" tone="svc" />
      <Edge pts={[[570, 388], [570, 424]]} />
      <Node x={485} y={424} w={170} h={48} label="Inngest" tone="async" />
      <Edge pts={[[570, 472], [570, 500], [495, 500]]} label="POSTs /api/inngest" labelAt={[600, 494]} />

      <Node x={245} y={474} w={250} h={52} label="event-queue job" sub="drains the queue, groups by type" tone="async" />
      <Edge pts={[[170, 300], [170, 500], [245, 500]]} soft label="reads a batch" labelAt={[170, 440]} />

      {handlers.map((h, i) => (
        <g key={h}>
          <Edge pts={[[370, 526], [370, 554], [hx(i) + hw / 2, 554], [hx(i) + hw / 2, 578]]} soft />
          <Node x={hx(i)} y={578} w={hw} h={44} label={h} />
        </g>
      ))}
    </svg>
  );
}

/* Part 7. Three shapes of the same code base, stacked in the order a change travels
 * through them. The two arrows crossing from CI into AWS are the only real coupling. */
function Runs() {
  const wf = [
    { label: "check.yml", sub: "lint, types, tests" },
    { label: "deploy.yml", sub: "build and push images" },
    { label: "supabase.yml", sub: "migrations, edge fns" },
    { label: "inngest.yml", sub: "register jobs" },
  ];
  const ww = 164;
  return (
    <svg viewBox="0 0 740 566" className="w-full h-auto" role="img" aria-label="Where Carbon runs">
      <ArrowDefs />

      <Boundary x={16} y={22} w={708} h={168} label="Your laptop" />
      <Node x={44} y={78} w={180} h={56} label="pnpm dev" sub="the crbn CLI" tone="app" />
      <Edge pts={[[224, 92], [268, 92], [268, 74], [300, 74]]} soft />
      <Edge pts={[[224, 120], [268, 120], [268, 148], [300, 148]]} soft />
      <Node x={300} y={48} w={250} h={52} label="Docker stack" sub="Postgres, Supabase, Inngest" tone="app" />
      <Node x={300} y={122} w={250} h={52} label="Vite" sub="ERP and MES, on the host" tone="app" />
      <Edge pts={[[550, 148], [612, 148], [612, 74], [550, 74]]} soft />

      <Boundary x={16} y={232} w={708} h={110} label="GitHub Actions, on merge to main" />
      {wf.map((w, i) => (
        <Node key={w.label} x={32 + i * (ww + 12)} y={266} w={ww} h={54} label={w.label} sub={w.sub} tone="async" />
      ))}

      <Boundary x={16} y={392} w={708} h={152} label="AWS, one stack per customer" />
      <Node x={44} y={434} w={176} h={56} label="Load balancer" sub="plus WAF limits" tone="app" />
      <Edge pts={[[220, 462], [268, 462]]} />
      <Node x={268} y={434} w={200} h={56} label="ECS Fargate" sub="ERP and MES, 1 to 10" tone="app" />
      <Edge pts={[[468, 462], [516, 462]]} />
      <Store x={516} y={428} w={180} h={68} label="Supabase" sub="managed Postgres" />

      <Edge pts={[[290, 320], [290, 366], [368, 366], [368, 434]]} soft />
      <Edge pts={[[466, 320], [466, 366], [606, 366], [606, 428]]} soft />
    </svg>
  );
}

/* Part 8. A reader arrives knowing their symptom, not their position in a decision tree,
 * so this is three columns and no branching — you find your symptom and read down. */
type TriageColumn = { x: number; head: string; symptoms: { name: string; answer: string[] }[] };

const TRIAGE: TriageColumn[] = [
  {
    x: 16,
    head: "The save failed",
    symptoms: [
      { name: "Red text under a field", answer: ["The zod schema rejected it.", "Open {module}.models.ts"] },
      { name: "A red toast at the top", answer: ["The action's error branch,", "then the service function"] },
      {
        name: "Nothing happened at all",
        answer: ["Check the Network tab. No request", "is the browser validator; a 403", "is requirePermissions"],
      },
    ],
  },
  {
    x: 256,
    head: "The data is wrong",
    symptoms: [
      {
        name: "Wrong in the database too",
        answer: ["The write is wrong. Read the", "service function, then any", "trigger on that table"],
      },
      { name: "Right in the database", answer: ["Is the field computed? Totals", "live in the VIEW, not the table"] },
      { name: "Not computed either", answer: ["Then it is the loader,", "or the component"] },
    ],
  },
  {
    x: 496,
    head: "Nothing happened after",
    symptoms: [
      {
        name: "No email, not in search, no sync",
        answer: ["That is the event pipeline.", "Open the Inngest dashboard,", "find the run, read the failed step"],
      },
    ],
  },
];

const TRIAGE_COL_W = 228;
const TRIAGE_LINE_H = 14;

/* Stack each column's symptoms top-down, so a block's y depends only on the heights of
 * the ones above it rather than on a counter mutated during render. */
function stackSymptoms(symptoms: TriageColumn["symptoms"], from: number) {
  let y = from;
  return symptoms.map((s) => {
    const top = y + 22;
    y = top + (s.answer.length - 1) * TRIAGE_LINE_H + 26;
    return { ...s, top };
  });
}

function Triage() {
  return (
    <svg viewBox="0 0 740 412" className="w-full h-auto" role="img" aria-label="Where to look when something is wrong">
      <ArrowDefs />
      <Node x={245} y={14} w={250} h={48} label="Something is wrong" tone="app" />
      {TRIAGE.map((col) => {
        const cx = col.x + TRIAGE_COL_W / 2;
        return (
          <g key={col.head}>
            <Edge pts={[[370, 62], [370, 88], [cx, 88], [cx, 110]]} soft />
            <Node x={col.x} y={110} w={TRIAGE_COL_W} h={42} label={col.head} />
            {stackSymptoms(col.symptoms, 152).map((s) => (
              <g key={s.name}>
                <path
                  d={`M ${col.x + 10} ${s.top - 12} V ${s.top + (s.answer.length - 1) * TRIAGE_LINE_H + 6}`}
                  stroke={LINE}
                  strokeWidth={1.2}
                  fill="none"
                />
                <text x={col.x + 22} y={s.top - 2} fontSize="11.5" fontWeight={560} fill={INK}>
                  {s.name}
                </text>
                <Lines x={col.x + 22} y={s.top + 16} lines={s.answer} size={11} />
              </g>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

export const architectureDiagrams: Record<ArchitectureDiagramKey, () => ReactElement> = {
  map: Map,
  click: Click,
  doors: Doors,
  paths: Paths,
  events: Events,
  runs: Runs,
  triage: Triage,
};
