// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Avatar } from "../Avatar";

describe("Avatar", () => {
  it("renders a generated avatar as a plain placeholder on the server", () => {
    // The style loads in the browser; the server render (and hydration) shows
    // a neutral circle, never the initials, so nothing flashes.
    const html = renderToStaticMarkup(
      <Avatar name="Jane Doe" src="dicebear:croodles-neutral:seed-one" />
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("JD");
    expect(html).toContain("bg-muted");
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
