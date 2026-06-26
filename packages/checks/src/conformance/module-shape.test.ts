import { describe, expect, it } from "vitest";
import type { ModuleDir } from "../check";
import { moduleShape } from "./module-shape";

const mod = (name: string, entries: string[]): ModuleDir => ({
  name,
  dir: `/x/${name}`,
  entries
});

const COMPLIANT = [
  "sales.service.ts",
  "sales.models.ts",
  "types.ts",
  "ui",
  "index.ts",
  "sales.server.ts"
];

describe("moduleShape", () => {
  it("passes a compliant module", () => {
    expect(moduleShape.inspect(mod("sales", COMPLIANT))).toHaveLength(0);
  });

  it("flags a missing required entry (types.ts)", () => {
    const v = moduleShape.inspect(
      mod("sales", ["sales.service.ts", "sales.models.ts", "ui", "index.ts"])
    );
    expect(v).toHaveLength(1);
    expect(v[0]?.snippet).toBe("missing:types.ts");
  });

  it("flags an extra service file", () => {
    const v = moduleShape.inspect(
      mod("settings", [
        ...COMPLIANT.map((e) => e.replace("sales", "settings")),
        "backups.service.ts"
      ])
    );
    expect(v.map((x) => x.snippet)).toContain(
      "extra-service:backups.service.ts"
    );
  });

  it("flags a missing primary service file", () => {
    const v = moduleShape.inspect(
      mod("sales", ["sales.models.ts", "types.ts", "ui", "index.ts"])
    );
    expect(v.map((x) => x.snippet)).toContain("missing:sales.service.ts");
  });

  it("allows multiple .server.ts and utils/test files", () => {
    const v = moduleShape.inspect(
      mod("quality", [
        "quality.service.ts",
        "quality.models.ts",
        "types.ts",
        "ui",
        "index.ts",
        "quality.server.ts",
        "inspectionBalloon.server.ts",
        "quality.utils.ts",
        "quality.utils.test.ts"
      ])
    );
    expect(v).toHaveLength(0);
  });
});
