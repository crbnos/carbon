// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { motion } from "motion/react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Bat } from "./Bat";
import { JackOLanterns, LANTERN_THUD_AT } from "./Pumpkins";
import { SpiderBody } from "./Spider";
import type { BatFlight } from "./scene";
import { BATS, FAR_GRASS, FOG, GRASS, WEEDS } from "./scene";
import {
  Cauldron,
  FarRidge,
  Fence,
  Fireflies,
  Fog,
  Gravestones,
  GraveyardDefs,
  Tree,
  Wisps
} from "./scene-graveyard";
import { HauntedHouse, HouseDefs } from "./scene-house";
import {
  Loop,
  LoopTransform,
  SCENE_ORIGIN,
  StillContext,
  useStill
} from "./scene-loops";
import { GROUND, HILL, NIGHT } from "./scene-palette";
import {
  Clouds,
  Lightning,
  LightningFlash,
  Moon,
  MoonBeams,
  ShootingStars,
  Sky,
  SkyDefs,
  Stars,
  Witch
} from "./scene-sky";

// The surprise behind the spider web: a moonlit graveyard. Lightning opens
// the night, a witch crosses the moon, a haunted house lets out a colony of
// bats, a ghost rises from a grave, jack-o'-lanterns arrive and are lit one by
// one, the cauldron bubbles and a spider drops in on its thread.
//
// The layers are painted back to front and drift apart very slowly, the near
// ones further than the far ones, so the night has depth.

/** The night scene on its own: the reveal puts it on screen. */
export function HalloweenScene({
  title,
  still
}: {
  title: string;
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
          <Sky />
          <Depth shift={4}>
            <Stars />
            <ShootingStars />
          </Depth>
          <Lightning />
          <Depth shift={6}>
            <Moon />
            <MoonBeams />
            <Witch />
            <Clouds />
            {BATS.slice(0, 2).map((bat) => (
              <FlyingBat key={bat.id} flight={bat} silhouette />
            ))}
          </Depth>

          {/* The far ridge, the hills, then the house on its rise */}
          <Depth shift={10}>
            <FarRidge />
            <path
              d="M -100 640 C 200 590, 380 612, 560 632 S 900 598, 1100 624 S 1400 588, 1700 614 L 1700 940 L -100 940 Z"
              fill={HILL}
            />
            <HauntedHouse />
          </Depth>

          <Depth shift={16}>
            <path
              d="M -100 704 C 300 672, 600 690, 900 700 S 1350 680, 1700 690 L 1700 940 L -100 940 Z"
              fill="url(#hw-ground)"
            />
            {/* Moonlight pooled on the open ground on the moon's side */}
            <ellipse
              cx={1180}
              cy={730}
              rx={420}
              ry={50}
              fill="url(#hw-moonlit-ground)"
            />
            <path
              d="M 900 700 S 1350 680, 1700 690"
              fill="none"
              stroke="#3a2c58"
              strokeWidth={1.2}
              opacity={0.6}
            />
            <Fog puffs={FOG.far} y={708} opacity={0.17} drift={26} reach={50} />
            <path d={FAR_GRASS} fill={GROUND} />
            <Fence />
            <Wisps />
            <Tree />
            <Ghost />
          </Depth>

          {/* Foreground graveyard */}
          <Depth shift={24}>
            <path
              d="M -100 770 C 260 728, 520 752, 760 760 S 1200 736, 1700 752 L 1700 940 L -100 940 Z"
              fill="url(#hw-foreground)"
            />
            <path
              d="M 760 760 S 1200 736, 1700 752"
              fill="none"
              stroke="#2a1f42"
              strokeWidth={1.4}
            />
            <Fog puffs={FOG.mid} y={786} opacity={0.12} drift={21} reach={60} />
            <Gravestones />
            <path d={GRASS} fill={NIGHT} />
            <Cauldron x={318} y={846} />
            <JackOLanterns />
            <Fireflies />
            <Fog
              puffs={FOG.near}
              y={880}
              opacity={0.11}
              drift={17}
              reach={70}
            />
            <path d={WEEDS} fill="#030106" />
          </Depth>

          <Title title={title} />
          {BATS.slice(2).map((bat) => (
            <FlyingBat key={bat.id} flight={bat} />
          ))}
          <DroppingSpider />
        </Thud>

        <rect
          x={-100}
          y={-40}
          width={1800}
          height={980}
          fill="url(#hw-vignette)"
        />
        <LightningFlash />
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

/**
 * A slow sideways drift over the whole reveal: a layer `shift` units deep
 * travels that far, so near layers slide past far ones like a camera pan.
 */
function Depth({ shift, children }: { shift: number; children: ReactNode }) {
  const still = useStill();
  if (still) return <g>{children}</g>;
  return (
    <motion.g
      initial={{ x: shift / 2 }}
      animate={{ x: -shift / 2 }}
      transition={{ duration: 11, ease: "linear" }}
    >
      {children}
    </motion.g>
  );
}

function SceneDefs() {
  return (
    <defs>
      <SkyDefs />
      <HouseDefs />
      <GraveyardDefs />
      {/* Shared with the jack-o'-lanterns */}
      <radialGradient id="hw-pumpkin" cx="0.38" cy="0.32" r="0.78">
        <stop offset="0" stopColor="#ffb25a" />
        <stop offset="0.5" stopColor="#f47b16" />
        <stop offset="1" stopColor="#a33a06" />
      </radialGradient>
      <radialGradient id="hw-bloom" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#ffcf4a" stopOpacity={0.55} />
        <stop offset="1" stopColor="#ff8a1f" stopOpacity={0} />
      </radialGradient>
      <radialGradient id="hw-floor-glow" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#ff8a1f" stopOpacity={0.55} />
        <stop offset="0.5" stopColor="#ff6a1a" stopOpacity={0.16} />
        <stop offset="1" stopColor="#ff6a1a" stopOpacity={0} />
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

      {/* The title: molten at the top, cooling to ember red at the foot */}
      <linearGradient id="hw-title" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fff4c2" />
        <stop offset="0.22" stopColor="#ffd25e" />
        <stop offset="0.55" stopColor="#ff8a1f" />
        <stop offset="0.85" stopColor="#d8410c" />
        <stop offset="1" stopColor="#9e2306" />
      </linearGradient>
      <radialGradient id="hw-title-halo" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#ff7a1a" stopOpacity={0.28} />
        <stop offset="0.6" stopColor="#c2370f" stopOpacity={0.08} />
        <stop offset="1" stopColor="#c2370f" stopOpacity={0} />
      </radialGradient>
      <radialGradient id="hw-vignette" cx="0.5" cy="0.45" r="0.78">
        <stop offset="0.5" stopColor="#000000" stopOpacity={0} />
        <stop offset="0.85" stopColor="#05010a" stopOpacity={0.45} />
        <stop offset="1" stopColor="#000000" stopOpacity={0.78} />
      </radialGradient>
      {/* The title's glow. Static: only the halo under it flickers. */}
      <filter id="hw-title-glow" x="-20%" y="-60%" width="140%" height="220%">
        <feGaussianBlur stdDeviation="12" />
      </filter>
    </defs>
  );
}

export const GHOST_BODY = {
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

const TITLE_FONT = "Georgia, 'Times New Roman', serif";
const TITLE_X = 740;
const TITLE_Y = 212;
// The scene's centre, which `xMidYMid slice` always keeps on screen.
const SCENE_CENTRE = 800;
const TITLE_MARGIN = 40;

/**
 * Where the title sits and how big, so it is never cut off. The scene is
 * cropped to fill the window, so a portrait or narrow window shows only a
 * middle band of it; a title too long for that band (a long translation, a
 * tablet held upright) is centred and shrunk to fit.
 */
function useTitleFit() {
  const ref = useRef<SVGTextElement>(null);
  const [fit, setFit] = useState({ x: TITLE_X, scale: 1 });
  useEffect(() => {
    const text = ref.current;
    const svg = text?.ownerSVGElement;
    if (!text || !svg) return;
    const measure = () => {
      const { width, height } = svg.getBoundingClientRect();
      const length = text.getComputedTextLength();
      if (!width || !height || !length) return;
      const visible = Math.min(1600, (900 * width) / height);
      const half = visible / 2 - TITLE_MARGIN;
      const fitsInPlace =
        TITLE_X - length / 2 >= SCENE_CENTRE - half &&
        TITLE_X + length / 2 <= SCENE_CENTRE + half;
      setFit(
        fitsInPlace
          ? { x: TITLE_X, scale: 1 }
          : { x: SCENE_CENTRE, scale: Math.min(1, half / (length / 2)) }
      );
    };
    measure();
    const resized = new ResizeObserver(measure);
    resized.observe(svg);
    return () => resized.disconnect();
  }, []);
  return { ref, ...fit };
}

function Title({ title }: { title: string }) {
  const still = useStill();
  const fit = useTitleFit();
  const lettering = {
    x: TITLE_X,
    y: TITLE_Y,
    textAnchor: "middle",
    fontFamily: TITLE_FONT,
    fontWeight: 700,
    fontSize: 98,
    letterSpacing: 3
  } as const;
  return (
    <g
      transform={`translate(${fit.x} ${TITLE_Y}) scale(${fit.scale}) translate(${-TITLE_X} ${-TITLE_Y})`}
    >
      <motion.g
        initial={still ? false : { opacity: 0 }}
        animate={{ opacity: [0, 1, 0.25, 1, 0.55, 1] }}
        transition={{
          duration: 1.5,
          delay: 1.3,
          times: [0, 0.18, 0.3, 0.48, 0.62, 1]
        }}
      >
        <ellipse
          cx={TITLE_X}
          cy={180}
          rx={560}
          ry={120}
          fill="url(#hw-title-halo)"
        >
          <Loop attributeName="opacity" values="1;0.7;1;0.82;1" dur="2.2s" />
        </ellipse>
        <text
          ref={fit.ref}
          {...lettering}
          fill="#ff6a12"
          filter="url(#hw-title-glow)"
        >
          {title}
        </text>
        {/* Cut deep: a dark shadow below, the letters, then their bevel */}
        <text
          {...lettering}
          y={218}
          fill="#1a0400"
          stroke="#1a0400"
          strokeWidth={6}
          strokeLinejoin="round"
          opacity={0.75}
        >
          {title}
        </text>
        <text
          {...lettering}
          fill="url(#hw-title)"
          stroke="#3a0d00"
          strokeWidth={3.2}
          strokeLinejoin="round"
          paintOrder="stroke"
        >
          {title}
        </text>
        <text
          {...lettering}
          fill="none"
          stroke="#fff3c8"
          strokeWidth={0.8}
          opacity={0.45}
        >
          {title}
        </text>
      </motion.g>
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
            animateLegs={!still}
            rimOpacity={0.3}
          />
        </g>
      </g>
    </motion.g>
  );
}
