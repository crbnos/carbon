// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Drifter, FogPuff, Gravestone as Stone } from "./scene";
import { FAR_RIDGE, FENCE, FIREFLIES, GRAVESTONES, TREE, WISPS } from "./scene";
import { Loop, LoopTransform, useStill } from "./scene-loops";
import { NIGHT, RIM, RIM_SHIFT } from "./scene-palette";

// The graveyard and what lives in it: the iron fence and its gate, the dead
// tree with its owl and lantern, weathered stones with a crow on one, the
// witch's cauldron, fireflies, will-o'-the-wisps and the ground fog.

export function GraveyardDefs() {
  return (
    <>
      <linearGradient id="hw-stone" x1="0" y1="0" x2="1" y2="0.25">
        <stop offset="0" stopColor="#0f0a18" />
        <stop offset="0.55" stopColor="#1b1428" />
        <stop offset="1" stopColor="#2f2545" />
      </linearGradient>
      <linearGradient id="hw-ground" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#1d1131" />
        <stop offset="0.35" stopColor="#120a22" />
        <stop offset="1" stopColor="#0a0514" />
      </linearGradient>
      <linearGradient id="hw-foreground" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#100919" />
        <stop offset="0.5" stopColor="#07040c" />
        <stop offset="1" stopColor="#020104" />
      </linearGradient>
      <radialGradient id="hw-moonlit-ground" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#8f7cc8" stopOpacity={0.16} />
        <stop offset="1" stopColor="#8f7cc8" stopOpacity={0} />
      </radialGradient>
      <linearGradient id="hw-stone-far" x1="0" y1="0" x2="1" y2="0.25">
        <stop offset="0" stopColor="#1d1530" />
        <stop offset="1" stopColor="#30264a" />
      </linearGradient>
      <radialGradient id="hw-fog" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#d9ceff" stopOpacity={1} />
        <stop offset="0.5" stopColor="#c8bbf0" stopOpacity={0.45} />
        <stop offset="1" stopColor="#c8bbf0" stopOpacity={0} />
      </radialGradient>
      <linearGradient id="hw-haze" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#bfb0ec" stopOpacity={0} />
        <stop offset="0.6" stopColor="#bfb0ec" stopOpacity={0.07} />
        <stop offset="1" stopColor="#bfb0ec" stopOpacity={0} />
      </linearGradient>
      <radialGradient id="hw-firefly" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#f6ff9e" stopOpacity={0.95} />
        <stop offset="0.25" stopColor="#d6f55a" stopOpacity={0.4} />
        <stop offset="1" stopColor="#b6e03a" stopOpacity={0} />
      </radialGradient>
      <radialGradient id="hw-wisp" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#f0fffb" stopOpacity={1} />
        <stop offset="0.18" stopColor="#8ff5e0" stopOpacity={0.6} />
        <stop offset="0.5" stopColor="#4fd6c8" stopOpacity={0.14} />
        <stop offset="1" stopColor="#4fd6c8" stopOpacity={0} />
      </radialGradient>
      <radialGradient id="hw-brew" cx="0.45" cy="0.45" r="0.6">
        <stop offset="0" stopColor="#efffb0" />
        <stop offset="0.35" stopColor="#9cff4a" />
        <stop offset="0.8" stopColor="#36b82a" />
        <stop offset="1" stopColor="#1a6a18" />
      </radialGradient>
      <radialGradient id="hw-brew-glow" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#8dff5a" stopOpacity={0.5} />
        <stop offset="0.45" stopColor="#5ae04a" stopOpacity={0.14} />
        <stop offset="1" stopColor="#5ae04a" stopOpacity={0} />
      </radialGradient>
      <linearGradient id="hw-pot" x1="0" y1="0" x2="1" y2="0.3">
        <stop offset="0" stopColor="#09080d" />
        <stop offset="0.6" stopColor="#15131c" />
        <stop offset="1" stopColor="#2c2a3c" />
      </linearGradient>
      <linearGradient id="hw-pot-fire" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0.55" stopColor="#ff7a1a" stopOpacity={0} />
        <stop offset="1" stopColor="#ff7a1a" stopOpacity={0.35} />
      </linearGradient>
      <linearGradient
        id="hw-steam"
        gradientUnits="userSpaceOnUse"
        x1="0"
        y1="-84"
        x2="0"
        y2="-210"
      >
        <stop offset="0" stopColor="#b8ff8a" stopOpacity={0.5} />
        <stop offset="1" stopColor="#b8ff8a" stopOpacity={0} />
      </linearGradient>
      <radialGradient id="hw-flame" cx="0.5" cy="0.7" r="0.6">
        <stop offset="0" stopColor="#fff6c0" />
        <stop offset="0.45" stopColor="#ffb02e" />
        <stop offset="1" stopColor="#e2470a" />
      </radialGradient>
      <radialGradient id="hw-lamp" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#ffd27a" stopOpacity={0.55} />
        <stop offset="0.4" stopColor="#ff9a2e" stopOpacity={0.14} />
        <stop offset="1" stopColor="#ff8a1f" stopOpacity={0} />
      </radialGradient>
      {Object.entries(STONE_OUTLINES).map(([shape, d]) => (
        <clipPath key={shape} id={`hw-stone-${shape}`}>
          <path d={d} />
        </clipPath>
      ))}
    </>
  );
}

/** The far ridge with its cypresses, hazed by distance. */
export function FarRidge() {
  return (
    <g>
      <path d={FAR_RIDGE.d} fill="#26163a" />
      <path d={FAR_RIDGE.trees} fill="#221434" />
      <path
        d={FAR_RIDGE.line}
        fill="none"
        stroke="#4b3870"
        strokeWidth={1.2}
        opacity={0.6}
      />
    </g>
  );
}

export function Fence() {
  const { baseY, gate } = FENCE;
  const posts = (
    <>
      {FENCE.posts.map((post) => (
        <g key={post.id} transform={`rotate(${post.tilt} ${post.x} ${baseY})`}>
          <rect x={post.x - 1.6} y={baseY - 52} width={3.2} height={52} />
          <path
            d={`M ${post.x - 4} ${baseY - 51} L ${post.x} ${baseY - 63} L ${post.x + 4} ${baseY - 51} Z`}
          />
        </g>
      ))}
    </>
  );
  return (
    <g>
      <g fill={RIM} transform={RIM_SHIFT} opacity={0.7}>
        {posts}
      </g>
      <g fill="#0d0818">{posts}</g>
      <path d={FENCE.rails} stroke="#0d0818" strokeWidth={2.4} fill="none" />
      <Gate left={gate.left} right={gate.right} baseY={baseY} />
    </g>
  );
}

/** Stone pillars, a scrolled iron arch, one leaf shut and one hanging open. */
function Gate({
  left,
  right,
  baseY
}: {
  left: number;
  right: number;
  baseY: number;
}) {
  const mid = (left + right) / 2;
  const pillar = (x: number) => (
    <g key={`pillar-${x}`}>
      <rect
        x={x - 7}
        y={baseY - 76}
        width={14}
        height={76}
        fill="url(#hw-stone)"
      />
      <rect x={x - 9} y={baseY - 82} width={18} height={6} fill="#211a33" />
      <path
        d={`M ${x - 5} ${baseY - 82} Q ${x} ${baseY - 96} ${x + 5} ${baseY - 82} Z`}
        fill="#211a33"
      />
      <path
        d={`M ${x + 7} ${baseY - 76} V ${baseY} M ${x + 9} ${baseY - 82} H ${x - 9}`}
        stroke="#4a3d68"
        strokeWidth={1}
      />
    </g>
  );
  const bars = [0, 1, 2, 3];
  return (
    <g>
      <g fill="none" stroke="#0d0818" strokeWidth={2.2} strokeLinecap="round">
        {/* The arch and its scrolls */}
        <path
          d={`M ${left + 7} ${baseY - 66} Q ${mid} ${baseY - 104} ${right - 7} ${baseY - 66}`}
        />
        <path
          d={`M ${left + 7} ${baseY - 58} Q ${mid} ${baseY - 90} ${right - 7} ${baseY - 58}`}
          strokeWidth={1.4}
        />
        <path
          d={`M ${mid - 12} ${baseY - 82} c -6 -2 -6 -9 0 -9 c 4 0 4 5 1 5 M ${mid + 12} ${baseY - 82} c 6 -2 6 -9 0 -9 c -4 0 -4 5 -1 5`}
          strokeWidth={1.3}
        />
        <path d={`M ${mid} ${baseY - 85} V ${baseY - 100}`} />
        <path d={`M ${mid - 5} ${baseY - 96} H ${mid + 5}`} strokeWidth={1.6} />
        {/* The closed leaf */}
        {bars.map((i) => (
          <path
            key={`bar-${i}`}
            d={`M ${left + 10 + i * 5.5} ${baseY - 2} V ${baseY - 58 - i * 1.5}`}
            strokeWidth={1.6}
          />
        ))}
        <path
          d={`M ${left + 8} ${baseY - 12} H ${mid} M ${left + 8} ${baseY - 44} H ${mid}`}
          strokeWidth={1.6}
        />
      </g>
      {/* The open leaf, swung out towards us and sagging off its top hinge */}
      <g
        fill="none"
        stroke="#0d0818"
        strokeWidth={1.6}
        transform={`rotate(-7 ${right - 7} ${baseY - 50})`}
      >
        {bars.map((i) => (
          <path
            key={`open-${i}`}
            d={`M ${right - 9 + i * 7} ${baseY + 4 + i * 2} V ${baseY - 56 + i * 1.5}`}
          />
        ))}
        <path
          d={`M ${right - 9} ${baseY - 6} L ${right + 13} ${baseY} M ${right - 9} ${baseY - 44} L ${right + 13} ${baseY - 40}`}
        />
      </g>
      {pillar(left)}
      {pillar(right)}
    </g>
  );
}

export function Tree() {
  const { fork, hook } = TREE;
  const branches = (
    <>
      {TREE.branches.map((branch) => (
        <path key={branch.id} d={branch.d} strokeWidth={branch.width} />
      ))}
      <path d={TREE.twigs} strokeWidth={3} />
    </>
  );
  return (
    <g>
      <g
        fill="none"
        stroke={RIM}
        strokeLinecap="round"
        transform={RIM_SHIFT}
        opacity={0.85}
      >
        {branches}
      </g>
      <g fill="none" stroke={NIGHT} strokeLinecap="round">
        {branches}
      </g>
      <path d={TREE.limb} fill={RIM} transform={RIM_SHIFT} />
      <path d={TREE.limb} fill={NIGHT} />
      <path d={TREE.roots} fill={NIGHT} />
      {/* A hollow in the trunk */}
      <ellipse cx={1438} cy={742} rx={5} ry={9} fill="#000000" />
      <Owl x={fork.x} y={fork.y} />
      <HangingLantern x={hook.x} y={hook.y} />
    </g>
  );
}

/** An owl in the fork of the tree, turning its head and blinking. */
function Owl({ x, y }: { x: number; y: number }) {
  const body =
    "M -13 0 C -16 -12, -15 -26, -10 -32 L -11 -42 L -5 -36 C -2 -37, 2 -37, 5 -36 L 11 -42 L 10 -32 C 15 -26, 16 -12, 13 0 Z";
  return (
    <g transform={`translate(${x} ${y - 4})`}>
      <path d={body} fill={RIM} transform={RIM_SHIFT} />
      <path d={body} fill="#070410" />
      {/* Folded wing edge and breast feathers */}
      <path
        d="M 11 -24 C 14 -14, 12 -6, 9 -1 M -4 -18 l 2 2 l 2 -2 M 1 -12 l 2 2 l 2 -2 M -5 -8 l 2 2 l 2 -2"
        fill="none"
        stroke="#241a3a"
        strokeWidth={0.9}
      />
      <g>
        <LoopTransform
          type="rotate"
          values="0 0 -28; 0 0 -28; 14 0 -28; 14 0 -28; 0 0 -28"
          keyTimes="0;0.45;0.52;0.85;1"
          dur="7s"
        />
        <path
          d="M -10 -28 C -8 -34, 8 -34, 10 -28 C 8 -22, -8 -22, -10 -28 Z"
          fill="#16102a"
        />
        {[-4.6, 4.6].map((dx) => (
          <g key={`owl-eye-${dx}`}>
            <circle cx={dx} cy={-28} r={4.6} fill="#ffcf3a" />
            <ellipse cx={dx} cy={-28} rx={2} ry={2.6} fill="#120800">
              <Loop
                attributeName="ry"
                values="2.6;2.6;0.2;2.6;2.6"
                keyTimes="0;0.9;0.94;0.98;1"
                dur="4.5s"
              />
            </ellipse>
            <circle cx={dx - 1} cy={-29.4} r={0.8} fill="#ffffff" />
          </g>
        ))}
        <path d="M -1.4 -25 L 0 -21.5 L 1.4 -25 Z" fill="#c98a1f" />
      </g>
      <path
        d="M -6 0 l -2 3 M -3 0 l 0 3 M 3 0 l 0 3 M 6 0 l 2 3"
        stroke="#3a2a10"
        strokeWidth={1.2}
      />
    </g>
  );
}

/** An old iron lantern swinging gently on its chain from the low limb. */
function HangingLantern({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g>
        <LoopTransform
          type="rotate"
          values="-5 0 0; 5 0 0; -5 0 0"
          dur="3.6s"
          calcMode="spline"
          keySplines="0.45 0 0.55 1; 0.45 0 0.55 1"
        />
        <circle cx={0} cy={44} r={70} fill="url(#hw-lamp)">
          <Loop attributeName="opacity" values="1;0.75;1;0.85;1" dur="2.4s" />
        </circle>
        <path
          d="M 0 0 V 30"
          stroke="#1a1426"
          strokeWidth={1.4}
          strokeDasharray="2.4 1.2"
        />
        <path d="M -8 34 L 0 28 L 8 34 Z" fill="#0b0814" />
        <rect x={-7} y={34} width={14} height={18} fill="#ffcf6a" opacity={0.9}>
          <Loop
            attributeName="opacity"
            values="0.9;0.7;0.95;0.8;0.9"
            dur="1.7s"
          />
        </rect>
        <path
          d="M -7 34 V 52 M 0 34 V 52 M 7 34 V 52"
          stroke="#0b0814"
          strokeWidth={1.4}
        />
        <path d="M -9 52 H 9 L 6 56 H -6 Z" fill="#0b0814" />
        <circle
          cx={0}
          cy={26}
          r={2.2}
          fill="none"
          stroke="#0b0814"
          strokeWidth={1.4}
        />
      </g>
    </g>
  );
}

// Each outline sits on its base at 0 0. A chip or a broken corner on most of
// them, so no two read as the same mason's work.
const STONE_OUTLINES: Record<Stone["shape"], string> = {
  round:
    "M -26 0 L -26 -58 A 26 26 0 0 1 14 -79.9 L 15 -73 L 22 -71.9 A 26 26 0 0 1 26 -58 L 26 0 Z",
  cross:
    "M -6 0 L -6 -60 L -22 -60 L -22 -72 L -6 -72 L -6 -92 L 6 -92 L 6 -72 L 22 -72 L 22 -64 L 18 -61 L 6 -60 L 6 0 Z",
  arch: "M -22 0 L -22 -50 Q -22 -78 0 -94 Q 22 -78 22 -50 L 22 0 Z",
  slab: "M -24 0 L -24 -66 L -18 -70 L 12 -70 L 16 -63 L 20 -66 L 24 -64 L 24 0 Z",
  obelisk:
    "M -24 0 L -24 -12 L -16 -15 L -11 -92 L 0 -110 L 11 -92 L 16 -15 L 24 -12 L 24 0 Z",
  celtic:
    "M -6 0 L -6 -56 L -22 -56 L -22 -68 L -6 -68 L -6 -90 L 6 -90 L 6 -68 L 22 -68 L 22 -56 L 6 -56 L 6 0 Z"
};

// Moss gathers at the foot and on the shaded left shoulder.
const MOSS = [
  { id: "moss-foot", cx: -10, cy: -2, rx: 18, ry: 6 },
  { id: "moss-shoulder", cx: -22, cy: -52, rx: 9, ry: 12 },
  { id: "moss-speck", cx: 8, cy: -14, rx: 5, ry: 3 }
];

export function Gravestone({ stone }: { stone: Stone }) {
  const { x, y, scale, tilt, shape, far } = stone;
  const outline = STONE_OUTLINES[shape];
  const engraved = shape === "round" || shape === "arch" || shape === "slab";
  return (
    <g transform={`translate(${x} ${y})`}>
      {/* The mound of earth it leans out of */}
      <ellipse cx={4} cy={2} rx={44 * scale} ry={7 * scale} fill="#08040e" />
      <g transform={`rotate(${tilt}) scale(${scale})`}>
        <path d={outline} fill={RIM} transform="translate(2 -1.6)" />
        <path
          d={outline}
          fill={far ? "url(#hw-stone-far)" : "url(#hw-stone)"}
        />
        {shape === "celtic" && (
          <g fill="none">
            <circle
              cx={0}
              cy={-62}
              r={14}
              stroke={RIM}
              strokeWidth={5}
              transform="translate(1.6 -1.2)"
            />
            <circle cx={0} cy={-62} r={14} stroke="#1a1327" strokeWidth={5} />
          </g>
        )}
        <g clipPath={`url(#hw-stone-${shape})`}>
          {MOSS.map((moss) => (
            <ellipse
              key={moss.id}
              cx={moss.cx}
              cy={moss.cy}
              rx={moss.rx}
              ry={moss.ry}
              fill="#2e4a2a"
              opacity={far ? 0.25 : 0.55}
            />
          ))}
          {/* Weathering streaks run down from the top */}
          <path
            d="M -12 -90 V -20 M 4 -90 V -40 M 16 -90 V -30"
            stroke="#000000"
            strokeWidth={2}
            opacity={0.18}
          />
        </g>
        {engraved && (
          <g fill="#07040c" opacity={far ? 0.5 : 0.9}>
            <rect x={-3} y={-72} width={6} height={18} rx={1} />
            <rect x={-9} y={-67} width={18} height={5} rx={1} />
            <rect x={-14} y={-44} width={28} height={2.4} rx={1} />
            <rect x={-10} y={-37} width={20} height={2} rx={1} />
            <rect x={-12} y={-30} width={24} height={2} rx={1} />
          </g>
        )}
        {/* A crack, with its lit edge */}
        <path
          d="M 11 -36 l -5 8 l 4 6 l -4 9 l 3 5"
          stroke="#4a3d66"
          strokeWidth={1}
          fill="none"
          transform="translate(0.8 -0.6)"
          opacity={far ? 0.3 : 0.7}
        />
        <path
          d="M 11 -36 l -5 8 l 4 6 l -4 9 l 3 5"
          stroke="#05020a"
          strokeWidth={1.2}
          fill="none"
        />
      </g>
    </g>
  );
}

export function Gravestones() {
  return (
    <g>
      {GRAVESTONES.map((stone) => (
        <Gravestone key={stone.id} stone={stone} />
      ))}
      <Crow />
    </g>
  );
}

/** A crow on top of the arched stone, bobbing its head. */
function Crow() {
  const perch = GRAVESTONES.find((stone) => stone.id === "stone-3");
  if (!perch) return null;
  const top = perch.y - 94 * perch.scale;
  const body =
    "M -9 -10 C -4 -18, 8 -18, 13 -11 L 26 -2 L 24 1 L 11 -3 C 6 0, -4 0, -9 -4 Z";
  return (
    <g transform={`translate(${perch.x} ${top + 1}) scale(1.05)`}>
      <path d={body} fill={RIM} transform={RIM_SHIFT} />
      <path d={body} fill="#04020a" />
      <path
        d="M -1 -3 L -3 2 M 4 -3 L 3 2"
        stroke="#04020a"
        strokeWidth={1.3}
      />
      <g>
        <LoopTransform
          type="rotate"
          values="0 -6 -12; 0 -6 -12; 18 -6 -12; 0 -6 -12; 0 -6 -12; -8 -6 -12; 0 -6 -12"
          keyTimes="0;0.3;0.36;0.42;0.7;0.76;1"
          dur="4.2s"
        />
        <circle cx={-10} cy={-17} r={6} fill="#04020a" />
        <path d="M -15 -18.5 L -24 -16 L -15 -14 Z" fill="#04020a" />
        <circle cx={-11.5} cy={-18.5} r={1} fill="#ffcf4a" />
        <path
          d="M -6 -22 A 6 6 0 0 1 -4.5 -14"
          fill="none"
          stroke={RIM}
          strokeWidth={1}
        />
      </g>
    </g>
  );
}

const BUBBLES = [
  { id: "b1", x: -18, r: 4, dur: 2.2, begin: 0, drift: -6 },
  { id: "b2", x: 10, r: 3, dur: 2.8, begin: 0.6, drift: 8 },
  { id: "b3", x: 26, r: 2.4, dur: 2, begin: 1.3, drift: -4 },
  { id: "b4", x: -4, r: 3.4, dur: 3.1, begin: 1.8, drift: 6 },
  { id: "b5", x: -30, r: 2.2, dur: 2.5, begin: 0.9, drift: 3 }
];

const POPS = [
  { id: "pop-1", x: -24, y: -82, dur: 1.6, begin: 0 },
  { id: "pop-2", x: 18, y: -79, dur: 1.9, begin: 0.7 },
  { id: "pop-3", x: 2, y: -84, dur: 1.4, begin: 1.1 }
];

const STEAM = {
  a: "M -8 -86 C -20 -110, 6 -128, -6 -150 S -22 -186, -2 -210",
  b: "M -8 -86 C 6 -110, -16 -130, -2 -152 S 8 -186, -10 -210"
};

/** The witch's cauldron over a log fire, its brew glowing and bubbling. */
export function Cauldron({ x, y }: { x: number; y: number }) {
  const still = useStill();
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cx={0} cy={-2} rx={190} ry={36} fill="url(#hw-brew-glow)" />
      <ellipse cx={0} cy={-90} rx={190} ry={170} fill="url(#hw-brew-glow)">
        <Loop attributeName="opacity" values="1;0.8;1;0.88;1" dur="2.6s" />
      </ellipse>
      <ellipse cx={0} cy={-6} rx={70} ry={14} fill="url(#hw-lamp)" />

      {/* Logs and flames under the pot */}
      <g fill="#1e110c">
        <rect
          x={-46}
          y={-12}
          width={92}
          height={9}
          rx={4}
          transform="rotate(10 0 -8)"
        />
        <rect
          x={-46}
          y={-12}
          width={92}
          height={9}
          rx={4}
          transform="rotate(-12 0 -8)"
        />
      </g>
      {/* Three stubby legs, then the pot */}
      <path
        d="M -44 -14 L -50 0 L -40 0 L -34 -16 Z M 34 -16 L 40 0 L 50 0 L 44 -14 Z"
        fill="#0a090f"
      />
      <path
        d="M -62 -78 C -72 -42, -56 -16, -30 -10 L 30 -10 C 56 -16, 72 -42, 62 -78 Z"
        fill="url(#hw-pot)"
      />
      <path
        d="M -62 -78 C -72 -42, -56 -16, -30 -10 L 30 -10 C 56 -16, 72 -42, 62 -78 Z"
        fill="url(#hw-pot-fire)"
      />
      {/* Flames licking up round the bottom of the pot */}
      {[
        { id: "flame-1", x: -22, s: 0.9, dur: 0.5 },
        { id: "flame-2", x: 20, s: 1, dur: 0.42 },
        { id: "flame-3", x: -1, s: 1.25, dur: 0.6 }
      ].map((flame) => (
        <g
          key={flame.id}
          transform={`translate(${flame.x} -4) scale(${flame.s})`}
        >
          <path
            d="M 0 0 C -9 -4, -8 -14, -3 -20 C -2 -14, 2 -16, 0 -26 C 8 -18, 10 -6, 0 0 Z"
            fill="url(#hw-flame)"
          >
            <LoopTransform
              type="scale"
              values="1 1; 1.08 0.86; 0.94 1.1; 1 1"
              dur={`${flame.dur}s`}
            />
          </path>
        </g>
      ))}

      {/* Green light on the pot's shoulder, moonlight down its right side */}
      <path
        d="M -58 -72 C -40 -66, 40 -66, 58 -72"
        fill="none"
        stroke="#7dff5a"
        strokeWidth={2}
        opacity={0.35}
      />
      <path
        d="M 62 -72 C 68 -46, 58 -24, 40 -14"
        fill="none"
        stroke="#7a6aa6"
        strokeWidth={2}
        opacity={0.6}
      />
      <ellipse
        cx={0}
        cy={-80}
        rx={67}
        ry={12}
        fill="#14121b"
        stroke="#2c2a3a"
        strokeWidth={3}
      />
      <ellipse cx={0} cy={-80} rx={58} ry={8.5} fill="url(#hw-brew)" />
      <path
        d="M -58 -80 A 58 8.5 0 0 0 58 -80"
        fill="none"
        stroke="#d6ffa0"
        strokeWidth={1.2}
        opacity={0.6}
      />

      {/* Bubbles popping on the surface */}
      {POPS.map((pop) => (
        <circle
          key={pop.id}
          cx={pop.x}
          cy={pop.y}
          r={still ? 3 : 0}
          fill="#c8ff8a"
          stroke="#efffd0"
          strokeWidth={0.8}
        >
          <Loop
            attributeName="r"
            values="0;4;5;0"
            keyTimes="0;0.6;0.8;1"
            dur={`${pop.dur}s`}
            begin={`${pop.begin}s`}
          />
        </circle>
      ))}
      {/* Bubbles that lift off and float up in the steam */}
      {BUBBLES.map((bubble, i) => (
        <circle
          key={bubble.id}
          cx={bubble.x}
          cy={still ? -100 - i * 16 : -84}
          r={bubble.r}
          fill="none"
          stroke="#c8ff8a"
          strokeWidth={1}
          opacity={still ? 0.7 - i * 0.1 : 0}
        >
          <Loop
            attributeName="cy"
            values="-84;-180"
            dur={`${bubble.dur}s`}
            begin={`${bubble.begin}s`}
          />
          <Loop
            attributeName="cx"
            values={`${bubble.x};${bubble.x + bubble.drift};${bubble.x - bubble.drift / 2}`}
            dur={`${bubble.dur}s`}
            begin={`${bubble.begin}s`}
          />
          <Loop
            attributeName="opacity"
            values="0;0.9;0.6;0"
            keyTimes="0;0.15;0.7;1"
            dur={`${bubble.dur}s`}
            begin={`${bubble.begin}s`}
          />
        </circle>
      ))}
      {[0, 1].map((i) => (
        <path
          key={`steam-${i}`}
          d={STEAM.a}
          transform={i === 1 ? "translate(22 6) scale(0.8)" : undefined}
          fill="none"
          stroke="url(#hw-steam)"
          strokeWidth={9}
          strokeLinecap="round"
          strokeDasharray="40 26"
          opacity={0.7}
        >
          <Loop
            attributeName="stroke-dashoffset"
            values="0;-132"
            dur={`${3.4 + i}s`}
          />
          <Loop
            attributeName="d"
            values={`${STEAM.a};${STEAM.b};${STEAM.a}`}
            dur={`${4.4 + i}s`}
          />
        </path>
      ))}
    </g>
  );
}

function Drifting({
  drifter,
  fill,
  glow
}: {
  drifter: Drifter;
  fill: string;
  glow: number;
}) {
  const { x, y, dx, dy, dur, blink, begin, r } = drifter;
  return (
    <g transform={`translate(${x} ${y})`}>
      <g>
        <LoopTransform
          type="translate"
          values={`0 0; ${dx} ${dy * 0.4}; ${dx * 0.4} ${dy}; ${-dx * 0.3} ${dy * 0.5}; 0 0`}
          dur={`${dur}s`}
          begin={`${begin}s`}
          calcMode="spline"
          keySplines="0.45 0 0.55 1; 0.45 0 0.55 1; 0.45 0 0.55 1; 0.45 0 0.55 1"
        />
        <circle r={r * glow} fill={fill}>
          <Loop
            attributeName="opacity"
            values="1;0.25;0.9;0.4;1"
            dur={`${blink}s`}
            begin={`${begin}s`}
          />
        </circle>
      </g>
    </g>
  );
}

/** Fireflies blinking about the graves. */
export function Fireflies() {
  return (
    <g>
      {FIREFLIES.map((fly) => (
        <Drifting key={fly.id} drifter={fly} fill="url(#hw-firefly)" glow={5} />
      ))}
    </g>
  );
}

/** Will-o'-the-wisps: cold blue-green lights, larger and slower. */
export function Wisps() {
  return (
    <g>
      {WISPS.map((wisp) => (
        <Drifting key={wisp.id} drifter={wisp} fill="url(#hw-wisp)" glow={7} />
      ))}
    </g>
  );
}

/**
 * A bank of ground fog: soft puffs over a faint haze band, the whole bank
 * sliding slowly sideways. Moving the bank, not the gradients, keeps it cheap.
 */
export function Fog({
  puffs,
  y,
  opacity,
  drift,
  reach
}: {
  puffs: FogPuff[];
  y: number;
  opacity: number;
  drift: number;
  reach: number;
}) {
  return (
    <g>
      <rect
        x={-100}
        y={y - 60}
        width={1800}
        height={110}
        fill="url(#hw-haze)"
      />
      <g opacity={opacity}>
        <g>
          {puffs.map((puff) => (
            <ellipse
              key={puff.id}
              cx={puff.cx}
              cy={puff.cy}
              rx={puff.rx}
              ry={puff.ry}
              fill="url(#hw-fog)"
            />
          ))}
          <LoopTransform
            type="translate"
            values={`${-reach} 0; ${reach} 0; ${-reach} 0`}
            dur={`${drift}s`}
            calcMode="spline"
            keySplines="0.45 0 0.55 1; 0.45 0 0.55 1"
          />
        </g>
      </g>
    </g>
  );
}
