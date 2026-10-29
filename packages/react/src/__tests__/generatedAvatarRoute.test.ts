// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { generatedAvatarLoader } from "../GeneratedAvatar";
import { renderGeneratedAvatarSvg } from "../utils/generatedAvatar";
import {
  GENERATED_AVATAR_RENDER_VERSION,
  generatedAvatarUrl
} from "../utils/generatedAvatarImage";

const load = (value: string) =>
  generatedAvatarLoader({ params: { value } } as never) as Promise<Response>;

describe("generatedAvatarLoader (/file/avatar/:value)", () => {
  it("serves the SVG, cacheable forever", async () => {
    const response = await load("dicebear:voxel-art:seed-route:3b82f6");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "image/svg+xml; charset=utf-8"
    );
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable"
    );
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "default-src 'none'"
    );
    const svg = await response.text();
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.toLowerCase()).toContain("#3b82f6");
  });

  it("draws the same picture the browser preview draws", async () => {
    const value = "dicebear:lorelei:seed-same";
    const response = await load(value);
    expect(await response.text()).toBe(await renderGeneratedAvatarSvg(value));
  });

  it("returns 404 for anything that is not a generated avatar", async () => {
    for (const value of [
      "user-1.webp",
      "dicebear:adventurer:abc",
      "dicebear:croodles-neutral:../../x",
      ""
    ]) {
      expect((await load(value)).status).toBe(404);
    }
  });
});

describe("generatedAvatarUrl", () => {
  it("encodes the value and carries the render version", () => {
    expect(generatedAvatarUrl("dicebear:planets:seed-1:ffd5dc")).toBe(
      `/file/avatar/dicebear%3Aplanets%3Aseed-1%3Affd5dc?v=${GENERATED_AVATAR_RENDER_VERSION}`
    );
  });
});
