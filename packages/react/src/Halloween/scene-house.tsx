// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ReactNode } from "react";
import { Loop, LoopTransform, useStill } from "./scene-loops";
import { RIM, RIM_SHIFT, SILHOUETTE } from "./scene-palette";

// The haunted house on its rise: a gabled main house, a lower wing and a
// tower with a spire, the colony's belfry near its top. Warm light leaks from
// every window onto the hill, smoke drifts from the crooked chimney, and
// someone paces behind one of the windows.

type Window = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  dur: number;
  /** Goes dark now and then, as if a lamp were carried out of the room. */
  out: boolean;
  /** Which side its loose shutter hangs on, if it has one. */
  shutter?: "left" | "right";
};

const WINDOWS: Window[] = [
  {
    id: "w-main-1",
    x: 268,
    y: 498,
    w: 26,
    h: 34,
    dur: 2.3,
    out: false,
    shutter: "left"
  },
  {
    id: "w-main-2",
    x: 374,
    y: 498,
    w: 26,
    h: 34,
    dur: 3.1,
    out: true,
    shutter: "right"
  },
  { id: "w-main-3", x: 266, y: 558, w: 24, h: 30, dur: 2.7, out: false },
  { id: "w-main-4", x: 384, y: 558, w: 20, h: 30, dur: 1.9, out: false },
  {
    id: "w-wing",
    x: 214,
    y: 552,
    w: 24,
    h: 28,
    dur: 3.6,
    out: false,
    shutter: "left"
  },
  { id: "w-tower-2", x: 424, y: 490, w: 26, h: 32, dur: 2.9, out: false },
  { id: "w-tower-slit", x: 431, y: 550, w: 12, h: 26, dur: 2.2, out: false }
];

const ROOFS = {
  wing: "M 184 536 L 227 494 L 270 536 Z",
  main: "M 234 484 Q 286 446 336 400 L 438 484 Z",
  spire: "M 396 398 Q 424 352 437 290 Q 450 352 478 398 Z",
  porch: "M 292 567 L 384 567 L 373 553 L 303 553 Z"
};

const WALLS = {
  wing: { x: 196, y: 532, w: 62, h: 82 },
  main: { x: 252, y: 478, w: 168, h: 136 },
  tower: { x: 408, y: 392, w: 58, h: 222 }
};

const SMOKE_PUFFS = [0, 1, 2, 3, 4];

export function HouseDefs() {
  return (
    <>
      <radialGradient id="hw-window-glow" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#ffb547" stopOpacity={0.6} />
        <stop offset="0.5" stopColor="#ff9a2e" stopOpacity={0.16} />
        <stop offset="1" stopColor="#ff8a1f" stopOpacity={0} />
      </radialGradient>
      <linearGradient id="hw-window" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#ffe08a" />
        <stop offset="0.6" stopColor="#ffb547" />
        <stop offset="1" stopColor="#f08a22" />
      </linearGradient>
      <radialGradient id="hw-smoke-puff" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#8a7ea8" stopOpacity={0.55} />
        <stop offset="0.6" stopColor="#6e6290" stopOpacity={0.2} />
        <stop offset="1" stopColor="#6e6290" stopOpacity={0} />
      </radialGradient>
      {/* Rows of scalloped shingles, and clapboard on the walls */}
      <pattern
        id="hw-shingles"
        width={9}
        height={6}
        patternUnits="userSpaceOnUse"
      >
        <path
          d="M 0 6 Q 2.25 2.5 4.5 6 Q 6.75 2.5 9 6"
          fill="none"
          stroke="#21173a"
          strokeWidth={0.9}
        />
      </pattern>
      <pattern
        id="hw-siding"
        width={12}
        height={7}
        patternUnits="userSpaceOnUse"
      >
        <path d="M 0 6.5 H 12" stroke="#160e27" strokeWidth={1} />
      </pattern>
      <clipPath id="hw-pacing-window">
        <rect x={268} y={498} width={26} height={34} />
      </clipPath>
    </>
  );
}

/** The outline of the whole house: drawn once as a rim, then as the house. */
function HouseShape() {
  return (
    <>
      <rect
        x={WALLS.wing.x}
        y={WALLS.wing.y}
        width={WALLS.wing.w}
        height={WALLS.wing.h}
      />
      <path d={ROOFS.wing} />
      {/* The crooked chimney */}
      <path d="M 280 450 L 300 444 L 306 478 L 287 482 Z" />
      <path d="M 277 449 L 302 441 L 303 446 L 278 453 Z" />
      <rect
        x={WALLS.main.x}
        y={WALLS.main.y}
        width={WALLS.main.w}
        height={WALLS.main.h}
      />
      <path d={ROOFS.main} />
      <path d={ROOFS.porch} />
      <rect x={302} y={566} width={4} height={48} />
      <rect x={370} y={566} width={4} height={48} />
      <rect
        x={WALLS.tower.x}
        y={WALLS.tower.y}
        width={WALLS.tower.w}
        height={WALLS.tower.h}
      />
      <path d={ROOFS.spire} />
      {/* A widow's walk round the base of the spire */}
      <rect x={402} y={386} width={70} height={4} />
      <rect x={435.5} y={260} width={3} height={34} />
      <circle cx={437} cy={260} r={3.5} />
      {/* Front steps */}
      <path d="M 318 614 L 358 614 L 362 620 L 314 620 Z" />
    </>
  );
}

export function HauntedHouse() {
  return (
    <g>
      <path
        d="M 20 706 C 110 610, 300 586, 470 608 C 570 622, 640 664, 708 706 Z"
        fill="#140b23"
      />
      {/* Moonlight along the crest of the rise */}
      <path
        d="M 300 590 C 380 590, 430 598, 470 608 C 570 622, 640 664, 708 706"
        fill="none"
        stroke="#4a3a6c"
        strokeWidth={1.4}
        opacity={0.55}
      />
      {/* A worn path from the door down the hill */}
      <path
        d="M 322 620 C 316 640, 290 650, 270 668 C 250 686, 240 698, 230 708 L 262 708 C 270 694, 290 676, 312 660 C 334 644, 352 636, 354 620 Z"
        fill="#21153a"
        opacity={0.8}
      />

      {/* Window light spills out first, so the walls cut it off */}
      {WINDOWS.map((w) => (
        <ellipse
          key={`${w.id}-glow`}
          cx={w.x + w.w / 2}
          cy={w.y + w.h / 2}
          rx={w.w * 2.2}
          ry={w.h * 1.6}
          fill="url(#hw-window-glow)"
        >
          <Loop
            attributeName="opacity"
            values={w.out ? "1;1;0.1;0.1;1" : "1;0.75;1;0.85;1"}
            dur={`${w.out ? 7 : w.dur}s`}
          />
        </ellipse>
      ))}
      <ellipse
        cx={338}
        cy={626}
        rx={120}
        ry={18}
        fill="url(#hw-window-glow)"
        opacity={0.8}
      />

      <g fill={RIM} transform={RIM_SHIFT}>
        <HouseShape />
      </g>
      <g fill={SILHOUETTE}>
        <HouseShape />
      </g>
      {/* The widow's walk railing */}
      <path
        d="M 404 386 V 376 M 414 386 V 376 M 424 386 V 376 M 450 386 V 376 M 460 386 V 376 M 470 386 V 376 M 402 376 H 472"
        stroke={SILHOUETTE}
        strokeWidth={1.6}
      />

      {/* Shingles and clapboard, catching a little of the moon */}
      <g fill="url(#hw-shingles)">
        <path d={ROOFS.wing} />
        <path d={ROOFS.main} />
        <path d={ROOFS.spire} />
      </g>
      <g fill="url(#hw-siding)">
        {Object.entries(WALLS).map(([id, wall]) => (
          <rect key={id} x={wall.x} y={wall.y} width={wall.w} height={wall.h} />
        ))}
      </g>
      {/* Eaves and the roof's broken ridge */}
      <path
        d="M 232 485 L 336 400 L 440 485 M 182 537 L 227 494 L 272 537"
        fill="none"
        stroke="#2e2248"
        strokeWidth={1.4}
        strokeLinejoin="round"
      />
      <path
        d="M 336 400 L 346 408 L 341 410 L 352 418"
        fill="none"
        stroke={RIM}
        strokeWidth={1.2}
      />

      {/* Weathervane */}
      <path
        d="M 424 270 L 450 270 M 445 265 L 450 270 L 445 275 M 424 266 L 428 270 L 424 274"
        stroke={SILHOUETTE}
        strokeWidth={2.2}
        fill="none"
        strokeLinecap="round"
      />

      {/* The belfry the bats pour out of */}
      <path
        d="M 430 344 L 430 332 Q 437 320 444 332 L 444 344 Z"
        fill="#2a0f12"
      />
      <path
        d="M 432 344 L 432 334 Q 437 326 442 334 L 442 344 Z"
        fill="#ff8a1f"
        opacity={0.35}
      >
        <Loop attributeName="opacity" values="0.35;0.15;0.4;0.35" dur="3.7s" />
      </path>

      {WINDOWS.map((w) => (
        <HouseWindow key={w.id} window={w}>
          {w.id === "w-main-1" && <PacingFigure />}
        </HouseWindow>
      ))}

      {/* The arched tower window, and someone standing in it */}
      <path
        d="M 424 458 L 424 432 Q 437 414 450 432 L 450 458 Z"
        fill="url(#hw-window)"
      >
        <Loop attributeName="opacity" values="1;0.8;1;0.7;1" dur="2.6s" />
      </path>
      <circle cx={437} cy={441} r={5} fill="#1a0b10" />
      <path
        d="M 427 458 Q 428 446 437 446 Q 446 446 447 458 Z"
        fill="#1a0b10"
      />

      {/* Attic window and the front door, ajar */}
      <circle cx={336} cy={452} r={11} fill="url(#hw-window)">
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
        opacity={0.7}
      />
      <path
        d="M 326 614 L 326 586 Q 330 580 336 578 L 334 614 Z"
        fill={SILHOUETTE}
      />

      <ChimneySmoke />
      <FrontFence />
    </g>
  );
}

function HouseWindow({
  window: w,
  children
}: {
  window: Window;
  /** Whatever is seen through the glass, behind the glazing bars. */
  children?: ReactNode;
}) {
  const flicker = (
    <Loop
      attributeName="opacity"
      values={w.out ? "1;1;0.12;0.12;1" : "1;0.82;1;0.9;1"}
      dur={`${w.out ? 7 : w.dur}s`}
    />
  );
  return (
    <g>
      <rect
        x={w.x - 2}
        y={w.y - 2}
        width={w.w + 4}
        height={w.h + 4}
        fill="#05020a"
      />
      <rect x={w.x} y={w.y} width={w.w} height={w.h} fill="url(#hw-window)">
        {flicker}
      </rect>
      {children}
      <path
        d={`M ${w.x + w.w / 2} ${w.y} V ${w.y + w.h} M ${w.x} ${w.y + w.h * 0.45} H ${w.x + w.w}`}
        stroke={SILHOUETTE}
        strokeWidth={2}
      />
      {/* Sill and lintel */}
      <path
        d={`M ${w.x - 4} ${w.y + w.h + 2} H ${w.x + w.w + 4} M ${w.x - 3} ${w.y - 3} H ${w.x + w.w + 3}`}
        stroke="#2a2042"
        strokeWidth={2}
      />
      {w.shutter && (
        <rect
          x={w.shutter === "left" ? w.x - 11 : w.x + w.w + 3}
          y={w.y}
          width={8}
          height={w.h}
          fill={SILHOUETTE}
          stroke="#2a2042"
          strokeWidth={0.8}
          transform={
            w.shutter === "left"
              ? `rotate(-9 ${w.x - 3} ${w.y})`
              : `rotate(14 ${w.x + w.w + 3} ${w.y})`
          }
        />
      )}
    </g>
  );
}

/** Someone walking back and forth behind the upstairs window. */
function PacingFigure() {
  const still = useStill();
  return (
    <g clipPath="url(#hw-pacing-window)">
      <g transform={still ? "translate(8 0)" : undefined} fill="#22090c">
        <LoopTransform
          type="translate"
          values="-20 0; -20 0; 34 0; 34 0; -20 0"
          keyTimes="0;0.1;0.5;0.6;1"
          dur="8s"
          calcMode="spline"
          keySplines="0 0 1 1; 0.45 0 0.55 1; 0 0 1 1; 0.45 0 0.55 1"
        />
        <circle cx={281} cy={511} r={5.2} />
        <path d="M 270 534 Q 271 518 281 518 Q 291 518 292 534 Z" />
      </g>
    </g>
  );
}

/** Puffs of smoke rising from the chimney, swelling and thinning out. */
function ChimneySmoke() {
  const still = useStill();
  if (still) {
    return (
      <g>
        {SMOKE_PUFFS.map((i) => {
          const t = (i + 0.5) / SMOKE_PUFFS.length;
          return (
            <circle
              key={`puff-${i}`}
              cx={290 - 70 * t * t}
              cy={440 - 130 * t}
              r={8 + 22 * t}
              fill="url(#hw-smoke-puff)"
              opacity={1 - t * 0.8}
            />
          );
        })}
      </g>
    );
  }
  return (
    <g>
      {SMOKE_PUFFS.map((i) => (
        <g key={`puff-${i}`} transform="translate(290 440)">
          <g>
            <LoopTransform
              type="translate"
              values="0 0; -12 -50; -70 -140"
              keyTimes="0;0.4;1"
              dur="6s"
              begin={`${i * 1.2}s`}
            />
            <circle r={8} fill="url(#hw-smoke-puff)" opacity={0}>
              <Loop
                attributeName="r"
                values="8;18;32"
                keyTimes="0;0.4;1"
                dur="6s"
                begin={`${i * 1.2}s`}
              />
              <Loop
                attributeName="opacity"
                values="0;1;0.7;0"
                keyTimes="0;0.15;0.6;1"
                dur="6s"
                begin={`${i * 1.2}s`}
              />
            </circle>
          </g>
        </g>
      ))}
    </g>
  );
}

const PICKETS = Array.from({ length: 26 }, (_, i) => i);

/** A low picket fence across the front, its gate hanging off one hinge. */
function FrontFence() {
  const pickets = PICKETS.filter((i) => i < 11 || i > 14);
  const x = (i: number) => 226 + i * 9.4;
  return (
    <g>
      <g fill={RIM} transform={RIM_SHIFT}>
        {pickets.map((i) => (
          <path
            key={`rim-${i}`}
            d={`M ${x(i) - 2} 640 L ${x(i) - 2} ${626 - (i % 3)} L ${x(i)} ${622 - (i % 3)} L ${x(i) + 2} ${626 - (i % 3)} L ${x(i) + 2} 640 Z`}
          />
        ))}
      </g>
      <g fill={SILHOUETTE}>
        {pickets.map((i) => (
          <path
            key={`picket-${i}`}
            d={`M ${x(i) - 2} 640 L ${x(i) - 2} ${626 - (i % 3)} L ${x(i)} ${622 - (i % 3)} L ${x(i) + 2} ${626 - (i % 3)} L ${x(i) + 2} 640 Z`}
            transform={i === 5 ? `rotate(-12 ${x(i)} 640)` : undefined}
          />
        ))}
        <path
          d={`M ${x(0) - 3} 629 H ${x(10) + 3} M ${x(0) - 3} 636 H ${x(10) + 3} M ${x(15) - 3} 629 H ${x(25) + 3} M ${x(15) - 3} 636 H ${x(25) + 3}`}
          stroke={SILHOUETTE}
          strokeWidth={1.8}
        />
      </g>
      {/* The gate, swung open and sagging */}
      <g
        fill={SILHOUETTE}
        stroke={SILHOUETTE}
        transform={`rotate(16 ${x(15) - 4} 638)`}
      >
        <path d="M 344 640 L 344 624 L 346 621 L 348 624 L 348 640 Z" />
        <path d="M 352 640 L 352 624 L 354 621 L 356 624 L 356 640 Z" />
        <path d="M 360 640 L 360 624 L 362 621 L 364 624 L 364 640 Z" />
        <path
          d="M 342 629 H 366 M 342 636 H 366 M 344 637 L 364 628"
          strokeWidth={1.6}
        />
      </g>
    </g>
  );
}
