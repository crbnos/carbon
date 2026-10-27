// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { motion } from "motion/react";
import {
  BRIGHT_STARS,
  CLOUDS,
  LIGHTNING,
  SHOOTING_STARS,
  STAR_DUST,
  STARS
} from "./scene";
import { Loop, LoopTransform, SCENE_ORIGIN, useStill } from "./scene-loops";

// Everything above the hills: the sky and its glow, the stars, the moon, the
// clouds it lights, a witch crossing its face, and the opening lightning.

export const MOON = { x: 1335, y: 215, r: 98 };

/** When the lightning strikes, and how it flickers. */
const STRIKE = {
  delay: 0.35,
  duration: 1.1,
  times: [0, 0.12, 0.4, 0.5, 1]
};

export function SkyDefs() {
  return (
    <>
      <linearGradient id="hw-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#030209" />
        <stop offset="0.3" stopColor="#0b0619" />
        <stop offset="0.55" stopColor="#1a0c31" />
        <stop offset="0.72" stopColor="#2e1346" />
        <stop offset="0.86" stopColor="#4a1a4c" />
        <stop offset="1" stopColor="#5c2142" />
      </linearGradient>
      {/* The last of the sunset, and a violet glow banked along the hills */}
      <radialGradient id="hw-horizon" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#ff7a1a" stopOpacity={0.26} />
        <stop offset="0.5" stopColor="#c23a6a" stopOpacity={0.1} />
        <stop offset="1" stopColor="#a8325e" stopOpacity={0} />
      </radialGradient>
      <radialGradient id="hw-aurora" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#9b4dff" stopOpacity={0.3} />
        <stop offset="0.55" stopColor="#7a2fd0" stopOpacity={0.1} />
        <stop offset="1" stopColor="#7a2fd0" stopOpacity={0} />
      </radialGradient>
      <radialGradient id="hw-galaxy" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#c7b4ff" stopOpacity={0.09} />
        <stop offset="1" stopColor="#c7b4ff" stopOpacity={0} />
      </radialGradient>
      <radialGradient id="hw-star-glow" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#fff6dc" stopOpacity={0.75} />
        <stop offset="0.3" stopColor="#d8ccff" stopOpacity={0.22} />
        <stop offset="1" stopColor="#d8ccff" stopOpacity={0} />
      </radialGradient>
      <linearGradient id="hw-meteor" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#ffffff" stopOpacity={0} />
        <stop offset="0.8" stopColor="#e7ddff" stopOpacity={0.55} />
        <stop offset="1" stopColor="#ffffff" stopOpacity={1} />
      </linearGradient>

      {/* The moon: limb-darkened disc, its glow in three widths and a faint ring */}
      <radialGradient id="hw-moon" cx="0.44" cy="0.4" r="0.62">
        <stop offset="0" stopColor="#fffcee" />
        <stop offset="0.6" stopColor="#f7e6b0" />
        <stop offset="0.9" stopColor="#e4c57e" />
        <stop offset="1" stopColor="#cfa95f" />
      </radialGradient>
      <linearGradient id="hw-moon-shade" x1="0.85" y1="0.1" x2="0.15" y2="0.95">
        <stop offset="0.45" stopColor="#7c5a2c" stopOpacity={0} />
        <stop offset="1" stopColor="#7c5a2c" stopOpacity={0.42} />
      </linearGradient>
      <radialGradient id="hw-mare" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#bf9d5c" stopOpacity={0.55} />
        <stop offset="0.7" stopColor="#c9a866" stopOpacity={0.3} />
        <stop offset="1" stopColor="#c9a866" stopOpacity={0} />
      </radialGradient>
      <radialGradient id="hw-moon-glow" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#fff1c4" stopOpacity={0.6} />
        <stop offset="0.24" stopColor="#ffe3a0" stopOpacity={0.3} />
        <stop offset="0.5" stopColor="#ffd78a" stopOpacity={0.08} />
        <stop offset="1" stopColor="#ffd78a" stopOpacity={0} />
      </radialGradient>
      <radialGradient id="hw-moon-haze" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#b9a4ff" stopOpacity={0.16} />
        <stop offset="1" stopColor="#b9a4ff" stopOpacity={0} />
      </radialGradient>
      <radialGradient id="hw-moon-ring" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0.78" stopColor="#ffe9b8" stopOpacity={0} />
        <stop offset="0.86" stopColor="#ffe9b8" stopOpacity={0.07} />
        <stop offset="0.9" stopColor="#d9c8ff" stopOpacity={0.05} />
        <stop offset="1" stopColor="#d9c8ff" stopOpacity={0} />
      </radialGradient>
      <linearGradient
        id="hw-moonbeam"
        gradientUnits="userSpaceOnUse"
        x1={MOON.x}
        y1={MOON.y}
        x2={MOON.x - 700}
        y2={MOON.y + 520}
      >
        <stop offset="0" stopColor="#ffe9b8" stopOpacity={0.12} />
        <stop offset="1" stopColor="#ffe9b8" stopOpacity={0} />
      </linearGradient>

      <linearGradient id="hw-cloud" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#4f3a72" />
        <stop offset="0.45" stopColor="#2c1c45" />
        <stop offset="1" stopColor="#150c24" />
      </linearGradient>
      <linearGradient id="hw-cloud-rim" x1="1" y1="0" x2="0.25" y2="0.9">
        <stop offset="0" stopColor="#fff0c8" stopOpacity={0.95} />
        <stop offset="0.45" stopColor="#c9b6f2" stopOpacity={0.4} />
        <stop offset="1" stopColor="#c9b6f2" stopOpacity={0} />
      </linearGradient>
    </>
  );
}

/** The sky behind everything: gradient, sunset glow, violet glow, galaxy. */
export function Sky() {
  return (
    <g>
      <rect x={-100} y={-40} width={1800} height={980} fill="url(#hw-sky)" />
      <ellipse
        cx={760}
        cy={330}
        rx={900}
        ry={120}
        fill="url(#hw-galaxy)"
        transform="rotate(12 760 330)"
      />
      <path d={STAR_DUST} fill="#efe6ff" opacity={0.42} />
      <ellipse
        cx={360}
        cy={640}
        rx={560}
        ry={170}
        fill="url(#hw-aurora)"
        opacity={0.9}
      >
        <Loop attributeName="opacity" values="0.9;0.6;0.9" dur="9s" />
      </ellipse>
      <ellipse
        cx={1100}
        cy={652}
        rx={620}
        ry={150}
        fill="url(#hw-aurora)"
        opacity={0.7}
      >
        <Loop attributeName="opacity" values="0.7;1;0.7" dur="11s" />
      </ellipse>
      <ellipse cx={800} cy={700} rx={1000} ry={200} fill="url(#hw-horizon)" />
    </g>
  );
}

export function Stars() {
  return (
    <g>
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
      {BRIGHT_STARS.map((star) => (
        <g
          key={star.id}
          transform={`translate(${star.x} ${star.y}) scale(${star.size})`}
        >
          <g>
            <circle r={13} fill="url(#hw-star-glow)" />
            {/* Diffraction spikes: long and thin, then a shorter diagonal pair */}
            <path
              d="M 0 -16 L 0.9 -0.9 L 16 0 L 0.9 0.9 L 0 16 L -0.9 0.9 L -16 0 L -0.9 -0.9 Z"
              fill="#fffaf0"
              opacity={0.85}
            />
            <path
              d="M -6 -6 L 0.5 0 L 6 6 M 6 -6 L 0 0.5 L -6 6"
              stroke="#e8dcff"
              strokeWidth={0.6}
              opacity={0.45}
            />
            <circle r={1.8} fill="#ffffff" />
            <Loop
              attributeName="opacity"
              values="1;0.45;1"
              dur={`${star.twinkle}s`}
            />
          </g>
        </g>
      ))}
    </g>
  );
}

/**
 * A streak now and then. Each one waits its turn, flashes across in a
 * fraction of a second and is gone; with reduced motion one hangs mid-flight.
 */
export function ShootingStars() {
  const still = useStill();
  if (still) {
    const meteor = SHOOTING_STARS[0];
    if (!meteor) return null;
    return (
      <g
        transform={`translate(${meteor.x} ${meteor.y}) rotate(${meteor.angle}) translate(120 0)`}
        opacity={0.75}
      >
        <MeteorTrail length={meteor.length} />
      </g>
    );
  }
  return (
    <g>
      {SHOOTING_STARS.map((meteor) => (
        <g
          key={meteor.id}
          transform={`translate(${meteor.x} ${meteor.y}) rotate(${meteor.angle})`}
        >
          <g opacity={0}>
            <LoopTransform
              type="translate"
              values="0 0; 300 0; 300 0"
              keyTimes="0;0.09;1"
              dur="9s"
              begin={`${meteor.begin}s`}
            />
            <Loop
              attributeName="opacity"
              values="0;1;1;0;0"
              keyTimes="0;0.015;0.06;0.09;1"
              dur="9s"
              begin={`${meteor.begin}s`}
            />
            <MeteorTrail length={meteor.length} />
          </g>
        </g>
      ))}
    </g>
  );
}

function MeteorTrail({ length }: { length: number }) {
  return (
    <g>
      <path d={`M ${-length} 0 L 0 -1.4 L 0 1.4 Z`} fill="url(#hw-meteor)" />
      <circle r={5} fill="url(#hw-star-glow)" />
      <circle r={1.6} fill="#ffffff" />
    </g>
  );
}

// Craters, in moon units. Lit from the upper right, a crater's far (upper
// right) inner wall falls into shadow and its near (lower left) wall catches
// the light.
const CRATERS = [
  { id: "c1", x: -34, y: -20, r: 15 },
  { id: "c2", x: 26, y: 22, r: 11 },
  { id: "c3", x: -6, y: 46, r: 8.5 },
  { id: "c4", x: 44, y: -32, r: 7 },
  { id: "c5", x: -56, y: 26, r: 6 },
  { id: "c6", x: 14, y: -58, r: 5.5 },
  { id: "c7", x: 62, y: 14, r: 4.5 },
  { id: "c8", x: -22, y: 18, r: 4 },
  { id: "c9", x: 40, y: 52, r: 4.8 },
  { id: "c10", x: -70, y: -8, r: 3.6 },
  { id: "c11", x: 4, y: -24, r: 3 }
];

const MARIA = [
  {
    id: "m1",
    d: "M -66 -38 C -46 -66, -4 -62, 6 -36 C 14 -16, -16 0, -38 -8 C -58 -14, -78 -22, -66 -38 Z"
  },
  {
    id: "m2",
    d: "M 8 6 C 30 -10, 70 2, 66 30 C 62 56, 26 66, 8 48 C -4 36, -6 20, 8 6 Z"
  },
  {
    id: "m3",
    d: "M 22 -66 C 44 -70, 70 -50, 64 -30 C 58 -16, 36 -24, 26 -36 C 18 -46, 8 -60, 22 -66 Z"
  },
  {
    id: "m4",
    d: "M -60 30 C -48 20, -26 30, -26 46 C -26 62, -50 66, -60 54 C -68 46, -68 38, -60 30 Z"
  }
];

export function Moon() {
  const still = useStill();
  return (
    <motion.g
      style={SCENE_ORIGIN}
      initial={still ? false : { x: MOON.x, y: 470, opacity: 0 }}
      animate={{ x: MOON.x, y: MOON.y, opacity: 1 }}
      transition={{ duration: 2.4, ease: [0.16, 1, 0.3, 1] }}
    >
      <circle r={560} fill="url(#hw-moon-haze)" />
      <circle r={360} fill="url(#hw-moon-glow)">
        <Loop attributeName="opacity" values="1;0.86;1" dur="6s" />
      </circle>
      <circle r={210} fill="url(#hw-moon-ring)" />
      <circle r={MOON.r} fill="url(#hw-moon)" />
      {MARIA.map((mare) => (
        <path key={mare.id} d={mare.d} fill="url(#hw-mare)" />
      ))}
      {CRATERS.map((crater) => {
        const c = 2 * Math.PI * crater.r;
        return (
          <g key={crater.id}>
            <circle
              cx={crater.x}
              cy={crater.y}
              r={crater.r}
              fill="#b38f52"
              opacity={0.6}
            />
            <circle
              cx={crater.x - crater.r * 0.18}
              cy={crater.y + crater.r * 0.18}
              r={crater.r * 0.84}
              fill="#e1c88c"
              opacity={0.9}
            />
            {/* The lit lower-left lip */}
            <circle
              cx={crater.x}
              cy={crater.y}
              r={crater.r}
              fill="none"
              stroke="#fff6d6"
              strokeWidth={Math.max(0.8, crater.r * 0.16)}
              strokeDasharray={`0 ${c * 0.2} ${c * 0.36} ${c}`}
              opacity={0.85}
            />
          </g>
        );
      })}
      {/* The shadowed limb away from the light, and a hairline edge */}
      <circle r={MOON.r} fill="url(#hw-moon-shade)" />
      <circle
        r={MOON.r - 0.5}
        fill="none"
        stroke="#fff8de"
        strokeOpacity={0.35}
        strokeWidth={1}
      />
    </motion.g>
  );
}

/** Pale shafts of moonlight slanting down towards the graveyard. */
export function MoonBeams() {
  const beams = [
    { id: "beam-1", from: -0.66, to: -0.57, opacity: 0.32 },
    { id: "beam-2", from: -0.5, to: -0.46, opacity: 0.22 },
    { id: "beam-3", from: -0.4, to: -0.31, opacity: 0.28 }
  ];
  return (
    <g>
      {beams.map((beam) => {
        const far = 1100;
        const p1 = `${MOON.x - Math.cos(beam.from) * far} ${MOON.y - Math.sin(beam.from) * far}`;
        const p2 = `${MOON.x - Math.cos(beam.to) * far} ${MOON.y - Math.sin(beam.to) * far}`;
        return (
          <path
            key={beam.id}
            d={`M ${MOON.x} ${MOON.y} L ${p1} L ${p2} Z`}
            fill="url(#hw-moonbeam)"
            opacity={beam.opacity}
          >
            <Loop
              attributeName="opacity"
              values={`${beam.opacity};${beam.opacity * 0.5};${beam.opacity}`}
              dur="7s"
            />
          </path>
        );
      })}
    </g>
  );
}

/**
 * A cloud in three passes: a dark underside, the body, then a rim of
 * moonlight along its upper right edge, strongest on the clouds near the moon.
 */
export function Clouds() {
  return (
    <g>
      {CLOUDS.map((cloud) => (
        <g key={cloud.id} transform={`translate(${cloud.x} ${cloud.y})`}>
          <g opacity={cloud.opacity}>
            <path
              d={cloud.d}
              fill="#0d0718"
              opacity={0.6}
              transform="translate(-6 7)"
            />
            {/* The lit copy peeks out past the body along its moonward edge */}
            <path
              d={cloud.d}
              fill="url(#hw-cloud-rim)"
              opacity={0.25 + cloud.lit * 0.75}
            />
            <path
              d={cloud.d}
              fill="url(#hw-cloud)"
              transform={`translate(${-1 - cloud.lit * 2} ${1 + cloud.lit * 2.4})`}
            />
            <LoopTransform
              type="translate"
              values="0 0; 40 0; 0 0"
              dur={`${cloud.drift}s`}
            />
          </g>
        </g>
      ))}
    </g>
  );
}

const WITCH_INK = "#05020a";
const CAPE = {
  a: "M 6 -36 C -14 -38, -38 -36, -64 -44 C -58 -38, -60 -32, -54 -28 C -58 -24, -56 -18, -48 -16 C -34 -16, -22 -12, -12 -4 Z",
  b: "M 6 -36 C -14 -34, -38 -30, -62 -32 C -58 -26, -62 -20, -56 -16 C -60 -10, -56 -6, -48 -6 C -34 -8, -22 -8, -12 -4 Z"
};
const HAIR = {
  a: "M 6 -48 C -6 -47, -16 -41, -28 -44 C -18 -37, -6 -38, 6 -40 Z",
  b: "M 6 -48 C -6 -45, -16 -38, -28 -38 C -18 -33, -6 -36, 6 -40 Z"
};

/** A witch on her broom with her cat, flying right; the broom's middle at 0 0. */
function WitchOnBroom() {
  return (
    <g fill={WITCH_INK}>
      {/* Bristles, bound at the tail of the broomstick */}
      <path d="M -60 6 C -74 1, -92 -7, -110 -9 C -103 -3, -106 3, -112 8 C -104 10, -101 16, -108 22 C -92 20, -75 16, -60 12 Z" />
      <path
        d="M -66 9 L 76 -7"
        fill="none"
        stroke={WITCH_INK}
        strokeWidth={3.6}
        strokeLinecap="round"
      />
      <path d={CAPE.a}>
        <Loop
          attributeName="d"
          values={`${CAPE.a};${CAPE.b};${CAPE.a}`}
          dur="0.9s"
        />
      </path>
      <path d={HAIR.a}>
        <Loop
          attributeName="d"
          values={`${HAIR.a};${HAIR.b};${HAIR.a}`}
          dur="0.7s"
        />
      </path>
      {/* Skirt over the broom, legs out in front, pointed boots */}
      <path d="M -16 2 C -12 14, 2 21, 14 19 L 27 21 C 31 20, 34 16, 36 10 C 33 14, 29 15, 25 14 L 20 11 C 16 6, 12 2, 10 0 Z" />
      <path d="M -14 2 C -16 -12, -8 -28, 4 -36 L 14 -34 C 18 -24, 17 -10, 12 0 Z" />
      <path
        d="M 8 -30 Q 22 -22 36 -4"
        fill="none"
        stroke={WITCH_INK}
        strokeWidth={5}
        strokeLinecap="round"
      />
      <circle cx={12} cy={-43} r={7.5} />
      {/* Hooked nose and chin */}
      <path d="M 18 -46 Q 26 -45 29 -39 Q 24 -41 18 -40 Z" />
      <path d="M 14 -38 L 22 -33 L 12 -35 Z" />
      {/* The hat, its tip bent back by the wind */}
      <ellipse cx={9} cy={-49} rx={18} ry={3.4} transform="rotate(-8 9 -49)" />
      <path d="M -3 -50 C -1 -64, 0 -76, -12 -90 C 0 -86, 12 -72, 20 -52 Z" />

      {/* The cat, perched behind her, tail up */}
      <path d="M -47 6 C -50 -4, -45 -12, -39 -14 C -33 -12, -30 -4, -31 6 Z" />
      <circle cx={-36} cy={-18} r={5.2} />
      <path d="M -40 -21 L -40 -29 L -36 -22 Z M -34.5 -22 L -31 -29 L -31.5 -20 Z" />
      <path
        d="M -47 3 C -57 0, -60 -12, -53 -19"
        fill="none"
        stroke={WITCH_INK}
        strokeWidth={2.6}
        strokeLinecap="round"
      />
      <g stroke="none" fill="#ffd34a">
        <circle cx={-34.2} cy={-18.6} r={0.9} />
        <circle cx={-31.6} cy={-18.4} r={0.9} />
      </g>
    </g>
  );
}

/**
 * The witch crosses the moon once during the reveal, bobbing on her broom.
 * With reduced motion she is caught against the moon.
 */
export function Witch() {
  const still = useStill();
  const rider = (
    <g>
      <LoopTransform
        type="translate"
        values="0 0; 0 -7; 0 0"
        dur="1.9s"
        calcMode="spline"
        keySplines="0.45 0 0.55 1; 0.45 0 0.55 1"
      />
      <WitchOnBroom />
    </g>
  );
  if (still) {
    return (
      <g
        transform={`translate(${MOON.x + 6} ${MOON.y + 6}) rotate(-6) scale(0.64)`}
      >
        {rider}
      </g>
    );
  }
  return (
    <motion.g
      style={SCENE_ORIGIN}
      initial={{ x: 900, y: 300, rotate: -4, scale: 0.5, opacity: 0 }}
      animate={{
        x: [900, 1140, 1340, 1560, 1780],
        y: [300, 262, 236, 196, 150],
        rotate: [-4, -7, -6, -9, -10],
        scale: [0.5, 0.58, 0.62, 0.66, 0.7],
        opacity: [0, 1, 1, 1, 1]
      }}
      transition={{ duration: 9.5, delay: 1.2, ease: "linear" }}
    >
      {rider}
    </motion.g>
  );
}

/** The opening strike: a forked bolt and the sky lighting up behind the hills. */
export function Lightning() {
  const still = useStill();
  if (still) return null;
  const flicker = { opacity: [0, 1, 0, 0.7, 0] };
  return (
    <g>
      <motion.rect
        x={-100}
        y={-40}
        width={1800}
        height={980}
        fill="#8d7cc4"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0.55, 0, 0.3, 0] }}
        transition={STRIKE}
      />
      <motion.g
        fill="none"
        strokeLinejoin="round"
        strokeLinecap="round"
        initial={{ opacity: 0 }}
        animate={flicker}
        transition={STRIKE}
      >
        <path
          d={LIGHTNING.main}
          stroke="#b8a6ff"
          strokeWidth={18}
          opacity={0.16}
        />
        <path
          d={LIGHTNING.main}
          stroke="#e2d9ff"
          strokeWidth={6}
          opacity={0.5}
        />
        <path d={LIGHTNING.main} stroke="#ffffff" strokeWidth={2.4} />
        <path
          d={LIGHTNING.forks}
          stroke="#e2d9ff"
          strokeWidth={4}
          opacity={0.35}
        />
        <path d={LIGHTNING.forks} stroke="#ffffff" strokeWidth={1.2} />
      </motion.g>
    </g>
  );
}

/** The flash over the whole scene, lighter than the one in the sky. */
export function LightningFlash() {
  const still = useStill();
  if (still) return null;
  return (
    <motion.rect
      x={-100}
      y={-40}
      width={1800}
      height={980}
      fill="#e9e3ff"
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 0.2, 0, 0.08, 0] }}
      transition={STRIKE}
    />
  );
}
