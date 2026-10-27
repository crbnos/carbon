// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The decorations that are only styling, rendered as one stylesheet while
// Halloween is on and gone the moment it is off. Each hangs off something the
// app already renders, or off a plain data attribute that means nothing
// without this file:
//
// - a witch on a broom riding the page-loading bar (`#nprogress .bar`), with
//   a trail of sparks behind her;
// - fog billowing up from the bottom of the window (`.halloween-fog`, which
//   `HalloweenLayer` renders), behind the page card and in front of the app's
//   background: it shows through the navigation rail (made see-through, the
//   `nav[data-sliding-hover]` that `NavRail` renders on desktop) and in the
//   gutters, and curls round the card's corners instead of stopping at an
//   edge;
// - a witch's hat on the user's avatar (`[data-user-menu]`);
// - a jack-o'-lantern on October 31 in every date picker (`td[data-date]`);
// - the MES page card positioned and stacked (`[data-app-card]`), so the
//   spider's layer sits on it and the fog behind it, as on the ERP's (whose
//   card is already \`relative z-10\`).
//
// Nothing here takes a click. The pictures are SVG data URIs; their small
// SMIL loops (the cape, the hair, the hat's twinkle) are dropped for a
// reduced-motion user along with the CSS animations.

function svg(markup: string) {
  return `url("data:image/svg+xml,${encodeURIComponent(
    markup.replace(/\s+/g, " ").trim()
  )}")`;
}

function loop(still: boolean, markup: string) {
  return still ? "" : markup;
}

// Flying right, the way the loading bar grows: a witch in profile leaning
// into the wind, both hands on a twig broom, her cat riding the tail. Lit
// from below by the bar, so her edges catch an orange rim that reads in light
// and dark mode alike.
function witch(still: boolean) {
  const cape = {
    a: "M53 19 C44 15.6 33 16 22 18.6 C25 20 25 21.4 22.4 23.4 C26 24 27.6 25.4 25.6 28.6 C29.6 28.4 31.6 30.2 30.8 33 C34.6 31.4 36.6 31.4 39 31.6 Q45 27.6 50.4 29 Z",
    b: "M53 19 C44 13.6 32.4 12.8 20.6 14.6 C23.8 16.2 24 17.8 21.2 19.8 C25 20.6 26.8 22 24.4 25 C28.4 25 30.6 26.8 29.6 29.8 C33.6 28.4 35.8 28.6 38 29.6 Q44.6 26.6 50.4 29 Z"
  };
  const hair = {
    a: "M62 11 Q54 9.4 46.4 13.6 Q51 12.6 53.4 13.4 Q48 15.6 45.4 19.8 Q51.6 16 55 16.2 Q51.6 18.6 50.6 21.8 Q56 17.6 60.6 16.4 Z",
    b: "M62 11 Q53.6 8 45.6 10.6 Q50.6 10.4 53 11.6 Q47.4 12.6 44.4 16.2 Q51 13.8 54.6 14.4 Q50.8 16.2 49.4 19.2 Q55.6 16.4 60.6 16.4 Z"
  };
  const tip = {
    a: "M57.2 9.9 C58.2 5.6 58.8 2.4 59.2 -0.2 C59.4 -2.6 57.6 -4.2 54.8 -4.2 C58.6 -3.4 61.2 -1.6 61.8 1.4 C62.8 4.4 64.6 6.6 66.4 8.6 Z",
    b: "M57.2 9.9 C58.2 5.6 58.8 2.4 59.2 -0.2 C59.2 -2 57.4 -3.2 54.2 -2.8 C58.2 -2.6 61 -1.2 61.8 1.4 C62.8 4.4 64.6 6.6 66.4 8.6 Z"
  };
  const tail = {
    a: "M24.4 36.4 Q19.6 33.4 21 28.6 Q22.2 25.6 24.8 26.8",
    b: "M24.4 36.4 Q19 35.2 19 30.2 Q19.4 26.8 22.2 27"
  };
  const flutter = (values: { a: string; b: string }, dur: string) =>
    loop(
      still,
      `<animate attributeName="d" dur="${dur}" repeatCount="indefinite" values="${values.a};${values.b};${values.a}"/>`
    );
  return svg(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -8 96 62">
  <defs>
    <linearGradient id="straw" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#7a4f17"/>
      <stop offset="0.55" stop-color="#d9a441"/>
      <stop offset="1" stop-color="#a8752c"/>
    </linearGradient>
    <linearGradient id="cape" x1="1" y1="0" x2="0.2" y2="1">
      <stop offset="0" stop-color="#3f2166"/>
      <stop offset="0.7" stop-color="#1a0d2e"/>
      <stop offset="1" stop-color="#4a2238"/>
    </linearGradient>
    <linearGradient id="dress" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#4b2a7a"/>
      <stop offset="0.65" stop-color="#22113a"/>
      <stop offset="1" stop-color="#5a2a3c"/>
    </linearGradient>
    <radialGradient id="cat" cx="0.4" cy="0.3" r="0.8">
      <stop offset="0" stop-color="#3a2d48"/>
      <stop offset="1" stop-color="#0d0812"/>
    </radialGradient>
    <linearGradient id="skin" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#a6d880"/>
      <stop offset="1" stop-color="#679d45"/>
    </linearGradient>
    <linearGradient id="hair" x1="1" y1="0" x2="0" y2="0">
      <stop offset="0" stop-color="#ff8a2a"/>
      <stop offset="1" stop-color="#b8340b"/>
    </linearGradient>
    <linearGradient id="hat" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3a2160"/>
      <stop offset="1" stop-color="#120820"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#ff9a3c" stop-opacity="0.5"/>
      <stop offset="0.55" stop-color="#9b5cff" stop-opacity="0.24"/>
      <stop offset="1" stop-color="#9b5cff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <ellipse cx="52" cy="26" rx="44" ry="26" fill="url(#glow)">
    ${loop(still, `<animate attributeName="opacity" values="0.75;1;0.75" dur="1.6s" repeatCount="indefinite"/>`)}
  </ellipse>
  <g stroke="#ffffff" stroke-opacity="0.28" stroke-width="0.6" stroke-linecap="round" fill="none" stroke-dasharray="7 9">
    <path d="M0 18 L40 15.6"/>
    <path d="M4 26 L44 23.6"/>
    <path d="M0 50 L30 47"/>
    ${loop(still, `<animate attributeName="stroke-dashoffset" values="0;-32" dur="0.5s" repeatCount="indefinite"/>`)}
  </g>
  <g stroke-linecap="round" stroke-linejoin="round">
    <g>
      <path d="M20 37.6 Q10 33 1 30.4 Q3.2 36 0.6 41 Q3.2 46 1.4 51 Q11 46.6 20 43.6 Z" fill="url(#straw)"/>
      <path d="M19.6 38.4 L2.4 32 M19.6 39.6 L1.4 36.6 M19.6 40.6 L1.2 41 M19.6 41.6 L1.6 45.6 M19.6 42.6 L2.4 49.6" stroke="#6a4413" stroke-width="0.5" fill="none"/>
      <path d="M19.6 39 L4 34.4 M19.6 41 L3 43.4 M19.6 42.2 L5 47.6" stroke="#f3cf73" stroke-width="0.35" fill="none"/>
      ${loop(still, `<animateTransform attributeName="transform" type="rotate" values="0 20 40;-3 20 40;0 20 40;2.5 20 40;0 20 40" dur="0.9s" repeatCount="indefinite"/>`)}
    </g>
    <path d="M10 40.6 Q50 35.6 92 29.6" fill="none" stroke="#3f2410" stroke-width="2.8"/>
    <path d="M10 39.8 Q50 34.8 92 28.8" fill="none" stroke="#9c6a38" stroke-width="0.8" stroke-opacity="0.85"/>
    <ellipse cx="80" cy="31.2" rx="1.1" ry="0.7" fill="#2c180a"/>
    <path d="M18.6 37.2 L21.4 37 L21.6 44 L18.8 44.2 Z" fill="#6b2fa0" stroke="#2a0f45" stroke-width="0.4"/>
    <path d="M18.8 39.6 L21.5 39.4 M18.9 41.8 L21.6 41.6" stroke="#c9a2f0" stroke-width="0.35"/>
    <path d="${cape.a}" fill="url(#cape)">${flutter(cape, "0.7s")}</path>
    <path d="M50.4 29 Q45 27.6 39 31.6 L41.4 30.4 Q46 28.8 50.4 30.4 Z" fill="#7a1530"/>
    <!-- The cat rides the tail of the broom, in front of the cape. -->
    <path d="${tail.a}" fill="none">${flutter(tail, "1.4s")}</path>
    <path d="${tail.a}" fill="none" stroke="#1c1426" stroke-width="1.6">${flutter(tail, "1.4s")}</path>
    <ellipse cx="28.4" cy="35" rx="4.4" ry="3.8" fill="url(#cat)"/>
    <circle cx="31.8" cy="30.8" r="2.6" fill="url(#cat)"/>
    <path d="M29.9 29.3 L30 26.3 L31.6 28.3 Z M32.6 28.3 L34.2 26.3 L34.2 29.3 Z" fill="#0d0812"/>
    <ellipse cx="32.6" cy="30.4" rx="0.55" ry="0.7" fill="#b6f05a"/>
    <ellipse cx="34.1" cy="30.6" rx="0.5" ry="0.65" fill="#b6f05a"/>
    <path d="M49 38.4 Q42 41 36 44.6 C39 44.8 39.6 46 38.2 47.8 C41 47.4 42.6 48 42.8 49.6 C45.6 48.4 47.6 47 49.6 45.6 Q54 42.4 58 39.6 Z" fill="#1d0f31"/>
    <path d="M58 22.6 Q66 27 70.6 31.4" fill="none" stroke="#170b28" stroke-width="2.8"/>
    <circle cx="71" cy="31.8" r="1.5" fill="#6fa64c"/>
    <path d="M48.6 38.6 Q47 28 52 20.6 Q56 17.6 60.6 19.6 Q64.4 25 63.8 31.4 Q62.6 36 58.4 38.6 Z" fill="url(#dress)"/>
    <path d="M50.2 32.6 Q56 31.4 62.8 33" fill="none" stroke="#ff7a1a" stroke-width="1"/>
    <path d="M57 36.6 L65.6 34.6 L67.6 40.6" fill="none" stroke="#1d0f31" stroke-width="3.2"/>
    <path d="M65.2 36.4 l2.8 -0.9 M65.8 38.4 l2.8 -0.9" stroke="#ff7a1a" stroke-width="0.9"/>
    <path d="M66 40 Q70.6 39 74 40.6 Q76.6 41.6 78.2 39.4 Q78.8 42.8 74.6 43.4 L66.6 43.2 Z" fill="#0d0812"/>
    <path d="M56.4 23.6 Q64.6 29 73.6 30.8" fill="none" stroke="#2a1647" stroke-width="3"/>
    <circle cx="74.2" cy="30.6" r="1.6" fill="url(#skin)"/>
    <path d="M73.2 29.4 Q74.8 28.6 75.8 30 M73.4 31.8 Q75 32.4 76 31" fill="none" stroke="#4f8030" stroke-width="0.45"/>
    <path d="${hair.a}" fill="url(#hair)">${flutter(hair, "0.8s")}</path>
    <path d="M60 9.6 Q66 8.4 67.4 12 L71.8 14.4 Q68.6 14.6 67.6 15.2 Q67.6 17.6 65.8 18.4 L66.6 19.6 Q63.6 20 61 18.2 Q58.2 15 60 9.6 Z" fill="url(#skin)"/>
    <ellipse cx="62.8" cy="15.2" rx="2" ry="1.3" fill="#4f8030" opacity="0.45"/>
    <path d="M67.6 12.4 Q69.6 13.4 71.2 14.2" fill="none" stroke="#4f8030" stroke-width="0.4" opacity="0.7"/>
    <ellipse cx="65" cy="12.2" rx="1" ry="0.9" fill="#fff8e6"/>
    <circle cx="65.4" cy="12.3" r="0.5" fill="#1a0b26"/>
    <path d="M63.8 10.8 L66.4 10.4" stroke="#1a0b26" stroke-width="0.45"/>
    <circle cx="69.4" cy="14" r="0.42" fill="#4f8030"/>
    <path d="M64.8 16.4 Q66.2 17.4 67.4 16.4" fill="none" stroke="#1a0b26" stroke-width="0.45"/>
    <ellipse cx="62" cy="9.4" rx="9.8" ry="1.9" transform="rotate(-9 62 9.4)" fill="#160a26"/>
    <path d="${tip.a}" fill="url(#hat)">${flutter(tip, "0.6s")}</path>
    <path d="M57.6 8.2 Q62 7.2 65.6 6.8 L66.4 8.6 Q62 9.2 57.2 9.9 Z" fill="#f47c1c"/>
    <rect x="60.4" y="7.4" width="2" height="1.9" rx="0.3" transform="rotate(-9 61.4 8.4)" fill="none" stroke="#ffd166" stroke-width="0.5"/>
  </g>
  <g fill="#fff4d6">
    <path d="M50 -1.6 l0.5 1.4 l1.4 0.5 l-1.4 0.5 l-0.5 1.4 l-0.5 -1.4 l-1.4 -0.5 l1.4 -0.5 Z" opacity="${still ? 0.9 : 0}">
      ${loop(still, `<animate attributeName="opacity" values="0;1;0;0" keyTimes="0;0.2;0.4;1" dur="1.8s" repeatCount="indefinite"/>`)}
    </path>
    <path d="M44.6 4.6 l0.35 1 l1 0.35 l-1 0.35 l-0.35 1 l-0.35 -1 l-1 -0.35 l1 -0.35 Z" opacity="${still ? 0.7 : 0}">
      ${loop(still, `<animate attributeName="opacity" values="0;0;1;0" keyTimes="0;0.45;0.65;1" dur="1.8s" repeatCount="indefinite"/>`)}
    </path>
    <path d="M40 -4 l0.3 0.9 l0.9 0.3 l-0.9 0.3 l-0.3 0.9 l-0.3 -0.9 l-0.9 -0.3 l0.9 -0.3 Z" opacity="${still ? 0.6 : 0}">
      ${loop(still, `<animate attributeName="opacity" values="1;0;0;1" keyTimes="0;0.25;0.85;1" dur="1.8s" repeatCount="indefinite"/>`)}
    </path>
  </g>
</svg>`);
}

// Sparks shed by the broom: a strip of embers, brightest nearest her.
const SPARKS = svg(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 20">
  <g fill="#ffd166">
    <circle cx="112" cy="9" r="1.4"/>
    <circle cx="98" cy="13" r="1.1"/>
    <circle cx="86" cy="6" r="0.9"/>
    <circle cx="70" cy="11" r="0.8"/>
    <circle cx="52" cy="7" r="0.6"/>
    <circle cx="34" cy="12" r="0.5"/>
  </g>
  <g fill="#ff8a2a">
    <circle cx="105" cy="5" r="1"/>
    <circle cx="91" cy="10" r="0.8"/>
    <circle cx="78" cy="15" r="0.7"/>
    <circle cx="61" cy="4" r="0.5"/>
    <circle cx="44" cy="10" r="0.45"/>
  </g>
  <path d="M116 4 l0.6 1.8 l1.8 0.6 l-1.8 0.6 l-0.6 1.8 l-0.6 -1.8 l-1.8 -0.6 l1.8 -0.6 Z" fill="#fff4d6"/>
  <path d="M94 15 l0.4 1.2 l1.2 0.4 l-1.2 0.4 l-0.4 1.2 l-0.4 -1.2 l-1.2 -0.4 l1.2 -0.4 Z" fill="#fff4d6"/>
</svg>`);

// A squat hat with the classic floppy tip bent over sideways, so it can rest
// on the top of the 32px avatar circle and still fit inside the top bar.
function hat(still: boolean) {
  return svg(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 22">
  <defs>
    <linearGradient id="cone" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#4a2c72"/>
      <stop offset="0.5" stop-color="#2c1846"/>
      <stop offset="1" stop-color="#160b26"/>
    </linearGradient>
    <linearGradient id="brim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3a2160"/>
      <stop offset="1" stop-color="#120820"/>
    </linearGradient>
    <linearGradient id="band" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ff9a3c"/>
      <stop offset="1" stop-color="#d9620f"/>
    </linearGradient>
  </defs>
  <g stroke-linejoin="round" stroke-linecap="round">
    <path d="M12.2 17.6 L16.6 7.4 Q18.6 3.4 22.8 3.4 Q28.4 3.4 32.2 7.6 Q28.6 6.4 25.6 7.2 L28.4 17.6 Z" fill="url(#cone)"/>
    <path d="M22.4 4.4 Q26.6 4.6 29.6 6.6" fill="none" stroke="#7a52b0" stroke-opacity="0.5" stroke-width="0.5"/>
    <path d="M19.4 8.6 Q20.4 11.6 19.8 14.6" fill="none" stroke="#120820" stroke-opacity="0.55" stroke-width="0.5"/>
    <path d="M22.4 9.2 L24.6 8.8 L25 11 L22.8 11.4 Z" fill="#5d3a8c" stroke="#d9c4ff" stroke-opacity="0.6" stroke-width="0.3" stroke-dasharray="0.6 0.5"/>
    <path d="M13.4 14.2 Q20.4 15.6 27.4 14.2 L28.1 16.9 Q20.4 18.4 12.7 16.9 Z" fill="url(#band)"/>
    <rect x="18.3" y="14.4" width="4.2" height="3.2" rx="0.5" fill="none" stroke="#ffd166" stroke-width="0.9"/>
    <rect x="19.9" y="15" width="0.9" height="2" fill="#ffd166"/>
    <ellipse cx="20.2" cy="18.4" rx="19" ry="3.4" fill="url(#brim)"/>
    <path d="M3.6 17.8 Q20.2 14 36.8 17.8" fill="none" stroke="#7a52b0" stroke-opacity="0.55" stroke-width="0.55"/>
    <path d="M32.4 6.2 l0.45 1.25 l1.25 0.45 l-1.25 0.45 l-0.45 1.25 l-0.45 -1.25 l-1.25 -0.45 l1.25 -0.45 Z" fill="#fff4d6" opacity="${still ? 0.8 : 0}">
      ${loop(still, `<animate attributeName="opacity" values="0;1;0;0" keyTimes="0;0.15;0.3;1" dur="3.2s" repeatCount="indefinite"/>`)}
    </path>
  </g>
</svg>`);
}

// A carved pumpkin lit from inside, drawn for ~15px. One smooth outline (no
// stacked shapes, so no seams); the ribs, the dimple and the round of the
// body are blurred shading clipped inside it. The stem grows out of the
// dimple, and the leaf and the curl of vine start at its base. The cuts are
// rounded, and the candle glows through the skin around them. Every blur
// gets the whole picture as its region, or its box shows as a faint edge.
const LANTERN_BODY =
  "M16 8.6 C19 7.6 22.6 7.8 25.4 9.6 C29.6 12.2 30.8 17 30 21.4 C29.2 26.2 25.4 29.4 21 29.6 C19.2 29.7 17.6 29.3 16 28.9 C14.4 29.3 12.8 29.7 11 29.6 C6.6 29.4 2.8 26.2 2 21.4 C1.2 17 2.4 12.2 6.6 9.6 C9.4 7.8 13 7.6 16 8.6 Z";
const LANTERN_CUTS = [
  "M9.2 16.8 Q10.6 14.4 12.4 12.4 Q13.6 14.6 14 16.9 Q11.6 17.6 9.2 16.8 Z",
  "M22.8 16.8 Q21.4 14.4 19.6 12.4 Q18.4 14.6 18 16.9 Q20.4 17.6 22.8 16.8 Z",
  "M15 18.9 Q16 17.2 17 18.9 Q16 19.3 15 18.9 Z",
  "M8.6 20.4 Q16 27.2 23.4 20.4 Q21.8 21.6 20.6 21.3 Q19.8 22.6 18.7 21.9 Q16 22.9 13.3 21.9 Q12.2 22.6 11.4 21.3 Q10.2 21.6 8.6 20.4 Z"
];

const LANTERN = svg(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <defs>
    <radialGradient id="skin" cx="0.36" cy="0.3" r="0.82">
      <stop offset="0" stop-color="#ffbb62"/>
      <stop offset="0.45" stop-color="#f5821c"/>
      <stop offset="0.85" stop-color="#c65410"/>
      <stop offset="1" stop-color="#9a3a07"/>
    </radialGradient>
    <linearGradient id="stem" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#93a852"/>
      <stop offset="0.55" stop-color="#5a7024"/>
      <stop offset="1" stop-color="#394913"/>
    </linearGradient>
    <linearGradient id="leaf" x1="1" y1="0.6" x2="0" y2="0.4">
      <stop offset="0" stop-color="#5f7f24"/>
      <stop offset="1" stop-color="#8fb043"/>
    </linearGradient>
    <radialGradient id="flame" cx="0.5" cy="0.62" r="0.62">
      <stop offset="0" stop-color="#fff7cc"/>
      <stop offset="0.5" stop-color="#ffd04e"/>
      <stop offset="1" stop-color="#f39216"/>
    </radialGradient>
    <clipPath id="body"><path d="${LANTERN_BODY}"/></clipPath>
    <filter id="blur" x="-4" y="-4" width="40" height="40" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="1.1"/></filter>
    <filter id="soft" x="-4" y="-4" width="40" height="40" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="0.45"/></filter>
    <filter id="glow" x="-4" y="-4" width="40" height="40" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="1.8"/></filter>
  </defs>
  <path d="${LANTERN_BODY}" fill="url(#skin)"/>
  <g clip-path="url(#body)" fill="none" stroke-linecap="round">
    <g stroke="#8a3205" stroke-opacity="0.5" stroke-width="1.5" filter="url(#blur)">
      <path d="M10.6 9 Q8.2 19 10.8 29.4"/>
      <path d="M21.4 9 Q23.8 19 21.2 29.4"/>
      <path d="M5.6 11.4 Q3 20 5.8 27.6"/>
      <path d="M26.4 11.4 Q29 20 26.2 27.6"/>
    </g>
    <g stroke="#ffc074" stroke-opacity="0.35" stroke-width="1.1" filter="url(#blur)">
      <path d="M12.2 10 Q10.2 19 12.4 28"/>
      <path d="M7.2 12 Q5.2 19.6 7.4 26.6"/>
    </g>
    <ellipse cx="16" cy="9.6" rx="4.6" ry="1.6" fill="#7a2c05" opacity="0.55" filter="url(#blur)"/>
    <ellipse cx="16" cy="30" rx="13" ry="3" fill="#6a2404" opacity="0.6" filter="url(#blur)"/>
    <ellipse cx="11" cy="13.4" rx="3.4" ry="2.2" fill="#fff2d6" opacity="0.4" filter="url(#blur)"/>
    <ellipse cx="16" cy="19.4" rx="8.6" ry="6" fill="#ffd25a" opacity="0.45" filter="url(#glow)"/>
  </g>
  <g>
    <g fill="none" stroke="#7a2c05" stroke-width="0.9" stroke-linejoin="round" opacity="0.7" filter="url(#soft)">
      ${LANTERN_CUTS.map((d) => `<path d="${d}"/>`).join("")}
    </g>
    <g fill="url(#flame)">
      ${LANTERN_CUTS.map((d) => `<path d="${d}"/>`).join("")}
    </g>
  </g>
  <path d="M14.8 9.6 C12.8 7.2 9.8 6.4 7.2 7.6 C8.6 9.9 11.8 10.9 14.8 9.6 Z" fill="url(#leaf)"/>
  <path d="M14.6 9.5 C12.4 8.6 10.4 8.2 8.4 8" fill="none" stroke="#4b6418" stroke-width="0.35" stroke-linecap="round"/>
  <path d="M17.4 9.4 C19.4 7.6 22.6 7.2 23.5 8.9 C24.1 10.1 23.1 11 22.3 10.4" fill="none" stroke="#5f7a26" stroke-width="0.75" stroke-linecap="round"/>
  <path d="M14 10.8 C13.8 8.4 14.5 5.9 16.3 4.1 C16.9 3.5 18.1 3.5 18.5 4.3 C18.7 4.8 18.4 5.2 18.1 5.6 C16.9 7.1 16.8 8.8 17.9 10.8 Z" fill="url(#stem)"/>
  <path d="M15.6 9.8 C15.4 8 15.8 6.2 17 4.8" fill="none" stroke="#b6c97a" stroke-opacity="0.55" stroke-width="0.4" stroke-linecap="round"/>
  <ellipse cx="17.6" cy="4" rx="0.9" ry="0.55" fill="#c8d68f" opacity="0.8"/>
</svg>`);

// Fog: fractal noise, stitched so it tiles sideways without a seam, used as
// an alpha mask over the theme's foreground colour (grey on light, pale on
// dark). One tile is taller than the fog ever is, so it never repeats
// upwards.
const FOG_TILE = { width: 560, height: 720 };

function fog(seed: number, frequency: string) {
  return svg(`
<svg xmlns="http://www.w3.org/2000/svg" width="${FOG_TILE.width}" height="${FOG_TILE.height}">
  <filter id="f" x="0" y="0" width="${FOG_TILE.width}" height="${FOG_TILE.height}" filterUnits="userSpaceOnUse">
    <feTurbulence type="fractalNoise" baseFrequency="${frequency}" numOctaves="4" seed="${seed}" stitchTiles="stitch"/>
    <feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  2.4 0 0 0 -0.9"/>
  </filter>
  <rect width="${FOG_TILE.width}" height="${FOG_TILE.height}" filter="url(#f)"/>
</svg>`);
}

const FOG_FAR = fog(7, "0.0045 0.009");
const FOG_NEAR = fog(23, "0.008 0.016");
// Thick at the floor, thinning to nothing as it rises.
const FOG_FADE =
  "linear-gradient(to top, #000 0%, rgb(0 0 0 / 0.85) 22%, rgb(0 0 0 / 0.35) 60%, transparent 100%)";

// How far a bank billows up and sinks back. Each bank reaches that far below
// the window, so lifting it never shows a gap at the floor. Nothing may clip
// the fog box: a rising bank's soft top passes above it, and clipping there
// cut the fade into a hard line across the rail. (A fixed box hanging below
// the window adds no scrolling.)
const FOG_RISE = 90;

// Each bank is a tile wider than the window on both sides and drifts by
// moving the whole layer (`transform`), which the browser can do without
// repainting the mask; animating `mask-position` repainted half the window
// every frame. One tile per loop, so the noise lines up again.
function fogLayer(image: string, opacity: number) {
  return `
  content: "";
  position: absolute;
  inset: 0 -${FOG_TILE.width}px -${FOG_RISE}px;
  will-change: transform;
  background-color: hsl(var(--foreground) / ${opacity});
  -webkit-mask-image: ${image}, ${FOG_FADE};
  -webkit-mask-size: ${FOG_TILE.width}px ${FOG_TILE.height}px, 100% 100%;
  -webkit-mask-repeat: repeat-x, no-repeat;
  -webkit-mask-position: 0 100%, 0 0;
  -webkit-mask-composite: source-in;
  mask-image: ${image}, ${FOG_FADE};
  mask-size: ${FOG_TILE.width}px ${FOG_TILE.height}px, 100% 100%;
  mask-repeat: repeat-x, no-repeat;
  mask-position: 0 100%, 0 0;
  mask-composite: intersect;`;
}

export const HALLOWEEN_CSS = `
#nprogress .bar {
  background-color: hsl(var(--primary));
}
#nprogress .bar::after {
  content: "";
  position: absolute;
  top: -7px;
  right: -18px;
  width: 74px;
  height: 48px;
  pointer-events: none;
  background: ${witch(false)} no-repeat center / contain;
  filter: drop-shadow(0 2px 2px rgb(0 0 0 / 0.35));
  animation: halloween-broom 0.9s ease-in-out infinite alternate;
}
#nprogress .bar::before {
  content: "";
  position: absolute;
  top: 30px;
  right: 40px;
  width: 120px;
  height: 20px;
  pointer-events: none;
  background: ${SPARKS} no-repeat right center / contain;
  -webkit-mask-image: linear-gradient(to left, #000 30%, transparent);
  mask-image: linear-gradient(to left, #000 30%, transparent);
  animation: halloween-sparks 0.45s steps(2, jump-none) infinite alternate;
}
@keyframes halloween-broom {
  from { transform: translateY(0) rotate(-3deg); }
  to { transform: translateY(4px) rotate(2deg); }
}
@keyframes halloween-sparks {
  from { opacity: 0.55; transform: translateY(0); }
  to { opacity: 1; transform: translateY(1px); }
}

.halloween-fog {
  position: fixed;
  inset-inline: 0;
  bottom: 0;
  z-index: 0;
  height: 48vh;
  pointer-events: none;
}
/* Two banks of fog drifting opposite ways, a whole tile per loop so the noise
   never jumps, each billowing up and sinking back on its own rhythm. */
.halloween-fog::before {
  ${fogLayer(FOG_FAR, 0.24)}
  animation:
    halloween-fog-right 80s linear infinite,
    halloween-fog-rise 13s ease-in-out infinite alternate;
}
.halloween-fog::after {
  ${fogLayer(FOG_NEAR, 0.16)}
  animation:
    halloween-fog-left 52s linear infinite,
    halloween-fog-rise 9s ease-in-out -4s infinite alternate;
}
@keyframes halloween-fog-right {
  from { transform: translateX(0); }
  to { transform: translateX(${FOG_TILE.width}px); }
}
@keyframes halloween-fog-left {
  from { transform: translateX(0); }
  to { transform: translateX(-${FOG_TILE.width}px); }
}
@keyframes halloween-fog-rise {
  from { translate: 0 0; }
  to { translate: 0 -${FOG_RISE}px; }
}
/* The rail is the app's background colour over the same background, so
   making it see-through changes nothing but letting the fog show. */
nav[data-sliding-hover] {
  background-color: transparent;
}

[data-user-menu] {
  position: relative;
}
/* Rests on the top of the 32px avatar circle, brim just over its edge, the
   floppy tip inside the top bar (8.5px of it above the circle), so nothing is
   clipped. */
[data-user-menu]::before {
  content: "";
  position: absolute;
  top: -9.5px;
  left: 50%;
  z-index: 1;
  width: 30px;
  height: 16.5px;
  pointer-events: none;
  background: ${hat(false)} no-repeat center / contain;
  filter: drop-shadow(0 1.5px 1px rgb(0 0 0 / 0.45));
  transform: translateX(-50%) rotate(-8deg);
  transform-origin: 50% 82%;
  transition: transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
/* Tips the hat on hover and while the menu is open. */
[data-user-menu]:hover::before,
[data-user-menu][data-state="open"]::before {
  transform: translateX(-50%) translateY(-1px) rotate(-14deg);
}

td[data-date$="-10-31"]::after {
  content: "";
  position: absolute;
  top: -1px;
  right: -1px;
  width: 15px;
  height: 15px;
  pointer-events: none;
  background: ${LANTERN} no-repeat center / contain;
  filter: drop-shadow(0 0 2.5px rgb(255 150 40 / 0.55));
}

[data-app-card] {
  position: relative;
  z-index: 1;
}

@media (prefers-reduced-motion: reduce) {
  #nprogress .bar::after {
    background-image: ${witch(true)};
    animation: none;
  }
  [data-user-menu]::before {
    background-image: ${hat(true)};
    transition: none;
  }
  #nprogress .bar::before,
  .halloween-fog::before,
  .halloween-fog::after {
    animation: none;
  }
}
`;

export function HalloweenStyles() {
  // A fixed stylesheet from this file; nothing in it comes from a user.
  return <style dangerouslySetInnerHTML={{ __html: HALLOWEEN_CSS }} />;
}
