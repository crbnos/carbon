// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { RawOptions } from "@bwip-js/node";
import bwipjs from "@bwip-js/node";

export async function generateQRCode(
  text: string,
  size: number,
  color?: string
): Promise<string> {
  const buffer = await bwipjs.toBuffer({
    bcid: "qrcode",
    text,
    scale: 2,
    height: size,
    width: size,
    ...(color && { barcolor: color })
  });
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

// The Carbon mark (`carbon-mark-light.svg`, 424 x 480) as two polygons: the
// hexagon, and the shape cut out of it. The points are the path's corners;
// its rounding is too small to show under the dots, so it is left out.
const CARBON_MARK_OUTLINE: [number, number][] = [
  [176.24, 9.8],
  [247.76, 9.8],
  [389.66, 93.94],
  [424, 154.22],
  [424, 325.78],
  [389.66, 386.06],
  [247.76, 470.2],
  [176.24, 470.2],
  [34.34, 386.06],
  [0, 325.78],
  [0, 154.22],
  [34.34, 93.94]
];
const CARBON_MARK_CUTOUT: [number, number][] = [
  [224.56, 112.03],
  [200.47, 112],
  [124.06, 157.84],
  [124.13, 197.94],
  [200.9, 243.62],
  [203.9, 248.9],
  [203.9, 339.17],
  [239.27, 359.22],
  [314.44, 314.28],
  [325.82, 294.23],
  [325.82, 186.25],
  [314.51, 166.25]
];
const CARBON_MARK_WIDTH = 424;
const CARBON_MARK_HEIGHT = 480;

// The mark's height, as a share of the code's width.
const CARBON_MARK_SHARE = 0.62;
// A module's dot radius (a module is 1 x 1). At 0.45 a phone camera reads the
// code at its on-screen size as reliably as a plain one; at 0.4 it misses more.
const DOT_RADIUS = 0.45;
// How far the mark's top and bottom edges fade, in modules (a blur).
const MARK_FADE = 0.25;

/** A QR code as an SVG drawn in dots, with the Carbon mark drawn under them
 *  in the code's own color (the halftone style). A dark module is a dark dot;
 *  a light module on the mark is a white dot, so every module keeps its value
 *  at its center. Encoded at the highest error correction ("H") as margin for
 *  the mark's faded edges. */
export function generateQRCodeSVG(text: string, color = "000000"): string {
  // `eclevel` is a BWIPP qrcode option bwip-js passes through but does not type.
  const options: RawOptions & { eclevel: "L" | "M" | "Q" | "H" } = {
    bcid: "qrcode",
    text,
    eclevel: "H"
  };
  const [symbol] = bwipjs.raw(options);
  if (!symbol || !("pixs" in symbol)) {
    throw new Error("Could not encode the QR code");
  }
  // One unit per module; a QR code is square.
  const { pixs, pixx: size } = symbol;

  // The three 7 x 7 finder patterns stay solid squares: scanners find the
  // code by them.
  const finders: [number, number][] = [
    [0, 0],
    [size - 7, 0],
    [0, size - 7]
  ];
  const isFinder = (x: number, y: number) =>
    finders.some(([fx, fy]) => x >= fx && x < fx + 7 && y >= fy && y < fy + 7);
  const finderSquares = finders
    .map(
      ([x, y]) =>
        `M${x} ${y}h7v7h-7z` +
        `M${x + 1} ${y + 1}v5h5v-5z` +
        `M${x + 2} ${y + 2}h3v3h-3z`
    )
    .join("");

  // Where the mark sits. It is drawn as its own shape, not snapped to the
  // modules, so its edges run through the dots wherever they fall.
  const markScale = (size * CARBON_MARK_SHARE) / CARBON_MARK_HEIGHT;
  const markLeft = (size - CARBON_MARK_WIDTH * markScale) / 2;
  const markTop = (size - CARBON_MARK_HEIGHT * markScale) / 2;
  // A light module's white dot only shows on the mark; elsewhere it is white
  // on white, so it is drawn only around the mark.
  const isNearMark = (x: number, y: number) =>
    x + 1 >= markLeft &&
    x - 1 <= size - markLeft &&
    y + 1 >= markTop &&
    y - 1 <= size - markTop;

  const dot = (x: number, y: number) =>
    `M${x + 0.5 - DOT_RADIUS} ${y + 0.5}` +
    `a${DOT_RADIUS} ${DOT_RADIUS} 0 1 0 ${DOT_RADIUS * 2} 0` +
    `a${DOT_RADIUS} ${DOT_RADIUS} 0 1 0 ${-DOT_RADIUS * 2} 0z`;

  let lightDots = "";
  let darkDots = "";
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (isFinder(x, y)) continue;
      if (pixs[y * size + x] === 1) darkDots += dot(x, y);
      else if (isNearMark(x, y)) lightDots += dot(x, y);
    }
  }

  const polygon = (points: [number, number][]) =>
    `M${points.map(([px, py]) => `${px} ${py}`).join("L")}Z`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">` +
    // The mark's top and bottom edges fade; its sides stay crisp. The blur is
    // in the mark's own units, so it is scaled to modules.
    `<filter id="fade" x="0" y="-10%" width="100%" height="120%">` +
    `<feGaussianBlur stdDeviation="0 ${MARK_FADE / markScale}" /></filter>` +
    `<rect width="${size}" height="${size}" fill="#ffffff" />` +
    `<path transform="translate(${markLeft} ${markTop}) scale(${markScale})" ` +
    `d="${polygon(CARBON_MARK_OUTLINE)}${polygon(CARBON_MARK_CUTOUT)}" ` +
    `fill="#${color}" fill-rule="evenodd" filter="url(#fade)" />` +
    `<path d="${lightDots}" fill="#ffffff" />` +
    `<path d="${darkDots}" fill="#${color}" />` +
    `<path d="${finderSquares}" fill="#${color}" fill-rule="evenodd" />` +
    "</svg>"
  );
}

export function generateQRCodeSync(text: string, size: number): string {
  // bwipjs.toBuffer returns a Promise, but when called without await
  // in a synchronous context, we need to handle it differently
  // For now, keeping the existing async implementation
  throw new Error(
    "Synchronous QR code generation not supported. Use async version or inline implementation."
  );
}
