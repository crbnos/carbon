import { getBucket } from "./hash";

const cache: Record<string, number> = {};

const colorIndex = {
  gray: 0,
  lightGray: 1,
  brown: 2,
  orange: 3,
  yellow: 4,
  green: 5,
  blue: 6,
  purple: 7,
  pink: 8,
  red: 9,
};

export type Color = keyof typeof colorIndex;

const colors = [
  { background: "#a6a5a5", color: "#32302c" },
  { background: "#e3e2e0", color: "#32302c" },
  { background: "#eee0da", color: "#442a1e" },
  { background: "#fadec9", color: "#49290e" },
  { background: "#f9e4bc", color: "#402c1b" },
  { background: "#dbeddb", color: "#1c3829" },
  { background: "#d3e5ef", color: "#183347" },
  { background: "#e8deee", color: "#412454" },
  { background: "#f5e0e9", color: "#4c2337" },
  { background: "#ffe2dd", color: "#5d1715" },
];

const darkColors = [
  { background: "#373737", color: "#ffffff" },
  { background: "#5a5a5a", color: "#ffffff" },
  { background: "#603b2c", color: "#ffffff" },
  { background: "#854c1d", color: "#ffffff" },
  { background: "#835e33", color: "#ffffff" },
  { background: "#2b593f", color: "#ffffff" },
  { background: "#28456c", color: "#ffffff" },
  { background: "#492f64", color: "#ffffff" },
  { background: "#69314c", color: "#ffffff" },
  { background: "#6e3630", color: "#ffffff" },
];

export function getColor(color: Color, mode = "light") {
  return mode === "dark"
    ? darkColors[colorIndex[color]]
    : colors[colorIndex[color]];
}

export function getColorByValue(name: string, mode = "light") {
  if (cache[name])
    return mode === "dark" ? darkColors[cache[name]!] : colors[cache[name]!];
  const hash = getBucket(name, colors.length);
  cache[name] = hash;
  return mode === "dark" ? darkColors[hash] : colors[hash];
}
