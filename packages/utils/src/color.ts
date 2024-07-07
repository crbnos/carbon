import { getBucket } from "./hash";

const cache: Record<string, number> = {};

const colors = [
  { background: "#f4bb98", color: "#723c1b" },
  { background: "#264653", color: "#ffffff" },
  { background: "#2a9d8f", color: "#ffffff" },
  { background: "#4ff38c", color: "#000000" },
  { background: "#fef3dc", color: "#af813b" },
  { background: "#e76f51", color: "#ffffff" },
  { background: "#4ff38c", color: "#000000" },
  { background: "#219ebc", color: "#ffffff" },
  { background: "#3a86ff", color: "#ffffff" },
  { background: "#8338ec", color: "#ffffff" },
  { background: "#ffadad", color: "#792e2e" },
  { background: "#cef5ef", color: "#1f9c87" },
  { background: "#4f46e5", color: "#ffffff" },
  { background: "#caffbf", color: "#000000" },
  { background: "#e2eeff", color: "#3671c7" },
  { background: "#ffc6ff", color: "#7f47b3" },
  { background: "#cdbef5", color: "#5b3baf" },
  { background: "#5d4037", color: "#ffffff" },
];

export function getColor(name: string) {
  if (cache[name]) return colors[cache[name]!];
  const hash = getBucket(name, colors.length);
  cache[name] = hash;
  return colors[hash];
}
