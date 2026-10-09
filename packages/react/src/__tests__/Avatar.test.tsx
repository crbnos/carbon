// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Avatar } from "../Avatar";
import { GENERATED_AVATAR_RENDER_VERSION } from "../utils/generatedAvatarImage";

describe("Avatar", () => {
  it("renders a generated avatar as an image of its server-drawn SVG", () => {
    // In the first HTML, before any JavaScript runs: the browser fetches the
    // avatar while the page loads, and caches it for the next refresh.
    const value = "dicebear:croodles-neutral:seed-one:1e3a8a";
    const html = renderToStaticMarkup(<Avatar name="Jane Doe" src={value} />);
    expect(html).toContain(
      `src="/file/avatar/${encodeURIComponent(value)}?v=${GENERATED_AVATAR_RENDER_VERSION}"`
    );
    expect(html).toContain("bg-white");
    expect(html).not.toContain("JD");
  });

  it("renders a URL as it is, without the generated-avatar styling", () => {
    const html = renderToStaticMarkup(
      <Avatar name="Jane Doe" src="https://example.com/avatars/jane.webp" />
    );
    expect(html).toContain('src="https://example.com/avatars/jane.webp"');
    expect(html).not.toContain("bg-white");
  });

  it("falls back to initials with no source", () => {
    const html = renderToStaticMarkup(<Avatar name="Jane Doe" />);
    expect(html).not.toContain("<img");
    expect(html).toContain("JD");
  });
});
