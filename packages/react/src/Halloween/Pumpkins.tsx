// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Transition } from "motion/react";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { seeded } from "./math";
import { Loop, LoopTransform, SCENE_ORIGIN, useStill } from "./scene-loops";

// Three jack-o'-lanterns, each with its own entrance and its own temper.
//
// The big one falls out of the sky, squashes on landing and kicks up dust;
// once lit it rocks back and cackles. The middle one bursts up out of the
// ground, throwing dirt, and sways. The small one rolls in from the right,
// rocks to a stop, and hops now and then.
//
// They all arrive dark and are lit one by one: a spark, a sputter, then a
// steady flame whose hot spot drifts about inside the carving. Smoke curls
// from the lid and embers float up.
//
// Each lantern is drawn in its own space: the base sits on y 0, the body is a
// little over 110 tall, centred around y -45.

type Entrance = "drop" | "rise" | "roll";
type Temper = "cackle" | "sway" | "hop";

type Lantern = {
  id: string;
  x: number;
  y: number;
  size: number;
  entrance: Entrance;
  enterAt: number;
  lightAt: number;
  temper: Temper;
  /** Seconds per flicker cycle. */
  flicker: number;
};

const DROP_DURATION = 1.05;
// Far enough that the lantern starts above the top of the screen.
const DROP_HEIGHT = 1000;
// Where in the drop the lantern hits the ground.
const DROP_IMPACT = 0.42;
const RISE_DURATION = 0.95;
const ROLL_DURATION = 1.45;
const ROLL_FROM_X = 1720;
const CENTRE_Y = -45;
const RADIUS = 45;

// Drawn back to front: the small one rolls to a stop in front of the middle one.
const LANTERNS: Lantern[] = [
  {
    id: "middle",
    x: 1128,
    y: 850,
    size: 0.95,
    entrance: "rise",
    enterAt: 1.8,
    lightAt: 2.75,
    temper: "sway",
    flicker: 1.3
  },
  {
    id: "small",
    x: 1222,
    y: 862,
    size: 0.66,
    entrance: "roll",
    enterAt: 2.3,
    lightAt: 3.95,
    temper: "hop",
    flicker: 2.1
  },
  {
    id: "big",
    x: 560,
    y: 846,
    size: 1.3,
    entrance: "drop",
    enterAt: 0.95,
    lightAt: 2.1,
    temper: "cackle",
    flicker: 1.7
  }
];

/** When the falling lantern hits the ground: the whole scene thuds. */
export const LANTERN_THUD_AT =
  (LANTERNS.find((lantern) => lantern.entrance === "drop")?.enterAt ?? 0) +
  DROP_DURATION * DROP_IMPACT;

const RIBS = [
  { id: "outer-left", cx: -40, cy: -44, rx: 30, ry: 41 },
  { id: "outer-right", cx: 40, cy: -44, rx: 30, ry: 41 },
  { id: "inner-left", cx: -19, cy: -45, rx: 32, ry: 44 },
  { id: "inner-right", cx: 19, cy: -45, rx: 32, ry: 44 },
  { id: "centre", cx: 0, cy: -46, rx: 26, ry: 45 }
];

const EYES_AND_NOSE = [
  "M -34 -58 L -12 -56 L -24 -76 Z",
  "M 34 -58 L 12 -56 L 24 -76 Z",
  "M -6 -43 L 6 -43 L 0 -53 Z"
];

// The carved mouth, teeth included: a jack-o'-lantern's teeth are uncut
// pumpkin, so the hole's outline goes round them and they move with the lips.
// Each lip is one quadratic from corner to corner; the teeth are cut into it
// by splitting that curve exactly, so every mouth has the same commands and
// SMIL can morph shut → half → wide.
const MOUTH_HALF_WIDTH = 42;
// [from x, tip x, to x, tip length]: hanging from the upper lip…
const UPPER_TEETH = [
  [-12, -8, -4, 8.5],
  [14, 18, 22, 7.5]
] as const;
// …and standing on the lower lip, listed right to left as it is drawn.
const LOWER_TEETH = [
  [10, 6, 2, 7.5],
  [-19, -22.5, -26, 6.5]
] as const;

function mouthPath(corner: number, upper: number, lower: number) {
  const w = MOUTH_HALF_WIDTH;
  // A lip through (-w, corner), (0, middle), (w, corner).
  const lip = (middle: number) => {
    const control = 2 * middle - corner;
    const tAt = (x: number) => (x / w + 1) / 2;
    const at = (t: number) =>
      (1 - t) * (1 - t) * corner + 2 * (1 - t) * t * control + t * t * corner;
    // The quadratic from x0 to x1, as its own control point.
    const span = (x0: number, x1: number) => {
      const t0 = tAt(x0);
      const t1 = tAt(x1);
      const slope =
        2 * (1 - t0) * (control - corner) + 2 * t0 * (corner - control);
      const cx = x0 + (x1 - x0) / 2;
      const cy = at(t0) + ((t1 - t0) * slope) / 2;
      return `Q ${cx} ${cy} ${x1} ${at(t1)}`;
    };
    return { y: (x: number) => at(tAt(x)), span };
  };
  const top = lip(upper);
  const bottom = lip(lower);

  let d = `M ${-w} ${corner}`;
  let x = -w;
  for (const [from, tip, to, length] of UPPER_TEETH) {
    d += ` ${top.span(x, from)} L ${tip} ${top.y(tip) + length} L ${to} ${top.y(to)}`;
    x = to;
  }
  d += ` ${top.span(x, w)}`;
  x = w;
  for (const [from, tip, to, length] of LOWER_TEETH) {
    d += ` ${bottom.span(x, from)} L ${tip} ${bottom.y(tip) - length} L ${to} ${bottom.y(to)}`;
    x = to;
  }
  return `${d} ${bottom.span(x, -w)} Z`;
}

export const MOUTH = {
  shut: mouthPath(-33, -26, -9),
  half: mouthPath(-34, -28, -2),
  wide: mouthPath(-35, -31, 6)
};

// A cackle: three quick "ha"s every few seconds, the body rocking with them.
const CACKLE = {
  dur: "3.8s",
  keyTimes: "0;0.6;0.65;0.7;0.75;0.8;0.85;0.92;1",
  mouth: [
    MOUTH.shut,
    MOUTH.shut,
    MOUTH.wide,
    MOUTH.half,
    MOUTH.wide,
    MOUTH.half,
    MOUTH.wide,
    MOUTH.shut,
    MOUTH.shut
  ].join(";"),
  rock: "0;0;-4;3;-4;3;-3;0;0"
};

const SMOKE = {
  a: "M 6 -112 C -6 -132, 16 -150, 2 -172 S -12 -206, 8 -236",
  b: "M 6 -112 C 18 -132, -6 -152, 8 -174 S 16 -206, -4 -236"
};

type Particle = { id: string; dx: number; dy: number; r: number };

function particles(seed: number, count: number, spread: number): Particle[] {
  const rand = seeded(seed);
  return Array.from({ length: count }, (_, i) => {
    const side = i % 2 === 0 ? -1 : 1;
    return {
      id: `p-${seed}-${i}`,
      dx: side * (spread * 0.35 + rand() * spread),
      dy: 18 + rand() * 46,
      r: 2.4 + rand() * 3.2
    };
  });
}

const DUST = particles(7, 9, 90);
const DIRT = particles(11, 10, 70);

export function JackOLanterns() {
  return (
    <g>
      <defs>
        <linearGradient
          id="hw-smoke"
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1="-112"
          x2="0"
          y2="-236"
        >
          <stop offset="0" stopColor="#ddd4f2" stopOpacity={0.45} />
          <stop offset="1" stopColor="#ddd4f2" stopOpacity={0} />
        </linearGradient>
        <filter
          id="hw-smoke-soft"
          x="-100%"
          y="-10%"
          width="300%"
          height="120%"
        >
          <feGaussianBlur stdDeviation="1.8" />
        </filter>
      </defs>
      {LANTERNS.map((lantern) => (
        <JackOLantern key={lantern.id} lantern={lantern} />
      ))}
    </g>
  );
}

function JackOLantern({ lantern }: { lantern: Lantern }) {
  const { id, x, y, size, entrance, lightAt, flicker } = lantern;
  const candle = `hw-candle-${id}`;
  const ground = `hw-ground-${id}`;
  const place = `translate(${x} ${y}) scale(${size})`;

  return (
    <g>
      <defs>
        {/* The candle's hot spot wanders as the flame moves. */}
        <radialGradient id={candle} cx="0.5" cy="0.55" r="0.66">
          <Loop
            attributeName="cx"
            values="0.44;0.58;0.47;0.55;0.44"
            dur={`${flicker * 1.9}s`}
          />
          <Loop
            attributeName="cy"
            values="0.58;0.5;0.56;0.48;0.58"
            dur={`${flicker * 2.3}s`}
          />
          <stop offset="0" stopColor="#fffde6" />
          <stop offset="0.3" stopColor="#ffe680" />
          <stop offset="0.75" stopColor="#ff9d1c" />
          <stop offset="1" stopColor="#d9530a" />
        </radialGradient>
        <clipPath id={ground}>
          <rect x={x - 220} y={y - 420} width={440} height={426} />
        </clipPath>
      </defs>

      {/* Candlelight pooled on the ground */}
      <g transform={place}>
        <Lit at={lightAt}>
          <ellipse cx={0} cy={-2} rx={140} ry={32} fill="url(#hw-floor-glow)">
            <Loop
              attributeName="opacity"
              values="1;0.75;0.95;0.62;1;0.85;1"
              dur={`${flicker}s`}
            />
          </ellipse>
        </Lit>
      </g>

      {entrance === "rise" ? (
        <g clipPath={`url(#${ground})`}>
          <Entrance lantern={lantern} />
        </g>
      ) : (
        <Entrance lantern={lantern} />
      )}

      {entrance === "drop" && (
        <Burst
          place={place}
          at={lantern.enterAt + DROP_DURATION * DROP_IMPACT}
          bits={DUST}
          fill="#4a3a63"
          height={0.5}
        />
      )}
      {entrance === "rise" && (
        <Burst
          place={place}
          at={lantern.enterAt + 0.05}
          bits={DIRT}
          fill="#1c1128"
          height={1.4}
        />
      )}
    </g>
  );
}

/** Fades in with a candle's sputter: catches, gutters, catches again. */
function Lit({ at, children }: { at: number; children: ReactNode }) {
  const still = useStill();
  return (
    <motion.g
      initial={still ? false : { opacity: 0 }}
      animate={{ opacity: [0, 0.9, 0.12, 1, 0.5, 1] }}
      transition={{
        delay: at,
        duration: 0.95,
        times: [0, 0.08, 0.22, 0.42, 0.66, 1]
      }}
    >
      {children}
    </motion.g>
  );
}

function Entrance({ lantern }: { lantern: Lantern }) {
  const still = useStill();
  const { x, y, size, entrance, enterAt } = lantern;
  const body = <Temperament lantern={lantern} />;

  if (still) {
    return <g transform={`translate(${x} ${y}) scale(${size})`}>{body}</g>;
  }

  if (entrance === "drop") {
    // Falls, squashes flat on impact, springs up tall, settles.
    return (
      <motion.g
        style={SCENE_ORIGIN}
        initial={{
          x,
          y: y - DROP_HEIGHT,
          scale: size,
          scaleX: 0.9,
          scaleY: 1.14
        }}
        animate={{
          y: [y - DROP_HEIGHT, y, y, y, y],
          scaleX: [0.9, 1.3, 0.9, 1.05, 1],
          scaleY: [1.14, 0.68, 1.12, 0.97, 1]
        }}
        transition={{
          duration: DROP_DURATION,
          delay: enterAt,
          times: [0, DROP_IMPACT, 0.6, 0.8, 1],
          ease: ["easeIn", "easeOut", "easeInOut", "easeOut"]
        }}
      >
        {body}
      </motion.g>
    );
  }

  if (entrance === "rise") {
    // Bursts up out of the ground, overshoots, wobbles back down.
    return (
      <motion.g
        style={SCENE_ORIGIN}
        initial={{ x, y: y + 130 * size, scale: size, rotate: -10 }}
        animate={{
          y: [y + 130 * size, y - 16 * size, y + 3 * size, y],
          rotate: [-10, 7, -3, 0]
        }}
        transition={{
          duration: RISE_DURATION,
          delay: enterAt,
          times: [0, 0.5, 0.78, 1],
          ease: ["easeOut", "easeInOut", "easeOut"]
        }}
      >
        {body}
      </motion.g>
    );
  }

  // Rolls in from the right. The turn matches the distance covered, so it
  // never skids, and lands upright after a little overshoot.
  const degreesPer = 180 / Math.PI / (RADIUS * size);
  const overshoot = 12;
  const timing = {
    duration: ROLL_DURATION,
    delay: enterAt,
    times: [0, 0.82, 1],
    ease: ["easeOut", "easeInOut"]
  } satisfies Transition;
  return (
    <motion.g
      style={SCENE_ORIGIN}
      initial={{ x: ROLL_FROM_X, y, scale: size }}
      animate={{ x: [ROLL_FROM_X, x - overshoot, x] }}
      transition={timing}
    >
      <motion.g
        style={{ ...SCENE_ORIGIN, originY: `${CENTRE_Y}px` }}
        initial={{ rotate: (ROLL_FROM_X - x) * degreesPer }}
        animate={{
          rotate: [(ROLL_FROM_X - x) * degreesPer, -overshoot * degreesPer, 0]
        }}
        transition={timing}
      >
        {body}
      </motion.g>
    </motion.g>
  );
}

/** What each lantern does once it is lit. */
function Temperament({ lantern }: { lantern: Lantern }) {
  const { temper, lightAt } = lantern;
  const begin = `${lightAt + 1.2}s`;
  const face = <Face lantern={lantern} />;

  if (temper === "cackle") {
    return (
      <g>
        <LoopTransform
          type="rotate"
          values={CACKLE.rock}
          keyTimes={CACKLE.keyTimes}
          dur={CACKLE.dur}
          begin={begin}
        />
        {face}
      </g>
    );
  }

  if (temper === "sway") {
    return (
      <g>
        <LoopTransform
          type="rotate"
          values="0;2.6;0;-2.6;0"
          dur="3.4s"
          calcMode="spline"
          keySplines="0.45 0 0.55 1;0.45 0 0.55 1;0.45 0 0.55 1;0.45 0 0.55 1"
          begin={begin}
        />
        {face}
      </g>
    );
  }

  // A hop: crouch, spring up, land with a squash.
  return (
    <g>
      <LoopTransform
        type="translate"
        values="0 0;0 0;0 -30;0 0;0 0"
        keyTimes="0;0.72;0.84;0.95;1"
        calcMode="spline"
        keySplines="0 0 1 1;0.2 0.7 0.4 1;0.6 0 0.8 0.3;0 0 1 1"
        dur="2.8s"
        begin={begin}
      />
      <g>
        <LoopTransform
          type="scale"
          values="1 1;1 1;1.12 0.86;0.92 1.1;1 1;1.16 0.84;1 1"
          keyTimes="0;0.66;0.72;0.78;0.9;0.96;1"
          dur="2.8s"
          begin={begin}
        />
        {face}
      </g>
    </g>
  );
}

function Face({ lantern }: { lantern: Lantern }) {
  const { id, temper, lightAt } = lantern;
  const cackles = temper === "cackle";
  const begin = `${lightAt + 1.2}s`;
  const candle = `url(#hw-candle-${id})`;

  const mouth = (fill: string) => (
    <path d={MOUTH.shut} fill={fill}>
      {cackles && (
        <Loop
          attributeName="d"
          values={CACKLE.mouth}
          keyTimes={CACKLE.keyTimes}
          dur={CACKLE.dur}
          begin={begin}
        />
      )}
    </path>
  );

  return (
    <g>
      <Lit at={lightAt}>
        <ellipse cx={0} cy={-46} rx={100} ry={74} fill="url(#hw-bloom)">
          <Loop
            attributeName="opacity"
            values="1;0.72;0.95;0.6;1;0.86;1"
            dur={`${lantern.flicker}s`}
          />
        </ellipse>
      </Lit>

      <ellipse cx={0} cy={-3} rx={58} ry={6} fill="#000000" opacity={0.4} />
      {RIBS.map((rib) => (
        <ellipse
          key={rib.id}
          cx={rib.cx}
          cy={rib.cy}
          rx={rib.rx}
          ry={rib.ry}
          fill="url(#hw-pumpkin)"
          stroke="#8f3307"
          strokeOpacity={0.75}
          strokeWidth={1.6}
        />
      ))}
      <ellipse
        cx={-8}
        cy={-66}
        rx={6}
        ry={15}
        fill="#ffffff"
        opacity={0.13}
        transform="rotate(-8 -8 -66)"
      />
      {/* Moonlight on the right-hand rib */}
      <path
        d="M 55 -79.5 A 30 41 0 0 1 55 -8.5"
        fill="none"
        stroke="#ffe2b8"
        strokeOpacity={0.18}
        strokeWidth={3}
        strokeLinecap="round"
      />
      <path
        d="M -5 -86 C -7 -98, -3 -108, 5 -113 L 10 -109 C 3 -104, 3 -96, 6 -86 Z"
        fill="#5d6b2c"
        stroke="#2f3a15"
        strokeWidth={1.2}
      />
      <path
        d="M 5 -92 c 12 -6 20 2 15 10 c -3 5 -11 3 -9 -3"
        stroke="#4b5a22"
        strokeWidth={2}
        fill="none"
        strokeLinecap="round"
      />

      {/* The carving: cut walls, then dark holes, then the candlelight */}
      <g fill="#6e2804" transform="translate(1.8 2.2)">
        {EYES_AND_NOSE.map((d) => (
          <path key={`wall-${d}`} d={d} />
        ))}
        {mouth("#6e2804")}
      </g>
      <g fill="#1d0a03">
        {EYES_AND_NOSE.map((d) => (
          <path key={`hole-${d}`} d={d} />
        ))}
        {mouth("#1d0a03")}
      </g>
      <Lit at={lightAt}>
        {/* Light spilling onto the skin around the face */}
        <ellipse
          cx={0}
          cy={-40}
          rx={52}
          ry={40}
          fill="url(#hw-bloom)"
          opacity={0.55}
        />
        <g fill={candle}>
          {EYES_AND_NOSE.map((d) => (
            <path key={`light-${d}`} d={d} />
          ))}
          {mouth(candle)}
          <Loop
            attributeName="opacity"
            values="1;0.84;1;0.76;1;0.92;1"
            dur={`${lantern.flicker}s`}
          />
        </g>
      </Lit>
      <Lit at={lightAt + 0.6}>
        <Smoke />
        <Embers offset={lantern.flicker * 0.5} />
      </Lit>
      <Spark at={lightAt} />
    </g>
  );
}

/** The match: a bright flash in the mouth just as the candle catches. */
function Spark({ at }: { at: number }) {
  const still = useStill();
  if (still) return null;
  return (
    <motion.circle
      cx={0}
      cy={-30}
      fill="#fff7cf"
      initial={{ r: 0, opacity: 0 }}
      animate={{ r: [0, 18, 4, 0], opacity: [0, 1, 0.8, 0] }}
      transition={{ delay: at - 0.08, duration: 0.42, times: [0, 0.3, 0.6, 1] }}
    />
  );
}

function Smoke() {
  return (
    <path
      d={SMOKE.a}
      fill="none"
      stroke="url(#hw-smoke)"
      strokeWidth={5}
      strokeLinecap="round"
      strokeDasharray="34 30"
      filter="url(#hw-smoke-soft)"
    >
      <Loop attributeName="stroke-dashoffset" values="0;-128" dur="3s" />
      <Loop
        attributeName="d"
        values={`${SMOKE.a};${SMOKE.b};${SMOKE.a}`}
        dur="4.6s"
      />
    </path>
  );
}

const EMBERS = [
  { id: "e1", x: -10, drift: 14, dur: 2.6, begin: 0 },
  { id: "e2", x: 8, drift: -12, dur: 3.1, begin: 0.9 },
  { id: "e3", x: -2, drift: 10, dur: 2.2, begin: 1.7 }
];

/** A few sparks lifting off the flame through the lid. */
function Embers({ offset }: { offset: number }) {
  return (
    <g fill="#ffb347">
      {EMBERS.map((ember) => (
        <circle key={ember.id} cx={ember.x} cy={-100} r={1.6} opacity={0}>
          <Loop
            attributeName="cy"
            values="-100;-210"
            dur={`${ember.dur}s`}
            begin={`${ember.begin + offset}s`}
          />
          <Loop
            attributeName="cx"
            values={`${ember.x};${ember.x + ember.drift / 2};${ember.x + ember.drift}`}
            dur={`${ember.dur}s`}
            begin={`${ember.begin + offset}s`}
          />
          <Loop
            attributeName="opacity"
            values="0;1;0.8;0"
            keyTimes="0;0.15;0.6;1"
            dur={`${ember.dur}s`}
            begin={`${ember.begin + offset}s`}
          />
        </circle>
      ))}
    </g>
  );
}

/** Dust or dirt thrown out from the base, falling back as it fades. */
function Burst({
  place,
  at,
  bits,
  fill,
  height
}: {
  place: string;
  at: number;
  bits: Particle[];
  fill: string;
  height: number;
}) {
  const still = useStill();
  if (still) return null;
  return (
    <g transform={place} fill={fill}>
      {bits.map((bit) => (
        <motion.circle
          key={bit.id}
          r={bit.r}
          initial={{ cx: 0, cy: -4, opacity: 0 }}
          animate={{
            cx: [0, bit.dx * 0.6, bit.dx],
            cy: [-4, -4 - bit.dy * height, 6],
            opacity: [0, 0.85, 0]
          }}
          transition={{
            delay: at,
            duration: 0.75,
            times: [0, 0.4, 1],
            ease: ["easeOut", "easeIn"]
          }}
        />
      ))}
    </g>
  );
}
