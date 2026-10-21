// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The cast, in ASCII. Spaces are transparent; `$` hides what is behind
// without drawing a glyph, so a ghost in front of a gravestone covers it.
// String.raw keeps the backslashes as drawn.

const r = String.raw;

export const GHOST = {
  open: [r`  .---.  `, r` /$o$o$\ `, r` |$$O$$| `, r` |$$$$$| `],
  shut: [r`  .---.  `, r` /$=$=$\ `, r` |$$~$$| `, r` |$$$$$| `],
  peek: [r`  .---.  `, r` /$o$=$\ `, r` |$$o$$| `, r` |$$$$$| `],
  hem: [r` '^v^v^' `, r` 'v^v^v' `]
};

export const SKELETON = {
  stand: [r`  .-.  `, r` (o.o) `, r`  |=|  `, r` /|=|\ `, r`  / \  `],
  stampUp: [r`  .-. _`, r` (o.o)|`, r`  |=|/ `, r` /|=|  `, r`  / \  `],
  stampDown: [r`  .-.  `, r` (o.o) `, r`  |=|__`, r` /|=| #`, r`  / \  `],
  runA: [r`  .-.  `, r` (o.o) `, r`  |=|\ `, r` /|=|  `, r`  /  > `],
  runB: [r`  .-.  `, r` (o.o) `, r` /|=|  `, r`  |=|\ `, r`  |\   `],
  danceA: [r`\ .-. /`, r` (o.o) `, r`  |=|  `, r`  |=|  `, r`  / \  `],
  danceB: [r`  .-.  `, r` (^.^) `, r` /|=|\ `, r`  |=|  `, r`  |  \_`]
};

export const CAT = {
  ears: r` /\_/\  `,
  eyes: {
    left: r`(o o  ) `,
    ahead: r`( o o ) `,
    right: r`(  o o) `,
    blink: r`( - - ) `
  },
  body: [r` = ^ =  `, r`/$$$$$\ `, r`(_)_(_)~`]
};

export const CROW = [r`  _  `, r` (o> `, r`/)_) `, r` ''  `];

export const STONES = {
  rip: [r` .-. `, r`|RIP|`, r`|$$$|`],
  small: [r` __ `, r`|$$|`],
  cross: [r` | `, r`-+-`, r` | `],
  round: [r` .--. `, r`/$$$$\ `, r`|$$$$|`]
};

export const BAT = [r`\v/`, r`-v-`, r`/v\ `];

export const WITCH = {
  body: [
    r`       /\         `,
    r`      /  \        `,
    r`    _/____\_      `,
    r`     (o )         `,
    r`    /|$$|\        `
  ],
  cape: [r`    /|$$|\~       `, r`    /|$$|\~~      `],
  broom: r`  ===|==|===}}}}  `
};

export const HORSEMAN = {
  body: [
    r`           (@)     `,
    r`          _/|      `,
    r`    __,--'$$|__    `,
    r`   /$$_____$$$_\_  `
  ],
  legs: [r`  / /     \ \/ \/  `, r`  \ \     / /\ /\  `]
};

export const SPIDER = [
  r`  \  ||  /  `,
  r` \ \(oo)/ / `,
  r`  -=($$)=-  `,
  r` / /(__)\ \ `,
  r`  /      \  `
];

export const SHIP = [
  r`        |    |    |       `,
  r`       )_)  )_)  )_)      `,
  r`      )___))___))___)\    `,
  r`     )____)____)_____)\\  `,
  r`   _____|____|____|____\\\__`,
  r`   \$$$$$$$$$$$$$$$$$$$/  `
];

export const CANDLE = [r` ^ `, r`|$|`, r`|_|`];

export const LAMP = [r` | `, r`/~\ `];

export const NOZZLE = [r`||`, r`||`, r`\/`];

export const CLOCK = [
  r` .---. `,
  r`/$$$$$\ `,
  r`|$$$$$|`,
  r`\$$$$$/`,
  r` '---' `
];

/** Dot-matrix letters for the bats' "BOO", one '#' per bat: 52 bats. */
export const BOO = [
  ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."]
];

/**
 * The Carbon mark as thirteen stars, on the logo's own 424 × 480 canvas:
 * the hexagon, then the inner shape. `MARK_EDGES` joins them.
 */
export const MARK_STARS = [
  { x: 212, y: 0 },
  { x: 424, y: 120 },
  { x: 424, y: 360 },
  { x: 212, y: 480 },
  { x: 0, y: 360 },
  { x: 0, y: 120 },
  { x: 212, y: 110 },
  { x: 112, y: 177 },
  { x: 204, y: 240 },
  { x: 204, y: 350 },
  { x: 320, y: 300 },
  { x: 320, y: 240 },
  { x: 320, y: 180 }
];

export const MARK_EDGES: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [4, 5],
  [5, 0],
  [6, 7],
  [7, 8],
  [8, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [12, 6]
];
