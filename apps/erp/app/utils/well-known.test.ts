import { describe, expect, it } from "vitest";
import routeConfig from "../routes";
import { isUnroutedWellKnownPath, wellKnownRoutePaths } from "./well-known";

/** Every route path in the generated config, absolute. */
async function configuredPaths(): Promise<string[]> {
  const out: string[] = [];

  const walk = (entries: any[], prefix = "") => {
    for (const entry of entries ?? []) {
      const path = [prefix, entry.path ?? ""].filter(Boolean).join("/");
      if (entry.path !== undefined) out.push(`/${path}`);
      if (entry.children) walk(entry.children, path);
    }
  };

  walk((await (routeConfig as any)) as any[]);
  return out;
}

describe("wellKnownRoutePaths", () => {
  it("reads .well-known routes out of the build manifest", () => {
    const paths = wellKnownRoutePaths({
      "routes/[.]well-known.oauth-protected-resource": {
        path: ".well-known/oauth-protected-resource"
      },
      "routes/[.]well-known.mcp[.]json": { path: ".well-known/mcp.json" },
      "routes/_public+/login": { path: "login" },
      root: { path: undefined }
    });

    expect([...paths].sort()).toEqual([
      "/.well-known/mcp.json",
      "/.well-known/oauth-protected-resource"
    ]);
  });

  it("survives a missing or empty manifest", () => {
    expect(wellKnownRoutePaths(undefined).size).toBe(0);
    expect(wellKnownRoutePaths({}).size).toBe(0);
  });
});

describe("isUnroutedWellKnownPath", () => {
  const routed = new Set(["/.well-known/oauth-protected-resource"]);

  it("short-circuits probes with no route", () => {
    for (const path of [
      "/.well-known/security.txt",
      "/.well-known/apple-app-site-association",
      "/.well-known/appspecific/com.chrome.devtools.json"
    ]) {
      expect(isUnroutedWellKnownPath(path, routed), path).toBe(true);
    }
  });

  it("lets a routed path through to the router", () => {
    // The regression: this returned an empty 204 in production, so the MCP
    // endpoint's 401 pointed clients at a URL that answered with nothing.
    expect(
      isUnroutedWellKnownPath("/.well-known/oauth-protected-resource", routed)
    ).toBe(false);
  });

  it("leaves every other path alone", () => {
    for (const path of ["/login", "/api/mcp", "/.env", "/x/.well-known/foo"]) {
      expect(isUnroutedWellKnownPath(path, routed), path).toBe(false);
    }
  });

  it("does not swallow any .well-known route this app actually has", async () => {
    // Derived from the real route config, so a route added later is covered
    // without editing this test.
    const wellKnown = (await configuredPaths()).filter((p) =>
      p.startsWith("/.well-known/")
    );
    const routedPaths = new Set(wellKnown);

    expect(wellKnown.length).toBeGreaterThan(0);
    for (const path of wellKnown) {
      expect(isUnroutedWellKnownPath(path, routedPaths), path).toBe(false);
    }
  });
});
