// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A European garden spider (Araneus diadematus) seen from above: the bulbous
// abdomen with its dark leaf-shaped folium and the white cross it is named
// for, the cephalothorax with its radiating grooves and eight small eyes, the
// chelicerae and the palps. The legs are drawn separately, by the rig, so they
// can move.
//
// In the spider's own frame the head is along +y; units are pre-scale.

const ABDOMEN_HAIRS = Array.from({ length: 26 }, (_, i) => {
  const angle = (i / 26) * Math.PI * 2;
  const x = Math.cos(angle) * 7.7;
  const y = -12.6 + Math.sin(angle) * 9.5;
  const lean = 0.25;
  return {
    id: `hair-${i}`,
    d: `M ${x} ${y} l ${Math.cos(angle + lean) * 1.3} ${Math.sin(angle + lean) * 1.3}`
  };
});

// The white cross: a line of spots down the middle, and one either side.
const CROSS = [
  { id: "c1", x: 0, y: -7.4, r: 0.85 },
  { id: "c2", x: 0, y: -9.9, r: 0.8 },
  { id: "c3", x: 0, y: -12.4, r: 0.72 },
  { id: "c4", x: 0, y: -14.7, r: 0.58 },
  { id: "c5", x: -2.4, y: -10.2, r: 0.68 },
  { id: "c6", x: 2.4, y: -10.2, r: 0.68 }
];

const SIDE_SPOTS = [
  { id: "s1", x: -5.7, y: -9.4 },
  { id: "s2", x: 5.7, y: -9.4 },
  { id: "s3", x: -6.3, y: -13.2 },
  { id: "s4", x: 6.3, y: -13.2 },
  { id: "s5", x: -5, y: -16.8 },
  { id: "s6", x: 5, y: -16.8 }
];

// Eight eyes in two rows at the front of the head.
const EYES = [
  { id: "ame-l", x: -0.65, y: 4.95, r: 0.52 },
  { id: "ame-r", x: 0.65, y: 4.95, r: 0.52 },
  { id: "ale-l", x: -2.05, y: 4.5, r: 0.4 },
  { id: "ale-r", x: 2.05, y: 4.5, r: 0.4 },
  { id: "pme-l", x: -0.8, y: 3.85, r: 0.44 },
  { id: "pme-r", x: 0.8, y: 3.85, r: 0.44 },
  { id: "ple-l", x: -2.4, y: 3.55, r: 0.36 },
  { id: "ple-r", x: 2.4, y: 3.55, r: 0.36 }
];

const GROOVES = [-150, -110, -70, -30, 30, 70, 110, 150].map((deg) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return {
    id: `groove-${deg}`,
    d: `M ${Math.cos(a) * 1.2} ${-0.6 + Math.sin(a) * 1.2} L ${Math.cos(a) * 3.9} ${0.4 + Math.sin(a) * 4.4}`
  };
});

export function RealSpiderBody({ idPrefix }: { idPrefix: string }) {
  const abdomen = `${idPrefix}-abdomen`;
  const thorax = `${idPrefix}-thorax`;

  return (
    <g>
      <defs>
        <radialGradient id={abdomen} cx="0.42" cy="0.36" r="0.75">
          <stop offset="0" stopColor="#b07a45" />
          <stop offset="0.45" stopColor="#6e4826" />
          <stop offset="1" stopColor="#2e1b0d" />
        </radialGradient>
        <radialGradient id={thorax} cx="0.45" cy="0.4" r="0.75">
          <stop offset="0" stopColor="#a47650" />
          <stop offset="1" stopColor="#3e2817" />
        </radialGradient>
      </defs>

      {/* Palps, the short feelers either side of the fangs */}
      <g fill="none" strokeLinecap="round">
        <path
          d="M -2.2 5 L -3.5 7.4 L -3 9.7 M 2.2 5 L 3.5 7.4 L 3 9.7"
          stroke="#33241a"
          strokeWidth={1.05}
          strokeLinejoin="round"
        />
        <path
          d="M -3.5 7.4 l 0.01 0 M 3.5 7.4 l 0.01 0"
          stroke="#b08a62"
          strokeWidth={0.9}
        />
      </g>

      {/* Abdomen */}
      <g
        stroke="#8a6a4c"
        strokeOpacity={0.6}
        strokeWidth={0.32}
        strokeLinecap="round"
      >
        {ABDOMEN_HAIRS.map((hair) => (
          <path key={hair.id} d={hair.d} />
        ))}
      </g>
      {/* A faint rim in the theme's text colour, so the spider reads against a
          dark bar as well as a light one */}
      <ellipse
        cx={0}
        cy={-12.6}
        rx={7.8}
        ry={9.6}
        fill={`url(#${abdomen})`}
        stroke="currentColor"
        strokeOpacity={0.22}
        strokeWidth={0.55}
      />
      <path
        d="M 0 -4.2 C 3.2 -5.2, 4.6 -7.6, 4.1 -9.8 C 5.2 -11.6, 5.3 -13.9, 4.2 -15.3 C 4.6 -17.4, 3.4 -19.8, 1.6 -21 C 1 -21.6, -1 -21.6, -1.6 -21 C -3.4 -19.8, -4.6 -17.4, -4.2 -15.3 C -5.3 -13.9, -5.2 -11.6, -4.1 -9.8 C -4.6 -7.6, -3.2 -5.2, 0 -4.2 Z"
        fill="#120b06"
        fillOpacity={0.5}
        stroke="#9a7452"
        strokeOpacity={0.55}
        strokeWidth={0.45}
      />
      <g fill="#ecdcbc" fillOpacity={0.88}>
        {CROSS.map((spot) => (
          <circle key={spot.id} cx={spot.x} cy={spot.y} r={spot.r} />
        ))}
      </g>
      <g fill="#d9c29b" fillOpacity={0.45}>
        {SIDE_SPOTS.map((spot) => (
          <ellipse key={spot.id} cx={spot.x} cy={spot.y} rx={0.55} ry={0.85} />
        ))}
      </g>
      <ellipse
        cx={-2.9}
        cy={-16}
        rx={2.4}
        ry={1.25}
        fill="#ffffff"
        fillOpacity={0.15}
        transform="rotate(-30 -2.9 -16)"
      />
      <circle cx={-3.4} cy={-16.7} r={0.42} fill="#ffffff" fillOpacity={0.5} />
      <circle cx={0} cy={-21.9} r={0.9} fill="#1a110a" />

      {/* Waist */}
      <ellipse cx={0} cy={-4.3} rx={1.4} ry={1.1} fill="#241710" />

      {/* Cephalothorax, its grooves, and the eyes and fangs at the front */}
      <ellipse
        cx={0}
        cy={0.6}
        rx={4.7}
        ry={5.3}
        fill={`url(#${thorax})`}
        stroke="currentColor"
        strokeOpacity={0.22}
        strokeWidth={0.5}
      />
      <g
        stroke="#1a110a"
        strokeOpacity={0.5}
        strokeWidth={0.3}
        strokeLinecap="round"
      >
        {GROOVES.map((groove) => (
          <path key={groove.id} d={groove.d} />
        ))}
      </g>
      <ellipse cx={0} cy={-0.7} rx={0.35} ry={0.85} fill="#140d08" />
      <path
        d="M -2.7 2.3 Q 0 3.5 2.7 2.3"
        fill="none"
        stroke="#a3815e"
        strokeOpacity={0.4}
        strokeWidth={0.35}
      />
      {EYES.map((eye) => (
        <g key={eye.id}>
          <circle cx={eye.x} cy={eye.y} r={eye.r} fill="#050302" />
          <circle
            cx={eye.x - eye.r * 0.3}
            cy={eye.y - eye.r * 0.3}
            r={eye.r * 0.32}
            fill="#ffffff"
            fillOpacity={0.6}
          />
        </g>
      ))}
      <ellipse
        cx={-1.15}
        cy={6.25}
        rx={1.05}
        ry={1.4}
        fill="#2a1b11"
        stroke="#4a3423"
        strokeWidth={0.3}
      />
      <ellipse
        cx={1.15}
        cy={6.25}
        rx={1.05}
        ry={1.4}
        fill="#2a1b11"
        stroke="#4a3423"
        strokeWidth={0.3}
      />
    </g>
  );
}

/** Leg colours, shared with the leg paths the rig draws. */
export const LEG_COLOUR = "#5a3c24";
export const LEG_BAND = "#d8b27e";
