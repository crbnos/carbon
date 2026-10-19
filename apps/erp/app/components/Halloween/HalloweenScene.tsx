// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { motion } from "motion/react";
import type { ReactNode } from "react";
import { JackOLanterns, LANTERN_THUD_AT } from "./Pumpkins";
import { SpiderBody } from "./Spider";
import type { BatFlight, GravestoneShape } from "./scene";
import { BATS, CLOUDS, FENCE, GRASS, GRAVESTONES, STARS, TREE } from "./scene";
import {
  Loop,
  LoopTransform,
  SCENE_ORIGIN,
  StillContext,
  useStill
} from "./scene-loops";

// The surprise behind the spider web: a moonlit graveyard. A haunted house
// lets out a colony of bats, a ghost rises from a grave, jack-o'-lanterns
// arrive and are lit one by one, a spider drops in on its thread.

export const NIGHT = "#06030a";
const SILHOUETTE = "#0a0613";
const GROUND = "#110920";

/** The night scene on its own: the reveal puts it on screen. */
export function HalloweenScene({
  title,
  subtitle,
  still
}: {
  title: string;
  subtitle: string;
  /** Reduced motion: every element at rest, no loops. */
  still: boolean;
}) {
  return (
    <StillContext.Provider value={still}>
      <svg
        viewBox="0 0 1600 900"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full"
        aria-hidden
      >
        <SceneDefs />

        <Thud>
          <rect width={1600} height={900} fill="url(#hw-sky)" />
          <Stars />
          <ellipse
            cx={800}
            cy={690}
            rx={980}
            ry={190}
            fill="url(#hw-horizon)"
          />
          <Moon />
          <Clouds />
          {BATS.slice(0, 2).map((bat) => (
            <FlyingBat key={bat.id} flight={bat} silhouette />
          ))}

          {/* Far hills, then the house on its rise */}
          <path
            d="M 0 640 C 200 590, 380 612, 560 632 S 900 598, 1100 624 S 1400 588, 1600 614 L 1600 900 L 0 900 Z"
            fill="#1b0f2a"
          />
          <HauntedHouse />
          <path
            d="M 0 702 C 300 672, 600 690, 900 700 S 1350 680, 1600 690 L 1600 900 L 0 900 Z"
            fill={GROUND}
          />
          <Fence />
          <Fog y={716} opacity={0.15} drift={18} />
          <Tree />
          <Ghost />

          {/* Foreground graveyard */}
          <path
            d="M 0 768 C 260 728, 520 752, 760 760 S 1200 736, 1600 752 L 1600 900 L 0 900 Z"
            fill={NIGHT}
          />
          {GRAVESTONES.map((stone) => (
            <Gravestone key={stone.id} {...stone} />
          ))}
          <path d={GRASS} fill={NIGHT} />
          <JackOLanterns />
          <Fog y={858} opacity={0.1} drift={24} />

          <Title title={title} subtitle={subtitle} />
          {BATS.slice(2).map((bat) => (
            <FlyingBat key={bat.id} flight={bat} />
          ))}
          <DroppingSpider />
        </Thud>

        <rect width={1600} height={900} fill="url(#hw-vignette)" />
        {!still && (
          <motion.rect
            width={1600}
            height={900}
            fill="#e9e3ff"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.3, 0, 0.12, 0] }}
            transition={{
              duration: 1.1,
              delay: 0.35,
              times: [0, 0.12, 0.4, 0.5, 1]
            }}
          />
        )}
      </svg>
    </StillContext.Provider>
  );
}

/** The scene jolts when the big lantern lands. */
function Thud({ children }: { children: ReactNode }) {
  const still = useStill();
  return (
    <motion.g
      initial={{ y: 0 }}
      animate={still ? { y: 0 } : { y: [0, 0, 6, -3, 1.5, 0] }}
      transition={{
        delay: LANTERN_THUD_AT - 0.02,
        duration: 0.42,
        times: [0, 0.05, 0.22, 0.5, 0.75, 1]
      }}
    >
      {children}
    </motion.g>
  );
}

function SceneDefs() {
  return (
    <defs>
      <linearGradient id="hw-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#05030c" />
        <stop offset="0.42" stopColor="#140a28" />
        <stop offset="0.72" stopColor="#2a1240" />
        <stop offset="1" stopColor="#47193a" />
      </linearGradient>
      <radialGradient id="hw-horizon" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#ff7a1a" stopOpacity={0.22} />
        <stop offset="0.6" stopColor="#a8325e" stopOpacity={0.08} />
        <stop offset="1" stopColor="#a8325e" stopOpacity={0} />
      </radialGradient>
      <radialGradient id="hw-moon" cx="0.4" cy="0.36" r="0.68">
        <stop offset="0" stopColor="#fffbea" />
        <stop offset="0.55" stopColor="#f6e3a8" />
        <stop offset="1" stopColor="#d6b062" />
      </radialGradient>
      <radialGradient id="hw-moon-glow" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#ffe8a8" stopOpacity={0.5} />
        <stop offset="0.3" stopColor="#ffd78a" stopOpacity={0.16} />
        <stop offset="1" stopColor="#ffd78a" stopOpacity={0} />
      </radialGradient>
      <linearGradient id="hw-cloud" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#4d3670" />
        <stop offset="0.5" stopColor="#2a1a42" />
        <stop offset="1" stopColor="#170e26" />
      </linearGradient>
      <radialGradient id="hw-window-glow" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#ffb547" stopOpacity={0.55} />
        <stop offset="1" stopColor="#ff8a1f" stopOpacity={0} />
      </radialGradient>
      <radialGradient id="hw-pumpkin" cx="0.38" cy="0.32" r="0.78">
        <stop offset="0" stopColor="#ffb25a" />
        <stop offset="0.5" stopColor="#f47b16" />
        <stop offset="1" stopColor="#a33a06" />
      </radialGradient>
      <radialGradient id="hw-carve" cx="0.5" cy="0.5" r="0.62">
        <stop offset="0" stopColor="#fffde3" />
        <stop offset="0.35" stopColor="#ffe066" />
        <stop offset="0.8" stopColor="#ff9a1a" />
        <stop offset="1" stopColor="#e05a00" />
      </radialGradient>
      <radialGradient id="hw-bloom" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#ffcf4a" stopOpacity={0.55} />
        <stop offset="1" stopColor="#ff8a1f" stopOpacity={0} />
      </radialGradient>
      <radialGradient id="hw-floor-glow" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#ff8a1f" stopOpacity={0.5} />
        <stop offset="1" stopColor="#ff8a1f" stopOpacity={0} />
      </radialGradient>
      <radialGradient id="hw-ghost" cx="0.45" cy="0.3" r="0.8">
        <stop offset="0" stopColor="#ffffff" />
        <stop offset="0.7" stopColor="#ece7ff" />
        <stop offset="1" stopColor="#c9bff0" />
      </radialGradient>
      <radialGradient id="hw-ghost-aura" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#e9e3ff" stopOpacity={0.4} />
        <stop offset="1" stopColor="#e9e3ff" stopOpacity={0} />
      </radialGradient>
      <radialGradient id="hw-fog" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#d9ceff" stopOpacity={1} />
        <stop offset="1" stopColor="#d9ceff" stopOpacity={0} />
      </radialGradient>
      <linearGradient id="hw-title" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#ffe39a" />
        <stop offset="0.45" stopColor="#ff9a2e" />
        <stop offset="1" stopColor="#c43c0c" />
      </linearGradient>
      <radialGradient id="hw-vignette" cx="0.5" cy="0.45" r="0.75">
        <stop offset="0.55" stopColor="#000000" stopOpacity={0} />
        <stop offset="1" stopColor="#000000" stopOpacity={0.7} />
      </radialGradient>
      <filter id="hw-title-glow" x="-20%" y="-60%" width="140%" height="220%">
        <feGaussianBlur stdDeviation="14" />
      </filter>
      {/* A slow ripple through the lettering, like heat over a candle */}
      <filter id="hw-title-wobble" x="-5%" y="-20%" width="110%" height="140%">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.011 0.03"
          numOctaves={2}
          seed={3}
        >
          <Loop
            attributeName="baseFrequency"
            values="0.011 0.03;0.016 0.04;0.011 0.03"
            dur="7s"
          />
        </feTurbulence>
        <feDisplacementMap in="SourceGraphic" scale="5" />
      </filter>
    </defs>
  );
}

function Stars() {
  return (
    <g fill="#fff8e7">
      {STARS.map((star) => (
        <circle
          key={star.id}
          cx={star.x}
          cy={star.y}
          r={star.r}
          opacity={star.opacity}
        >
          <Loop
            attributeName="opacity"
            values={`${star.opacity};${star.opacity * 0.2};${star.opacity}`}
            dur={`${star.twinkle}s`}
            begin={`${star.delay}s`}
          />
        </circle>
      ))}
    </g>
  );
}

const CRATERS = [
  { id: "c1", x: -32, y: -18, r: 17 },
  { id: "c2", x: 24, y: 20, r: 12 },
  { id: "c3", x: -8, y: 40, r: 9 },
  { id: "c4", x: 42, y: -30, r: 7.5 },
  { id: "c5", x: -50, y: 24, r: 6 },
  { id: "c6", x: 12, y: -52, r: 5.5 },
  { id: "c7", x: 56, y: 12, r: 4.5 }
];

function Moon() {
  const still = useStill();
  return (
    <motion.g
      style={SCENE_ORIGIN}
      initial={still ? false : { x: 1335, y: 470, opacity: 0 }}
      animate={{ x: 1335, y: 215, opacity: 1 }}
      transition={{ duration: 2.4, ease: [0.16, 1, 0.3, 1] }}
    >
      <circle r={320} fill="url(#hw-moon-glow)" />
      <circle r={98} fill="url(#hw-moon)" />
      {/* Maria: the darker plains */}
      <path
        d="M -60 -40 C -40 -62, -6 -58, 4 -36 C 12 -18, -14 -4, -34 -10 C -52 -16, -70 -24, -60 -40 Z"
        fill="#d9bd78"
        opacity={0.35}
      />
      <path
        d="M 10 10 C 30 -6, 66 4, 62 30 C 58 54, 26 62, 10 46 C 0 36, -4 22, 10 10 Z"
        fill="#d9bd78"
        opacity={0.3}
      />
      {CRATERS.map((crater) => (
        <g key={crater.id}>
          <circle
            cx={crater.x}
            cy={crater.y}
            r={crater.r}
            fill="#cdae66"
            opacity={0.5}
          />
          <circle
            cx={crater.x + crater.r * 0.18}
            cy={crater.y + crater.r * 0.18}
            r={crater.r * 0.78}
            fill="#f3dfa4"
            opacity={0.55}
          />
        </g>
      ))}
      {/* Shade the limb away from the light */}
      <circle
        r={98}
        fill="none"
        stroke="#b08a3e"
        strokeOpacity={0.25}
        strokeWidth={6}
      />
    </motion.g>
  );
}

function Clouds() {
  return (
    <g>
      {CLOUDS.map((cloud) => (
        <g key={cloud.id} transform={`translate(${cloud.x} ${cloud.y})`}>
          <g opacity={cloud.opacity}>
            <path d={cloud.d} fill="url(#hw-cloud)" />
            <LoopTransform
              type="translate"
              values="0 0; 70 0; 0 0"
              dur={`${cloud.drift}s`}
            />
          </g>
        </g>
      ))}
    </g>
  );
}

const WINDOWS = [
  { id: "w-main-1", x: 270, y: 500, w: 24, h: 32, dur: 2.3, out: false },
  { id: "w-main-2", x: 374, y: 500, w: 24, h: 32, dur: 3.1, out: true },
  { id: "w-main-3", x: 266, y: 560, w: 24, h: 30, dur: 2.7, out: false },
  { id: "w-main-4", x: 384, y: 560, w: 20, h: 30, dur: 1.9, out: false },
  { id: "w-wing", x: 214, y: 552, w: 24, h: 28, dur: 3.6, out: false },
  { id: "w-tower-2", x: 424, y: 490, w: 26, h: 32, dur: 2.9, out: false },
  { id: "w-tower-slit", x: 431, y: 550, w: 12, h: 26, dur: 2.2, out: false }
];

function HauntedHouse() {
  return (
    <g>
      <path
        d="M 30 704 C 110 612, 300 588, 470 610 C 570 624, 640 664, 700 704 Z"
        fill="#140b23"
      />
      {/* Window light spills out first, so the walls cut it off */}
      {WINDOWS.map((w) => (
        <ellipse
          key={`${w.id}-glow`}
          cx={w.x + w.w / 2}
          cy={w.y + w.h / 2}
          rx={w.w * 1.9}
          ry={w.h * 1.4}
          fill="url(#hw-window-glow)"
        >
          <Loop
            attributeName="opacity"
            values={w.out ? "1;1;0.1;0.1;1" : "1;0.75;1;0.85;1"}
            dur={`${w.out ? 7 : w.dur}s`}
          />
        </ellipse>
      ))}
      <g fill={SILHOUETTE}>
        {/* Left wing */}
        <rect x={196} y={532} width={62} height={82} />
        <path d="M 186 535 L 227 496 L 268 535 Z" />
        {/* Main house, its crooked chimney and its porch */}
        <path d="M 282 448 L 298 443 L 305 474 L 288 478 Z" />
        <rect x={252} y={478} width={168} height={136} />
        <path d="M 238 483 L 336 402 L 434 483 Z" />
        <path d="M 294 566 L 382 566 L 372 554 L 304 554 Z" />
        <rect x={302} y={566} width={4} height={48} />
        <rect x={370} y={566} width={4} height={48} />
        {/* The tower */}
        <rect x={408} y={392} width={58} height={222} />
        <path d="M 398 397 L 437 292 L 476 397 Z" />
        <rect x={435.5} y={262} width={3} height={32} />
        <circle cx={437} cy={262} r={3.5} />
      </g>
      {/* Weathervane */}
      <path
        d="M 424 272 L 450 272 M 445 267 L 450 272 L 445 277 M 424 268 L 428 272 L 424 276"
        stroke={SILHOUETTE}
        strokeWidth={2.2}
        fill="none"
        strokeLinecap="round"
      />
      {/* A shutter hanging off one hinge */}
      <rect
        x={399}
        y={499}
        width={8}
        height={34}
        fill={SILHOUETTE}
        transform="rotate(14 399 499)"
      />

      {WINDOWS.map((w) => (
        <g key={w.id}>
          <rect x={w.x} y={w.y} width={w.w} height={w.h} fill="#ffb84a">
            <Loop
              attributeName="opacity"
              values={w.out ? "1;1;0.12;0.12;1" : "1;0.82;1;0.9;1"}
              dur={`${w.out ? 7 : w.dur}s`}
            />
          </rect>
          <path
            d={`M ${w.x + w.w / 2} ${w.y} V ${w.y + w.h} M ${w.x} ${w.y + w.h * 0.45} H ${w.x + w.w}`}
            stroke={SILHOUETTE}
            strokeWidth={2}
          />
        </g>
      ))}

      {/* The arched tower window, and someone standing in it */}
      <path
        d="M 424 458 L 424 432 Q 437 414 450 432 L 450 458 Z"
        fill="#ffb84a"
      >
        <Loop attributeName="opacity" values="1;0.8;1;0.7;1" dur="2.6s" />
      </path>
      <circle cx={437} cy={441} r={5} fill="#1a0b10" />
      <path
        d="M 427 458 Q 428 446 437 446 Q 446 446 447 458 Z"
        fill="#1a0b10"
      />

      {/* Attic window and the front door */}
      <circle cx={336} cy={452} r={11} fill="#ffb84a">
        <Loop
          attributeName="opacity"
          values="0.9;0.6;0.95;0.7;0.9"
          dur="3.3s"
        />
      </circle>
      <path
        d="M 336 441 V 463 M 325 452 H 347"
        stroke={SILHOUETTE}
        strokeWidth={2}
      />
      <path
        d="M 326 614 L 326 586 Q 338 572 350 586 L 350 614 Z"
        fill="#ff9a2e"
        opacity={0.55}
      />
    </g>
  );
}

function Fence() {
  return (
    <g fill="#0d0818">
      {FENCE.posts.map((post) => (
        <g
          key={post.id}
          transform={`rotate(${post.tilt} ${post.x} ${FENCE.baseY})`}
        >
          <rect x={post.x - 1.6} y={FENCE.baseY - 52} width={3.2} height={52} />
          <path
            d={`M ${post.x - 4} ${FENCE.baseY - 51} L ${post.x} ${FENCE.baseY - 63} L ${post.x + 4} ${FENCE.baseY - 51} Z`}
          />
        </g>
      ))}
      <path d={FENCE.rails} stroke="#0d0818" strokeWidth={2.4} fill="none" />
    </g>
  );
}

function Tree() {
  const { fork } = TREE;
  return (
    <g>
      <g fill="none" stroke={NIGHT} strokeLinecap="round">
        {TREE.branches.map((branch) => (
          <path key={branch.id} d={branch.d} strokeWidth={branch.width} />
        ))}
      </g>
      <path d={TREE.roots} fill={NIGHT} />
      {/* An owl in the fork, blinking */}
      {[-6, 6].map((dx) => (
        <ellipse
          key={`owl-${dx}`}
          cx={fork.x + dx - 4}
          cy={fork.y + 26}
          rx={3.2}
          ry={3.2}
          fill="#ffd34a"
        >
          <Loop
            attributeName="ry"
            values="3.2;3.2;0.3;3.2;3.2"
            keyTimes="0;0.9;0.94;0.98;1"
            dur="4.5s"
          />
        </ellipse>
      ))}
    </g>
  );
}

function Fog({
  y,
  opacity,
  drift
}: {
  y: number;
  opacity: number;
  drift: number;
}) {
  return (
    <g opacity={opacity}>
      <g>
        {[-120, 330, 780, 1230, 1680].map((x, i) => (
          <ellipse
            key={`fog-${x}`}
            cx={x}
            cy={y + (i % 2) * 16}
            rx={330}
            ry={54}
            fill="url(#hw-fog)"
          />
        ))}
        <LoopTransform
          type="translate"
          values="-60 0; 60 0; -60 0"
          dur={`${drift}s`}
        />
      </g>
    </g>
  );
}

const GHOST_BODY = {
  a: "M -50 12 C -50 -52, 50 -52, 50 12 L 50 64 Q 40 80 30 66 Q 20 52 10 68 Q 0 84 -10 68 Q -20 52 -30 66 Q -40 80 -50 64 Z",
  b: "M -50 12 C -50 -52, 50 -52, 50 12 L 50 66 Q 40 52 30 68 Q 20 84 10 66 Q 0 52 -10 66 Q -20 82 -30 68 Q -40 54 -50 66 Z"
};

function Ghost() {
  const still = useStill();
  return (
    <motion.g
      style={SCENE_ORIGIN}
      initial={
        still
          ? { x: 1150, y: 620, opacity: 0.9, scale: 0.75 }
          : { x: 1052, y: 812, opacity: 0, scale: 0.4 }
      }
      animate={
        still
          ? undefined
          : {
              x: [1052, 1080, 1140, 1210],
              y: [812, 700, 630, 560],
              opacity: [0, 0.95, 0.95, 0],
              scale: [0.4, 0.7, 0.78, 0.82]
            }
      }
      transition={{
        duration: 6.5,
        delay: 2.2,
        ease: "easeInOut",
        times: [0, 0.3, 0.7, 1]
      }}
    >
      <g>
        <LoopTransform
          type="translate"
          values="0 0; 0 -10; 0 0"
          dur="2.4s"
          calcMode="spline"
          keySplines="0.45 0 0.55 1; 0.45 0 0.55 1"
        />
        <ellipse cx={0} cy={10} rx={110} ry={110} fill="url(#hw-ghost-aura)" />
        <path d={GHOST_BODY.a} fill="url(#hw-ghost)" opacity={0.94}>
          <Loop
            attributeName="d"
            values={`${GHOST_BODY.a};${GHOST_BODY.b};${GHOST_BODY.a}`}
            dur="1.4s"
          />
        </path>
        {/* Arms */}
        <path
          d="M -46 14 Q -66 8 -72 -10"
          stroke="#efeaff"
          strokeWidth={13}
          strokeLinecap="round"
          fill="none"
        >
          <LoopTransform
            type="rotate"
            values="0 -46 14; -14 -46 14; 0 -46 14"
            dur="1.6s"
          />
        </path>
        <path
          d="M 46 14 Q 66 8 72 -10"
          stroke="#efeaff"
          strokeWidth={13}
          strokeLinecap="round"
          fill="none"
        >
          <LoopTransform
            type="rotate"
            values="0 46 14; 14 46 14; 0 46 14"
            dur="1.6s"
          />
        </path>
        {/* Face */}
        <ellipse cx={-16} cy={-6} rx={6.5} ry={10} fill="#1b1027" />
        <ellipse cx={16} cy={-6} rx={6.5} ry={10} fill="#1b1027" />
        <circle cx={-18} cy={-10} r={2} fill="#ffffff" opacity={0.7} />
        <circle cx={14} cy={-10} r={2} fill="#ffffff" opacity={0.7} />
        <ellipse cx={0} cy={20} rx={8} ry={11} fill="#1b1027">
          <Loop attributeName="ry" values="11;14;11" dur="1.8s" />
        </ellipse>
      </g>
    </motion.g>
  );
}

function Gravestone({
  x,
  y,
  scale,
  tilt,
  shape
}: {
  x: number;
  y: number;
  scale: number;
  tilt: number;
  shape: GravestoneShape;
}) {
  const outline =
    shape === "round"
      ? "M -26 0 L -26 -58 A 26 26 0 0 1 26 -58 L 26 0 Z"
      : shape === "cross"
        ? "M -6 0 L -6 -60 L -22 -60 L -22 -72 L -6 -72 L -6 -92 L 6 -92 L 6 -72 L 22 -72 L 22 -60 L 6 -60 L 6 0 Z"
        : "M -22 0 L -22 -50 Q -22 -78 0 -94 Q 22 -78 22 -50 L 22 0 Z";

  return (
    <g transform={`translate(${x} ${y}) rotate(${tilt}) scale(${scale})`}>
      <path d={outline} fill="#140e1f" stroke="#2c2142" strokeWidth={1.4} />
      {/* Moonlight catches the right-hand edge */}
      <path
        d={outline}
        fill="none"
        stroke="#4a3b66"
        strokeWidth={1.2}
        strokeDasharray="0 9 60 400"
        opacity={0.7}
      />
      {shape !== "cross" && (
        <g fill="#07040c">
          <rect x={-3} y={-74} width={6} height={18} rx={1} />
          <rect x={-9} y={-69} width={18} height={5} rx={1} />
          <rect x={-14} y={-46} width={28} height={2.4} rx={1} />
          <rect x={-10} y={-39} width={20} height={2} rx={1} />
          <rect x={-12} y={-32} width={24} height={2} rx={1} />
        </g>
      )}
      <path
        d="M 10 -34 l -5 8 l 4 6 l -4 9"
        stroke="#07040c"
        strokeWidth={1}
        fill="none"
      />
    </g>
  );
}

function Title({ title, subtitle }: { title: string; subtitle: string }) {
  const still = useStill();
  return (
    <g>
      <motion.g
        initial={still ? false : { opacity: 0 }}
        animate={{ opacity: [0, 1, 0.25, 1, 0.55, 1] }}
        transition={{
          duration: 1.5,
          delay: 1.3,
          times: [0, 0.18, 0.3, 0.48, 0.62, 1]
        }}
      >
        <text
          x={740}
          y={212}
          textAnchor="middle"
          fontFamily="Georgia, 'Times New Roman', serif"
          fontWeight={700}
          fontSize={98}
          letterSpacing={3}
          fill="#ff7a1a"
          filter="url(#hw-title-glow)"
          opacity={0.6}
        >
          {title}
          <Loop
            attributeName="opacity"
            values="0.6;0.4;0.65;0.5;0.6"
            dur="2.2s"
          />
        </text>
        <text
          x={740}
          y={212}
          textAnchor="middle"
          fontFamily="Georgia, 'Times New Roman', serif"
          fontWeight={700}
          fontSize={98}
          letterSpacing={3}
          fill="url(#hw-title)"
          stroke="#3a0d00"
          strokeWidth={3}
          paintOrder="stroke"
          filter={still ? undefined : "url(#hw-title-wobble)"}
        >
          {title}
        </text>
      </motion.g>
      <motion.text
        x={740}
        y={266}
        textAnchor="middle"
        fontFamily="Georgia, 'Times New Roman', serif"
        fontStyle="italic"
        fontSize={30}
        letterSpacing={2}
        fill="#e6dcff"
        initial={still ? false : { opacity: 0 }}
        animate={{ opacity: 0.85 }}
        transition={{ duration: 1, delay: 2.4 }}
      >
        {subtitle}
      </motion.text>
    </g>
  );
}

function Wing({ silhouette, flap }: { silhouette: boolean; flap: number }) {
  return (
    <g>
      <path d="M -3 -4 C -14 -17, -36 -23, -60 -12 C -55 -6, -53 -1, -51 6 C -45 0, -39 0, -34 6 C -29 0, -22 0, -17 7 C -12 2, -7 1, -3 5 Z" />
      {!silhouette && (
        <path
          d="M -3 -3 L -51 5 M -3 -3 L -34 5 M -3 -3 L -17 6 M -3 -4 L -60 -12"
          fill="none"
          stroke="#1f1630"
          strokeWidth={1.1}
        />
      )}
      <LoopTransform
        type="scale"
        values="1 1; 1 -0.45; 1 1"
        dur={`${flap}s`}
        calcMode="spline"
        keySplines="0.4 0 0.6 1; 0.4 0 0.6 1"
      />
    </g>
  );
}

function FlyingBat({
  flight,
  silhouette = false
}: {
  flight: BatFlight;
  silhouette?: boolean;
}) {
  const still = useStill();
  if (still) {
    // Parked mid-flight.
    return (
      <g
        transform={`translate(${flight.x[2]} ${flight.y[2]}) scale(${flight.scale[2]})`}
      >
        <Bat silhouette={silhouette} flap={flight.flap} />
      </g>
    );
  }
  return (
    <motion.g
      style={SCENE_ORIGIN}
      initial={{
        x: flight.x[0],
        y: flight.y[0],
        scale: flight.scale[0],
        opacity: 0
      }}
      animate={{
        x: flight.x,
        y: flight.y,
        scale: flight.scale,
        rotate: flight.rotate,
        opacity: [0, 1, 1, 1]
      }}
      transition={{
        duration: flight.duration,
        delay: flight.delay,
        ease: "easeIn"
      }}
    >
      <Bat silhouette={silhouette} flap={flight.flap} />
    </motion.g>
  );
}

function Bat({ silhouette, flap }: { silhouette: boolean; flap: number }) {
  // Blacker than the darkest sky, with a moonlit rim so it reads up there too.
  return (
    <g
      fill="#020104"
      stroke="#4a3768"
      strokeWidth={silhouette ? 4 : 1.6}
      strokeLinejoin="round"
    >
      <Wing silhouette={silhouette} flap={flap} />
      <g transform="scale(-1 1)">
        <Wing silhouette={silhouette} flap={flap} />
      </g>
      <ellipse cx={0} cy={3} rx={6.5} ry={10} />
      <circle cx={0} cy={-8} r={6} />
      <path d="M -5 -11 L -6.5 -21 L -1.5 -13 Z M 5 -11 L 6.5 -21 L 1.5 -13 Z" />
      {!silhouette && (
        <g stroke="none">
          <circle cx={-2.3} cy={-8.6} r={1.2} fill="#ff5a1f" />
          <circle cx={2.3} cy={-8.6} r={1.2} fill="#ff5a1f" />
          <path
            d="M -2 -4 l 0.6 1.8 l 0.6 -1.8 Z M 0.8 -4 l 0.6 1.8 l 0.6 -1.8 Z"
            fill="#ffffff"
          />
        </g>
      )}
    </g>
  );
}

function DroppingSpider() {
  const still = useStill();
  return (
    <motion.g
      style={SCENE_ORIGIN}
      initial={still ? { x: 196, y: 300 } : { x: 196, y: -180 }}
      animate={{ x: 196, y: 300 }}
      transition={{
        type: "spring",
        stiffness: 70,
        damping: 6,
        mass: 1.2,
        delay: 0.9
      }}
    >
      <g>
        <LoopTransform
          type="translate"
          values="0 0; 0 -8; 0 0"
          dur="2.8s"
          calcMode="spline"
          keySplines="0.45 0 0.55 1; 0.45 0 0.55 1"
        />
        <line
          x1={0}
          y1={-1400}
          x2={0}
          y2={0}
          stroke="#d8d2ea"
          strokeOpacity={0.55}
          strokeWidth={1.2}
        />
        <g transform="scale(2.6)">
          <SpiderBody
            idPrefix="halloween-reveal-spider"
            animateLegs
            rimOpacity={0.3}
          />
        </g>
      </g>
    </motion.g>
  );
}
