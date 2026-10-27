// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

// The ghost that answers "boo" typed into search. Each haunting is a
// different ghost — its tint, its face and its size are drawn at random — and
// it comes in from a random edge, wanders across on a path of its own, lunges
// at the viewer halfway with a "boo!", and drifts out somewhere else. A cold
// chill gathers at the edges of the screen while it passes.
//
// Drawn like the garden spider (RealSpider.tsx): soft light, form from
// gradients and blur, no outlines. The sheet is translucent and its tail
// dissolves into mist. It never takes a click and is hidden from assistive
// technology; a reduced-motion user gets no ghost.

type Tint = { core: string; body: string; edge: string; glow: string };

const TINTS: Tint[] = [
  // Moonlight
  { core: "#ffffff", body: "#ebe6ff", edge: "#b3a6ee", glow: "#d6ccff" },
  // Spectral blue
  { core: "#f7fdff", body: "#d6effa", edge: "#86bfdc", glow: "#b4e3f7" },
  // Will-o'-the-wisp
  { core: "#f8fff9", body: "#d5f5e2", edge: "#7fcda2", glow: "#b2f1cd" },
  // Lilac
  { core: "#fffaff", body: "#f1e2fb", edge: "#c39ae0", glow: "#e6c9fa" }
];

type Face = "boo" | "wail" | "grin";
const FACES: Face[] = ["boo", "wail", "grin"];

// Facing right, the way it flies; head up front, the sheet trailing back.
const BODY = {
  a: "M 10 -92 C 48 -92 70 -62 68 -24 C 66 6 58 30 44 50 C 28 70 2 80 -26 86 C -50 92 -74 102 -104 112 C -88 100 -80 92 -76 84 C -96 88 -118 84 -134 74 C -112 68 -100 60 -92 50 C -108 44 -120 32 -126 20 C -98 24 -78 18 -62 8 C -54 -20 -48 -50 -34 -70 C -24 -84 -8 -92 10 -92 Z",
  b: "M 10 -92 C 48 -92 70 -62 68 -24 C 66 6 58 30 44 52 C 28 72 2 82 -26 90 C -50 98 -76 100 -108 102 C -90 94 -82 88 -78 80 C -98 80 -120 74 -136 62 C -114 60 -102 54 -94 44 C -110 36 -122 24 -126 10 C -98 16 -78 14 -62 6 C -54 -20 -48 -50 -34 -70 C -24 -84 -8 -92 10 -92 Z"
};
// Arms are lobes of the same sheet: wide where they leave the body, rounded
// at the end, so they read as cloth rather than sticks.
const FRONT_ARM = {
  a: "M 38 -46 C 54 -54 68 -64 76 -76 C 81 -84 93 -82 90 -71 C 84 -52 70 -34 50 -12 Z",
  b: "M 38 -46 C 56 -50 74 -56 86 -64 C 93 -69 102 -62 96 -53 C 86 -40 70 -28 50 -12 Z"
};
const BACK_ARM = {
  a: "M -26 -58 C -38 -66 -48 -76 -54 -86 C -59 -94 -70 -90 -66 -80 C -60 -62 -50 -44 -38 -24 Z",
  b: "M -26 -58 C -42 -62 -56 -70 -66 -80 C -73 -86 -82 -78 -76 -70 C -66 -56 -52 -42 -38 -24 Z"
};

/** A whole number from 0 up to, not including, `count`. */
function randomIndex(count: number) {
  // Bitwise OR truncates; the value is small and positive.
  return ((Math.random() * count) | 0) % count;
}

function pick<T>(list: readonly T[]): T {
  const item = list[randomIndex(list.length)];
  if (item === undefined) throw new Error("pick from an empty list");
  return item;
}

function Mouth({ face }: { face: Face }) {
  if (face === "boo") {
    return (
      <ellipse cx={24} cy={-22} rx={9} ry={12} fill="url(#ghost-void)">
        <animate
          attributeName="ry"
          values="12;16;12"
          dur="0.9s"
          repeatCount="indefinite"
        />
      </ellipse>
    );
  }
  if (face === "wail") {
    return (
      <path
        d="M 14 -26 C 14 -6 34 -6 34 -26 C 34 -32 14 -32 14 -26 Z"
        fill="url(#ghost-void)"
      >
        <animateTransform
          attributeName="transform"
          type="scale"
          values="1 1; 1 1.18; 1 1"
          dur="1.3s"
          repeatCount="indefinite"
          additive="sum"
        />
      </path>
    );
  }
  return (
    <path
      d="M 8 -28 Q 24 -12 40 -28 Q 24 -20 8 -28 Z"
      fill="url(#ghost-void)"
    />
  );
}

/** One ghost, drawn in its own frame (viewBox -150 -120 260 250). */
export function GhostFigure({
  tint = TINTS[0] as Tint,
  face = "boo"
}: {
  tint?: Tint;
  face?: Face;
}) {
  const uid = useId().replace(/:/g, "");
  const id = (name: string) => `${uid}-${name}`;
  return (
    <g>
      <defs>
        <radialGradient
          id={id("body")}
          cx={34}
          cy={-74}
          r={190}
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor={tint.core} />
          <stop offset="0.45" stopColor={tint.body} />
          <stop offset="1" stopColor={tint.edge} />
        </radialGradient>
        {/* The sheet thins out to nothing towards the end of the tail. */}
        <linearGradient
          id={id("fade")}
          x1="70"
          y1="-60"
          x2="-136"
          y2="100"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.55" stopColor="#ffffff" stopOpacity={0.85} />
          <stop offset="1" stopColor="#ffffff" stopOpacity={0} />
        </linearGradient>
        <mask id={id("mask")}>
          <rect
            x={-160}
            y={-130}
            width={280}
            height={270}
            fill={`url(#${id("fade")})`}
          />
        </mask>
        <radialGradient id={id("aura")} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={tint.glow} stopOpacity={0.55} />
          <stop offset="0.6" stopColor={tint.glow} stopOpacity={0.18} />
          <stop offset="1" stopColor={tint.glow} stopOpacity={0} />
        </radialGradient>
        <radialGradient id="ghost-void" cx="0.5" cy="0.4" r="0.6">
          <stop offset="0" stopColor="#05030a" />
          <stop offset="0.7" stopColor="#1b1030" />
          <stop offset="1" stopColor="#3a2a55" />
        </radialGradient>
        <filter id={id("soft")} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="12" />
        </filter>
        <filter id={id("shade")} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
        {/* Room for the blur all round, or the mist shows square edges. */}
        <filter
          id={id("mist")}
          x={-220}
          y={0}
          width={200}
          height={170}
          filterUnits="userSpaceOnUse"
          primitiveUnits="userSpaceOnUse"
        >
          <feGaussianBlur stdDeviation="8" />
        </filter>
        <filter id={id("feather")} x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="0.9" />
        </filter>
        <clipPath id={id("clip")}>
          <path d={BODY.a} />
        </clipPath>
      </defs>

      <animateTransform
        attributeName="transform"
        type="translate"
        values="0 0; 0 -10; 0 0"
        dur="2.4s"
        repeatCount="indefinite"
        calcMode="spline"
        keySplines="0.45 0 0.55 1; 0.45 0 0.55 1"
      />

      <ellipse cx={0} cy={0} rx={150} ry={140} fill={`url(#${id("aura")})`} />

      {/* Mist shed by the tail, drifting back and fading */}
      {[
        { cx: -128, cy: 92, r: 14, dur: "2.2s" },
        { cx: -146, cy: 60, r: 10, dur: "1.8s" },
        { cx: -118, cy: 116, r: 9, dur: "2.6s" }
      ].map((wisp) => (
        <circle
          key={wisp.cx}
          cx={wisp.cx}
          cy={wisp.cy}
          r={wisp.r}
          fill={tint.glow}
          opacity={0.5}
          filter={`url(#${id("mist")})`}
        >
          <animate
            attributeName="cx"
            values={`${wisp.cx};${wisp.cx - 30}`}
            dur={wisp.dur}
            repeatCount="indefinite"
          />
          <animate
            attributeName="opacity"
            values="0.55;0"
            dur={wisp.dur}
            repeatCount="indefinite"
          />
        </circle>
      ))}

      <g mask={`url(#${id("mask")})`}>
        {/* Glow: the body itself, blurred, behind it */}
        <path
          d={BODY.a}
          fill={tint.glow}
          opacity={0.75}
          filter={`url(#${id("soft")})`}
        />
        <path
          d={BACK_ARM.a}
          fill={`url(#${id("body")})`}
          opacity={0.9}
          filter={`url(#${id("feather")})`}
        >
          <animate
            attributeName="d"
            values={`${BACK_ARM.a};${BACK_ARM.b};${BACK_ARM.a}`}
            dur="1.1s"
            repeatCount="indefinite"
          />
        </path>
        <path
          d={BODY.a}
          fill={`url(#${id("body")})`}
          opacity={0.93}
          filter={`url(#${id("feather")})`}
        >
          <animate
            attributeName="d"
            values={`${BODY.a};${BODY.b};${BODY.a}`}
            dur="1.6s"
            repeatCount="indefinite"
          />
        </path>
        {/* Shade on the underside and in the folds, soft-edged */}
        <g clipPath={`url(#${id("clip")})`} filter={`url(#${id("shade")})`}>
          <ellipse
            cx={-40}
            cy={46}
            rx={70}
            ry={34}
            fill={tint.edge}
            opacity={0.55}
          />
          <path
            d="M -22 -24 Q -30 18 -54 54"
            stroke={tint.edge}
            strokeWidth={10}
            fill="none"
            opacity={0.5}
          />
          <path
            d="M 12 6 Q 14 40 -2 70"
            stroke={tint.edge}
            strokeWidth={8}
            fill="none"
            opacity={0.4}
          />
        </g>
        <ellipse
          cx={30}
          cy={-66}
          rx={22}
          ry={14}
          fill="#ffffff"
          opacity={0.55}
          filter={`url(#${id("shade")})`}
        />
        <path
          d={FRONT_ARM.a}
          fill={`url(#${id("body")})`}
          opacity={0.93}
          filter={`url(#${id("feather")})`}
        >
          <animate
            attributeName="d"
            values={`${FRONT_ARM.a};${FRONT_ARM.b};${FRONT_ARM.a}`}
            dur="0.9s"
            repeatCount="indefinite"
          />
        </path>
      </g>

      {/* Face */}
      <g filter={`url(#${id("feather")})`}>
        {[
          { cx: 10, cy: -56, rx: 7.5, ry: 11 },
          { cx: 36, cy: -54, rx: 7, ry: 10.5 }
        ].map((eye) => (
          <ellipse key={eye.cx} {...eye} fill="url(#ghost-void)">
            {/* Blinks now and then */}
            <animate
              attributeName="ry"
              values={`${eye.ry};${eye.ry};1.5;${eye.ry}`}
              keyTimes="0;0.9;0.95;1"
              dur="3.4s"
              repeatCount="indefinite"
            />
          </ellipse>
        ))}
        <Mouth face={face} />
        <ellipse
          cx={-6}
          cy={-36}
          rx={8}
          ry={4.5}
          fill="#ff9fbf"
          opacity={0.28}
        />
        <ellipse cx={50} cy={-34} rx={6} ry={4} fill="#ff9fbf" opacity={0.24} />
      </g>
      <circle cx={8} cy={-60} r={2.2} fill="#ffffff" opacity={0.85} />
      <circle cx={34} cy={-58} r={2} fill="#ffffff" opacity={0.85} />
    </g>
  );
}

type Point = { x: number; y: number };

/** A point just off a random edge of the screen. */
function offEdge(width: number, height: number, edge: number): Point {
  const margin = 220;
  switch (edge) {
    case 0:
      return { x: -margin, y: height * (0.2 + Math.random() * 0.6) };
    case 1:
      return { x: width + margin, y: height * (0.2 + Math.random() * 0.6) };
    case 2:
      return { x: width * (0.1 + Math.random() * 0.8), y: height + margin };
    default:
      return { x: width * (0.1 + Math.random() * 0.8), y: -margin };
  }
}

type Haunting = {
  id: number;
  tint: Tint;
  face: Face;
  size: number;
  x: number[];
  y: number[];
  scale: number[];
  rotate: number[];
  facing: number;
};

function newHaunting(id: number): Haunting {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const from = randomIndex(4);
  // Leave by any other edge.
  const to = (from + 1 + randomIndex(3)) % 4;
  const start = offEdge(width, height, from);
  const end = offEdge(width, height, to);
  const middle = Array.from({ length: 3 }, (_, i) => {
    const t = (i + 1) / 4;
    return {
      x: start.x + (end.x - start.x) * t + (Math.random() - 0.5) * width * 0.35,
      y: start.y + (end.y - start.y) * t + (Math.random() - 0.5) * height * 0.35
    };
  });
  const points = [start, ...middle, end].map((point) => ({
    x: Math.max(-260, Math.min(width + 260, point.x)),
    y: Math.max(-260, Math.min(height + 260, point.y))
  }));
  const size = 170 + Math.random() * 90;
  return {
    id,
    tint: pick(TINTS),
    face: pick(FACES),
    size,
    x: points.map((point) => point.x - size / 2),
    y: points.map((point) => point.y - size / 2),
    // The lunge: right at the viewer at the second waypoint.
    scale: [0.7, 1, 1.45, 1, 0.8],
    rotate: [-8, 6, -4, 8, 12],
    facing: end.x >= start.x ? 1 : -1
  };
}

// Search boxes only (the command palettes, any search field), so a field that
// really holds "boo" stays quiet.
const SEARCH_SELECTOR = '[cmdk-input], input[type="search"]';
// Typing "book" passes through "boo"; only a "boo" left alone counts.
const SETTLE_MS = 600;
const HAUNT_SECONDS = 5.6;

/** A ghost when someone types "boo" into search. */
export function BooGhost() {
  const still = useReducedMotion() ?? false;
  const [haunting, setHaunting] = useState<Haunting | null>(null);

  useEffect(() => {
    if (still) return;
    let timer = 0;
    let id = 0;
    const onInput = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (!target.matches(SEARCH_SELECTOR)) return;
      window.clearTimeout(timer);
      if (target.value.trim().toLowerCase() !== "boo") return;
      timer = window.setTimeout(() => {
        if (target.value.trim().toLowerCase() === "boo") {
          id += 1;
          setHaunting(newHaunting(id));
        }
      }, SETTLE_MS);
    };
    // Passive and read-only: the ghost never touches the event or the field.
    document.addEventListener("input", onInput, {
      capture: true,
      passive: true
    });
    return () => {
      document.removeEventListener("input", onInput, { capture: true });
      window.clearTimeout(timer);
    };
  }, [still]);

  if (!haunting) return null;
  return createPortal(
    <div key={haunting.id} aria-hidden className="pointer-events-none">
      {/* The chill: the edges of the screen frost over while it passes. */}
      <motion.div
        className="fixed inset-0 z-[999]"
        style={{
          background: `radial-gradient(ellipse at center, transparent 55%, ${haunting.tint.glow}55 100%)`
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 1, 1, 0] }}
        transition={{ duration: HAUNT_SECONDS, times: [0, 0.2, 0.7, 1] }}
      />
      <motion.svg
        viewBox="-150 -120 260 250"
        width={haunting.size}
        height={(haunting.size * 250) / 260}
        className="fixed left-0 top-0 z-[1000] overflow-visible"
        initial={{
          x: haunting.x[0],
          y: haunting.y[0],
          scale: haunting.scale[0],
          rotate: haunting.rotate[0],
          opacity: 0
        }}
        animate={{
          x: haunting.x,
          y: haunting.y,
          scale: haunting.scale,
          rotate: haunting.rotate,
          opacity: [0, 0.97, 0.97, 0.97, 0]
        }}
        transition={{
          duration: HAUNT_SECONDS,
          ease: "easeInOut",
          times: [0, 0.25, 0.5, 0.75, 1]
        }}
        onAnimationComplete={() => setHaunting(null)}
      >
        <g transform={`scale(${haunting.facing} 1)`}>
          <GhostFigure tint={haunting.tint} face={haunting.face} />
        </g>
      </motion.svg>
    </div>,
    document.body
  );
}
