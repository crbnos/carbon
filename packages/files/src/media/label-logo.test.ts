// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { beforeAll, describe, expect, it } from "vitest";
import { encodeImage } from "./image";
import { initNodeImageCodecs, renderLabelLogo } from "./node";

beforeAll(() => initNodeImageCodecs());

// 32×8: left half black, right half transparent (must print white).
async function halfBlackPng() {
  const width = 32;
  const height = 8;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width / 2; x++) data[(y * width + x) * 4 + 3] = 255;
  }
  return encodeImage({ data, width, height }, "png");
}

describe("renderLabelLogo", () => {
  it("renders a 1-bit ^GFA field and a mono PNG at the requested width", async () => {
    const logo = await renderLabelLogo(await halfBlackPng(), "png", {
      widthDots: 16
    });
    expect(logo.widthDots).toBe(16);
    expect(logo.heightDots).toBe(4);
    expect(logo.monoPng.startsWith("data:image/png;base64,")).toBe(true);
    // 2 bytes per row × 4 rows; each row is 8 black dots then 8 white.
    expect(logo.gfa).toBe("^GFA,8,8,2,FF00FF00FF00FF00");
  });

  it("crops before thresholding", async () => {
    const logo = await renderLabelLogo(await halfBlackPng(), "png", {
      widthDots: 16,
      crop: { x: 0.5, y: 0, width: 0.5, height: 1 }
    });
    expect(logo.gfa).toBe("^GFA,16,16,2,00000000000000000000000000000000");
  });
});
