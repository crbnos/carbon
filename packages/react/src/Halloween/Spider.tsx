// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { MutableRefObject } from "react";

// The spider hangs head-down from its thread. Its local origin is the
// spinneret, where the thread attaches; the body extends down the +y axis.

type Point = readonly [number, number];
type Leg = { hip: Point; knee: Point; foot: Point };

const LEFT_LEGS: Leg[] = [
  { hip: [-5.2, 24.8], knee: [-14.5, 17.2], foot: [-17.5, 6] },
  { hip: [-6.4, 26.9], knee: [-18.2, 22.8], foot: [-25.5, 15] },
  { hip: [-6.4, 29.1], knee: [-18.2, 32.4], foot: [-25, 41] },
  { hip: [-5.2, 31.2], knee: [-13.6, 38.8], foot: [-15.6, 50] }
];

const mirror = ([x, y]: Point): Point => [-x, y];

export const SPIDER_LEGS: Leg[] = [
  ...LEFT_LEGS,
  ...LEFT_LEGS.map((leg) => ({
    hip: mirror(leg.hip),
    knee: mirror(leg.knee),
    foot: mirror(leg.foot)
  }))
];

/** The middle of the body: where a grab or a click lands. */
export const SPIDER_BODY_CENTER_Y = 22;

/** The two large front eyes; their pupils follow the pointer. */
export const SPIDER_EYES: Point[] = [
  [-2.8, 30.4],
  [2.8, 30.4]
];

// Short bristles around the abdomen's outline.
const BRISTLES = Array.from({ length: 16 }, (_, i) => {
  const angle = (i / 16) * Math.PI * 2;
  const x = Math.cos(angle) * 9.6;
  const y = 11 + Math.sin(angle) * 11.6;
  return {
    id: `bristle-${i}`,
    d: `M ${x} ${y} l ${Math.cos(angle) * 1.8} ${Math.sin(angle) * 1.8}`
  };
});

export function SpiderBody({
  idPrefix,
  legRefs,
  pupilRefs,
  animateLegs = false,
  rimOpacity = 0.16
}: {
  idPrefix: string;
  /** Hands each leg's group to a caller that poses it frame by frame. */
  legRefs?: MutableRefObject<(SVGGElement | null)[]>;
  pupilRefs?: MutableRefObject<(SVGCircleElement | null)[]>;
  /** Let the legs twitch on their own, for a spider nobody is driving. */
  animateLegs?: boolean;
  rimOpacity?: number;
}) {
  const abdomen = `${idPrefix}-abdomen`;
  const thorax = `${idPrefix}-thorax`;
  const eye = `${idPrefix}-eye`;

  return (
    <g>
      <defs>
        <radialGradient id={abdomen} cx="0.36" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#57456a" />
          <stop offset="0.42" stopColor="#261d31" />
          <stop offset="1" stopColor="#0b080f" />
        </radialGradient>
        <radialGradient id={thorax} cx="0.4" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#4a3b5a" />
          <stop offset="0.5" stopColor="#1e1727" />
          <stop offset="1" stopColor="#0b080f" />
        </radialGradient>
        <radialGradient id={eye} cx="0.4" cy="0.35" r="0.7">
          <stop offset="0" stopColor="#fffdf4" />
          <stop offset="1" stopColor="#e9dcc4" />
        </radialGradient>
      </defs>

      {SPIDER_LEGS.map((leg, i) => (
        <g
          key={`leg-${leg.hip[0]}-${leg.hip[1]}`}
          ref={(el) => {
            if (legRefs) legRefs.current[i] = el;
          }}
        >
          {/* A faint light halo, so the legs read on a dark page */}
          <path
            d={`M ${leg.hip[0]} ${leg.hip[1]} L ${leg.knee[0]} ${leg.knee[1]} L ${leg.foot[0]} ${leg.foot[1]}`}
            fill="none"
            stroke="#ffffff"
            strokeOpacity={0.2}
            strokeWidth={3.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d={`M ${leg.hip[0]} ${leg.hip[1]} L ${leg.knee[0]} ${leg.knee[1]}`}
            stroke="#16111b"
            strokeWidth={2.5}
            strokeLinecap="round"
          />
          <path
            d={`M ${leg.knee[0]} ${leg.knee[1]} L ${leg.foot[0]} ${leg.foot[1]}`}
            stroke="#16111b"
            strokeWidth={1.7}
            strokeLinecap="round"
          />
          <path
            d={`M ${leg.hip[0]} ${leg.hip[1] - 0.5} L ${leg.knee[0]} ${leg.knee[1] - 0.5}`}
            stroke="#ffffff"
            strokeOpacity={0.14}
            strokeWidth={0.6}
            strokeLinecap="round"
          />
          <circle cx={leg.knee[0]} cy={leg.knee[1]} r={1.3} fill="#2d2335" />
          {animateLegs && (
            <animateTransform
              attributeName="transform"
              type="rotate"
              values={`0 ${leg.hip[0]} ${leg.hip[1]}; ${i % 2 === 0 ? 7 : -7} ${leg.hip[0]} ${leg.hip[1]}; 0 ${leg.hip[0]} ${leg.hip[1]}`}
              dur={`${0.9 + (i % 4) * 0.23}s`}
              begin={`${(i % 3) * 0.17}s`}
              repeatCount="indefinite"
            />
          )}
        </g>
      ))}

      {/* Abdomen, hung from the thread */}
      <g stroke="#2a2134" strokeWidth={0.6} strokeLinecap="round">
        {BRISTLES.map((bristle) => (
          <path key={bristle.id} d={bristle.d} />
        ))}
      </g>
      <ellipse
        cx={0}
        cy={11}
        rx={9.6}
        ry={11.6}
        fill={`url(#${abdomen})`}
        stroke="#ffffff"
        strokeOpacity={rimOpacity}
        strokeWidth={0.6}
      />
      <path
        d="M -5.5 5.5 Q 0 8.5 5.5 5.5 M -6.6 9.5 Q 0 12.8 6.6 9.5 M -6.2 13.8 Q 0 17 6.2 13.8"
        fill="none"
        stroke="#3c2f4a"
        strokeWidth={0.7}
        strokeLinecap="round"
      />
      {/* The marking: a pumpkin-orange hourglass */}
      <path
        d="M -2.7 8.2 L 2.7 8.2 L 0.75 12 L 2.7 15.8 L -2.7 15.8 L -0.75 12 Z"
        fill="#ff7518"
        stroke="#ffb066"
        strokeOpacity={0.6}
        strokeWidth={0.35}
        strokeLinejoin="round"
      />
      <ellipse
        cx={-3.6}
        cy={5.4}
        rx={3.1}
        ry={1.9}
        fill="#ffffff"
        fillOpacity={0.3}
        transform="rotate(-32 -3.6 5.4)"
      />
      <circle cx={0} cy={0.6} r={1} fill="#1a141f" />

      {/* Waist, then the head */}
      <ellipse cx={0} cy={22.8} rx={2.4} ry={1.7} fill="#120e16" />
      <ellipse
        cx={0}
        cy={28.2}
        rx={7.3}
        ry={6.7}
        fill={`url(#${thorax})`}
        stroke="#ffffff"
        strokeOpacity={rimOpacity}
        strokeWidth={0.55}
      />
      <ellipse
        cx={-2.6}
        cy={25.2}
        rx={2}
        ry={1.1}
        fill="#ffffff"
        fillOpacity={0.2}
        transform="rotate(-24 -2.6 25.2)"
      />

      {/* Eyes: two big ones that watch you, six small ones that don't */}
      {[-5.3, 5.3].map((x) => (
        <g key={`small-eye-${x}`}>
          <circle cx={x} cy={27.1} r={1.05} fill="#271f2e" />
          <circle cx={x - 0.3} cy={26.8} r={0.36} fill="#ffffff" />
        </g>
      ))}
      {[-1.5, 1.5].map((x) => (
        <g key={`top-eye-${x}`}>
          <circle cx={x} cy={25.9} r={0.8} fill="#271f2e" />
          <circle cx={x - 0.2} cy={25.7} r={0.26} fill="#ffffff" />
        </g>
      ))}
      {SPIDER_EYES.map(([x, y], i) => (
        <g key={`eye-${x}`}>
          <circle
            cx={x}
            cy={y}
            r={2.6}
            fill={`url(#${eye})`}
            stroke="#0b080f"
            strokeWidth={0.4}
          />
          <circle
            ref={(el) => {
              if (pupilRefs) pupilRefs.current[i] = el;
            }}
            cx={x}
            cy={y + 0.3}
            r={1.45}
            fill="#130e18"
          />
          <circle cx={x - 0.75} cy={y - 0.85} r={0.62} fill="#ffffff" />
        </g>
      ))}

      {/* Fangs */}
      <path
        d="M -2.1 33.9 Q -2.9 36.4 -1.1 37.6 M 2.1 33.9 Q 2.9 36.4 1.1 37.6"
        fill="none"
        stroke="#1a141f"
        strokeWidth={1.3}
        strokeLinecap="round"
      />
      <path
        d="M -1.5 37 L -1.1 37.6 M 1.5 37 L 1.1 37.6"
        stroke="#ff9a3c"
        strokeWidth={0.7}
        strokeLinecap="round"
      />
    </g>
  );
}
