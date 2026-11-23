// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { LoaderFunctionArgs } from "react-router";
import { describe, expect, it } from "vitest";
import { loader } from "./templates.$file";

const get = (file: string) =>
  loader({ params: { file } } as unknown as LoaderFunctionArgs);

describe("Auth email templates", () => {
  it("serves each as HTML with Auth's placeholders for Auth to fill", async () => {
    const res = await get("magic-link.html");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("{{ .Token }}");
    expect(html).toContain("{{ .SiteURL }}/magic-link?token={{ .TokenHash }}");
  });

  it("is a 404 for anything else, which Auth treats as no template", async () => {
    expect((await get("nope.html")).status).toBe(404);
    expect((await get("../package.json")).status).toBe(404);
    expect((await get("constructor")).status).toBe(404);
  });
});
