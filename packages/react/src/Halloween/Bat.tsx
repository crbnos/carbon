// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useId } from "react";
import { LoopTransform } from "./scene-loops";

// A bat, wings spread, centred on its body: wingspan about 120 units, drawn
// for an SVG of viewBox "-62 -26 124 42". Used by the night scene and by the
// bats that cross the app.
//
// Drawn the way the garden spider is (RealSpider.tsx): natural colour, form
// from soft gradients, fine strokes only for hair and bone, never an outline.
// The wing is thin skin stretched between long finger bones, so its trailing
// edge scallops between the fingertips and it glows plum-brown where light
// comes through. A wingbeat swings the wing up from the shoulder while it
// folds, rather than squashing it flat.

// The left wing; the right is its mirror. Shoulder at (-4, -4), wrist at
// (-26, -14.6), fingertips at the scallop points.
const MEMBRANE =
  "M -4 -5 Q -14 -13 -26 -14.6 Q -44 -19 -60 -10.6 Q -53.4 -6 -53.8 4 Q -46.6 1.4 -40.6 9 Q -32.6 4.6 -24.4 10 Q -13.6 3.6 -4 6.4 Z";
const ARM = "M -4 -4.6 Q -15 -12 -26 -14.6";
const FINGERS =
  "M -26 -14.6 L -60 -10.6 M -26 -14.6 L -53.8 4 M -26 -14.6 L -40.6 9 M -26 -14.6 L -24.4 10";
const THUMB = "M -26.4 -14.8 q -1.4 -2 -1.2 -3.4";

// Short hairs round the body and head, leaning outward like fur.
const FUR = Array.from({ length: 72 }, (_, i) => {
  const angle = (i / 72) * Math.PI * 2;
  const onHead = i % 3 === 0;
  const [cx, cy, rx, ry] = onHead ? [0, -8, 5.8, 5.6] : [0, 3, 6.4, 9.4];
  const x = cx + Math.cos(angle) * rx;
  const y = cy + Math.sin(angle) * ry;
  const lean = 0.35;
  return {
    id: `fur-${i}`,
    d: `M ${x} ${y} l ${Math.cos(angle + lean) * 0.9} ${Math.sin(angle + lean) * 0.9}`,
    light: i % 2 === 0
  };
});

// The body lifts on each downstroke, in time with the wings.
function Bob({ flap }: { flap: number }) {
  return (
    <LoopTransform
      type="translate"
      values="0 1.2; 0 -1.8; 0 1.2"
      dur={`${flap}s`}
      calcMode="spline"
      keySplines="0.45 0 0.55 1; 0.45 0 0.55 1"
    />
  );
}

function Wing({
  silhouette,
  flap,
  skin
}: {
  silhouette: boolean;
  flap: number;
  skin: string;
}) {
  const spline = "0.45 0 0.55 1; 0.45 0 0.55 1";
  return (
    <g>
      <LoopTransform
        type="rotate"
        values="-6 -4 -4; 28 -4 -4; -6 -4 -4"
        dur={`${flap}s`}
        calcMode="spline"
        keySplines={spline}
      />
      <g>
        <LoopTransform
          type="scale"
          values="1 1; 0.86 0.5; 1 1"
          dur={`${flap}s`}
          calcMode="spline"
          keySplines={spline}
        />
        <path d={MEMBRANE} fill={silhouette ? undefined : `url(#${skin})`} />
        {!silhouette && (
          <g fill="none" strokeLinecap="round">
            <path
              d={FINGERS}
              stroke="#0e080a"
              strokeOpacity={0.75}
              strokeWidth={1}
            />
            <path d={ARM} stroke="#140c0e" strokeWidth={2.2} />
            <path d={THUMB} stroke="#2e2022" strokeWidth={0.9} />
          </g>
        )}
      </g>
    </g>
  );
}

export function Bat({
  silhouette,
  flap
}: {
  silhouette: boolean;
  flap: number;
}) {
  const id = useId().replace(/:/g, "");
  const skin = `${id}-skin`;
  const fur = `${id}-fur`;
  const ear = `${id}-ear`;
  const eye = `${id}-eye`;

  if (silhouette) {
    // Far off against the sky: one dark shape, no outline.
    return (
      <g fill="#08050c">
        <Bob flap={flap} />
        <Wing silhouette flap={flap} skin={skin} />
        <g transform="scale(-1 1)">
          <Wing silhouette flap={flap} skin={skin} />
        </g>
        <ellipse cx={0} cy={3} rx={6.8} ry={10} />
        <circle cx={0} cy={-8} r={6.2} />
        <path d="M -5.4 -10.4 Q -7.6 -16 -7.8 -22 Q -4.4 -17 -1.6 -13.4 Z M 5.4 -10.4 Q 7.6 -16 7.8 -22 Q 4.4 -17 1.6 -13.4 Z" />
      </g>
    );
  }

  return (
    <g>
      <Bob flap={flap} />
      <defs>
        {/* Thin skin: darkest over the body, light coming through at the edges. */}
        <radialGradient
          id={skin}
          cx="0"
          cy="-2"
          r="62"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#140c0f" />
          <stop offset="0.55" stopColor="#24161b" />
          <stop offset="0.85" stopColor="#3d2830" />
          <stop offset="1" stopColor="#52363d" />
        </radialGradient>
        <radialGradient id={fur} cx="0.38" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#7a5c50" />
          <stop offset="0.45" stopColor="#3d2b27" />
          <stop offset="1" stopColor="#140d0d" />
        </radialGradient>
        <linearGradient id={ear} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#2a1d1c" />
          <stop offset="1" stopColor="#4e3632" />
        </linearGradient>
        <radialGradient id={eye} cx="0.45" cy="0.45" r="0.6">
          <stop offset="0" stopColor="#ff7a2e" />
          <stop offset="0.55" stopColor="#a8260c" />
          <stop offset="1" stopColor="#240805" />
        </radialGradient>
      </defs>
      <Wing silhouette={false} flap={flap} skin={skin} />
      <g transform="scale(-1 1)">
        <Wing silhouette={false} flap={flap} skin={skin} />
      </g>
      {/* Feet tucked under the body */}
      <path
        d="M -2.4 12 q -0.6 1.6 -1.2 3 M 2.4 12 q 0.6 1.6 1.2 3"
        fill="none"
        stroke="#1a1012"
        strokeWidth={0.9}
        strokeLinecap="round"
      />
      <ellipse cx={0} cy={3} rx={6.8} ry={10} fill={`url(#${fur})`} />
      {/* Ears: soft-tipped, pink inside where the skin is thin */}
      <path
        d="M -5.4 -10.4 Q -7.6 -16 -7.8 -22 Q -4.4 -17 -1.6 -13.4 Z M 5.4 -10.4 Q 7.6 -16 7.8 -22 Q 4.4 -17 1.6 -13.4 Z"
        fill={`url(#${ear})`}
      />
      <path
        d="M -5 -12.2 Q -6.6 -16 -6.8 -19.4 Q -4.6 -16.2 -3 -13.8 Z M 5 -12.2 Q 6.6 -16 6.8 -19.4 Q 4.6 -16.2 3 -13.8 Z"
        fill="#7a4248"
        opacity={0.55}
      />
      <circle cx={0} cy={-8} r={6.2} fill={`url(#${fur})`} />
      <g fill="none" strokeLinecap="round" strokeWidth={0.4}>
        {FUR.map((hair) => (
          <path
            key={hair.id}
            d={hair.d}
            stroke={hair.light ? "#6a4e44" : "#2a1d1b"}
            strokeOpacity={0.7}
          />
        ))}
      </g>
      {/* Muzzle, eyes with an ember glint, fangs */}
      <ellipse cx={0} cy={-4.6} rx={2.6} ry={1.9} fill="#2e1f1f" />
      <circle cx={-0.9} cy={-5.2} r={0.35} fill="#0a0506" />
      <circle cx={0.9} cy={-5.2} r={0.35} fill="#0a0506" />
      <circle cx={-2.5} cy={-9} r={1.35} fill={`url(#${eye})`} />
      <circle cx={2.5} cy={-9} r={1.35} fill={`url(#${eye})`} />
      <circle cx={-2.1} cy={-9.5} r={0.35} fill="#ffffff" opacity={0.75} />
      <circle cx={2.9} cy={-9.5} r={0.35} fill="#ffffff" opacity={0.75} />
      <path
        d="M -1.8 -3.2 q 0.3 1 0.55 1.9 q 0.25 -0.9 0.55 -1.9 Z M 0.7 -3.2 q 0.3 1 0.55 1.9 q 0.25 -0.9 0.55 -1.9 Z"
        fill="#efe8dc"
      />
    </g>
  );
}
