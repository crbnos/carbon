// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";
import {
  assetModuleUrl,
  clientOnlyAlias,
  dropStalledHmrClients,
  extractIcons,
  findIconImports,
  inlineDatasetAssetGlob,
  listDatasetAssetFiles,
  rewriteIconImports
} from "../vite.js";

describe("clientOnlyAlias", () => {
  const plugin = clientOnlyAlias("unpdf/pdfjs", "/stub.mjs") as unknown as {
    applyToEnvironment: (environment: { name: string }) => boolean;
    resolveId: {
      filter: { id: RegExp };
      handler: (source: string) => string | undefined;
    };
  };

  it("applies to the client environment only", () => {
    expect(plugin.applyToEnvironment({ name: "client" })).toBe(true);
    expect(plugin.applyToEnvironment({ name: "ssr" })).toBe(false);
    expect(plugin.applyToEnvironment({ name: "ssr_bundle_x" })).toBe(false);
  });

  it("resolves the exact specifier and nothing else", () => {
    expect(plugin.resolveId.handler("unpdf/pdfjs")).toBe("/stub.mjs");
    expect(plugin.resolveId.handler("unpdf")).toBeUndefined();
  });

  it("filters natively on the exact specifier", () => {
    const { id } = plugin.resolveId.filter;
    expect(id.test("unpdf/pdfjs")).toBe(true);
    expect(id.test("unpdf/pdfjs/x")).toBe(false);
    expect(id.test("xunpdf/pdfjs")).toBe(false);
  });
});

describe("findIconImports", () => {
  it("collects the names each set import uses, aliases by their source name", () => {
    const code = [
      "import {",
      "  PiLinkBreak as Broken,",
      "  PiShareNetworkFill",
      "} from 'react-icons/pi';",
      'import { LuA, LuA as Again, LuB } from "react-icons/lu";'
    ].join("\n");
    expect(findIconImports(code)).toEqual(
      new Map([
        ["pi", new Set(["PiLinkBreak", "PiShareNetworkFill"])],
        ["lu", new Set(["LuA", "LuB"])]
      ])
    );
  });

  it("ignores type-only imports, the package root and lib", () => {
    const code = [
      'import type { IconType } from "react-icons";',
      'import type { IconType as T } from "react-icons/lib";',
      'import { type IconType as U } from "react-icons/lib";',
      'import { IconContext } from "react-icons/lib";',
      'import { type IconType as V } from "react-icons/lu";'
    ].join("\n");
    expect(findIconImports(code).size).toBe(0);
  });
});

describe("findIconImports with comments", () => {
  it("drops comments inside the braces from the names", () => {
    const found = findIconImports(
      'import { LuA, /* group */ LuB, // trailing\n  LuC } from "react-icons/lu";'
    );
    expect([...(found.get("lu") ?? [])]).toEqual(["LuA", "LuB", "LuC"]);
  });

  it("reads a block-comment opener inside a line comment as part of it", () => {
    const found = findIconImports(
      'import {\n  LuA, // see /* note\r\n  LuB\n} from "react-icons/lu";'
    );
    expect([...(found.get("lu") ?? [])]).toEqual(["LuA", "LuB"]);
  });
});

describe("rewriteIconImports", () => {
  const version = (set: string) => (set === "lu" ? "3" : "0");

  it("points each set import at that set's current module", () => {
    expect(
      rewriteIconImports(
        [
          'import { LuX, LuCheck } from "react-icons/lu";',
          'import { BsX } from "react-icons/bs";'
        ].join("\n"),
        version
      )
    ).toBe(
      [
        'import { LuX, LuCheck } from "carbon-icons:lu:3";',
        'import { BsX } from "carbon-icons:bs:0";'
      ].join("\n")
    );
  });

  it("keeps the import clause and line breaks as written", () => {
    const code = [
      "import {",
      "  PiLinkBreak as Broken,",
      "  PiShareNetworkFill",
      "} from 'react-icons/pi';",
      "const x = 1;"
    ].join("\n");
    expect(rewriteIconImports(code, version)).toBe(
      code.replace("'react-icons/pi'", "'carbon-icons:pi:0'")
    );
  });

  it("returns null when there is no icon import to rewrite", () => {
    expect(
      rewriteIconImports(
        'import type { IconType } from "react-icons/lib";',
        version
      )
    ).toBeNull();
  });
});

describe("extractIcons", () => {
  const icon = (name: string) =>
    [
      `export function ${name} (props) {`,
      `  return GenIcon({"tag":"svg","attr":{"viewBox":"0 0 24 24"},"child":[]})(props);`,
      "};"
    ].join("\n");
  const setSource = [
    "// THIS FILE IS AUTO GENERATED",
    "import { GenIcon } from '../lib/index.mjs';",
    icon("LuA"),
    icon("LuB"),
    icon("LuC"),
    ""
  ].join("\n");

  it("copies only the named icons, with GenIcon from the package", () => {
    expect(extractIcons(setSource, "lu", ["LuC", "LuA"])).toBe(
      [
        'import { GenIcon } from "react-icons/lib";',
        icon("LuC"),
        icon("LuA"),
        ""
      ].join("\n")
    );
  });

  it("re-exports an icon in an unexpected form from the set itself", () => {
    const odd =
      "export function LuOdd (props) {\n  return something(props);\n};";
    expect(extractIcons(`${setSource}${odd}\n`, "lu", ["LuA", "LuOdd"])).toBe(
      [
        'import { GenIcon } from "react-icons/lib";',
        icon("LuA"),
        'export { LuOdd } from "react-icons/lu";',
        ""
      ].join("\n")
    );
  });

  it("leaves out a name the set does not have", () => {
    expect(extractIcons(setSource, "lu", ["LuA", "LuNope"])).toBe(
      ['import { GenIcon } from "react-icons/lib";', icon("LuA"), ""].join("\n")
    );
  });
});

describe("inlineDatasetAssetGlob", () => {
  it("replaces the glob in the shape assets.ts declares it", () => {
    // The declaration as `@carbon/database/dataset-assets` writes it.
    const code = [
      "const assets = (",
      "  import.meta as unknown as {",
      "    glob(",
      "      pattern: string,",
      "      options: { eager: true; query: string; import: string }",
      "    ): Record<string, string>;",
      "  }",
      ').glob("./assets/**/*.{svg,glb,json}", {',
      "  eager: true,",
      '  query: "?url",',
      '  import: "default"',
      "});",
      "",
      "export function getDatasetAssetUrl(path: string) {",
      "  return assets[path] ?? null;",
      "}"
    ].join("\n");
    expect(
      inlineDatasetAssetGlob(code, [
        ["./assets/a/b.svg", "data:image/svg+xml,x"],
        ["./assets/a/models/m.glb", "/@fs/repo/m.glb"]
      ])
    ).toBe(
      [
        'const assets: Record<string, string> = {"./assets/a/b.svg":"data:image/svg+xml,x","./assets/a/models/m.glb":"/@fs/repo/m.glb"};',
        "",
        "export function getDatasetAssetUrl(path: string) {",
        "  return assets[path] ?? null;",
        "}"
      ].join("\n")
    );
  });

  it("skips a comment that quotes the declaration", () => {
    const code = [
      "// replaces const assets = ( with a map",
      "const assets = (",
      "  import.meta as unknown as Glob",
      ').glob("./assets/**/*.svg", {',
      "  eager: true",
      "});",
      "export const used = assets;"
    ].join("\n");
    expect(inlineDatasetAssetGlob(code, [["./assets/a.svg", "/a.svg"]])).toBe(
      [
        "// replaces const assets = ( with a map",
        'const assets: Record<string, string> = {"./assets/a.svg":"/a.svg"};',
        "export const used = assets;"
      ].join("\n")
    );
  });

  it("leaves code without the glob alone", () => {
    expect(inlineDatasetAssetGlob("const assets = {};", [])).toBeNull();
  });
});

describe("listDatasetAssetFiles", () => {
  it("lists the glob's file types under the directory, sorted", async () => {
    const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const directory = await mkdtemp(join(tmpdir(), "dataset-assets-"));
    try {
      await mkdir(join(directory, "industry", "models"), { recursive: true });
      for (const file of [
        "industry/B.svg",
        "industry/A.svg",
        "industry/models/m.glb",
        "industry/models/m.graph.json",
        "industry/notes.txt"
      ]) {
        await writeFile(join(directory, file), "");
      }
      expect(await listDatasetAssetFiles(directory)).toEqual(
        [
          "industry/A.svg",
          "industry/B.svg",
          "industry/models/m.glb",
          "industry/models/m.graph.json"
        ].map((file) => join(...file.split("/")))
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("returns null for a missing directory", async () => {
    expect(
      await listDatasetAssetFiles("/nonexistent/dataset-assets")
    ).toBeNull();
  });
});

describe("assetModuleUrl", () => {
  it("reads the URL from a browser ?url module", () => {
    expect(assetModuleUrl('export default "/@fs/repo/a.svg"')).toBe(
      "/@fs/repo/a.svg"
    );
  });

  it("reads the URL from an SSR ?url module", () => {
    expect(
      assetModuleUrl(
        [
          '__vite_ssr_exportName__("default", () => { try { return __vite_ssr_export_default__ } catch {} });',
          'const __vite_ssr_export_default__ = "data:image/svg+xml,%3csvg%3e"'
        ].join("\n")
      )
    ).toBe("data:image/svg+xml,%3csvg%3e");
  });

  it("returns null for any other module", () => {
    expect(assetModuleUrl("export const url = 1;")).toBeNull();
  });
});

describe("dropStalledHmrClients", () => {
  it("disconnects a client whose backlog is over 4 MB and not shrinking", () => {
    vi.useFakeTimers();
    try {
      const MB = 1024 * 1024;
      const socket = (bufferedAmount: number) => ({
        bufferedAmount,
        terminate: vi.fn()
      });
      const reading = socket(64 * 1024);
      const slow = socket(6 * MB);
      const stalled = socket(5 * MB);
      const hook = dropStalledHmrClients().configureServer as (
        server: unknown
      ) => void;
      hook({
        ws: {
          clients: new Set([
            { socket: reading },
            { socket: slow },
            { socket: stalled }
          ])
        }
      });
      vi.advanceTimersByTime(5000);
      // One look is not enough: a slow page may be draining.
      expect(stalled.terminate).not.toHaveBeenCalled();
      slow.bufferedAmount = 5 * MB;
      vi.advanceTimersByTime(5000);
      expect(stalled.terminate).toHaveBeenCalledOnce();
      expect(slow.terminate).not.toHaveBeenCalled();
      expect(reading.terminate).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
