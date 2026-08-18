import { describe, expect, it } from "vitest";
import { parseOnshapeV2Settings } from "./settings";

// The entire safety argument for shipping v2 alongside the legacy integration
// is that a legacy-shaped row resolves to isV2:false. These pin that, including
// the shapes a real row can take on disk.

describe("parseOnshapeV2Settings — legacy rows stay legacy", () => {
  it("resolves an absent pipeline key to legacy, not to a default that could drift", () => {
    const result = parseOnshapeV2Settings({}, { active: true });
    expect(result.pipeline).toBe("legacy");
    expect(result.isV2).toBe(false);
  });

  it("resolves a REAL legacy row to legacy", () => {
    // Exactly the key set observed on the local stack before v2 existed.
    const legacyRow = {
      assetSyncEnabled: false,
      baseUrl: "https://cad.onshape.com",
      credentials: { type: "oauth2", accessToken: "x" },
      releaseImportEnabled: true,
      releaseImportMode: "changeNotice",
      scope: "OAuth2Read OAuth2Write"
    };
    expect(parseOnshapeV2Settings(legacyRow, { active: true }).isV2).toBe(
      false
    );
  });

  it("resolves null, undefined and non-object metadata to legacy", () => {
    for (const metadata of [null, undefined, "next", 42, []]) {
      expect(parseOnshapeV2Settings(metadata, { active: true }).isV2).toBe(
        false
      );
    }
  });

  it("does not accept near-miss pipeline values as v2", () => {
    for (const pipeline of ["Next", "NEXT", "v2", "true", true, 1, null]) {
      expect(parseOnshapeV2Settings({ pipeline }, { active: true }).isV2).toBe(
        false
      );
    }
  });

  it("only reports v2 on the exact string", () => {
    const result = parseOnshapeV2Settings(
      { pipeline: "next" },
      { active: true }
    );
    expect(result.pipeline).toBe("next");
    expect(result.isV2).toBe(true);
  });
});

describe("parseOnshapeV2Settings — the gate fails closed", () => {
  it("is not v2 when the integration is inactive, even if opted in", () => {
    const result = parseOnshapeV2Settings(
      { pipeline: "next" },
      { active: false }
    );
    // pipeline still reports what is stored...
    expect(result.pipeline).toBe("next");
    // ...but nothing may run against a deactivated integration.
    expect(result.isV2).toBe(false);
  });
});

describe("parseOnshapeV2Settings — v2 setting values", () => {
  it("applies documented defaults when keys are absent", () => {
    const result = parseOnshapeV2Settings(
      { pipeline: "next" },
      { active: true }
    );
    expect(result.attachAssetsOnRelease).toBe(true);
    expect(result.releaseImportV2).toBe("changeNotice");
    expect(result.allowUnreleasedSync).toBe(false);
  });

  it('accepts booleans and the form\'s "true"/"false" strings alike', () => {
    const asStrings = parseOnshapeV2Settings(
      {
        pipeline: "next",
        attachAssetsOnRelease: "false",
        allowUnreleasedSync: "true"
      },
      { active: true }
    );
    expect(asStrings.attachAssetsOnRelease).toBe(false);
    expect(asStrings.allowUnreleasedSync).toBe(true);

    const asBooleans = parseOnshapeV2Settings(
      {
        pipeline: "next",
        attachAssetsOnRelease: false,
        allowUnreleasedSync: true
      },
      { active: true }
    );
    expect(asBooleans.attachAssetsOnRelease).toBe(false);
    expect(asBooleans.allowUnreleasedSync).toBe(true);
  });

  it("falls back to the default for an unrecognised boolean rather than treating it as truthy", () => {
    // "yes" is truthy in JS; enabling an unreleased-version sync because
    // someone hand-edited a row would be a silent behaviour change.
    const result = parseOnshapeV2Settings(
      { pipeline: "next", allowUnreleasedSync: "yes" },
      { active: true }
    );
    expect(result.allowUnreleasedSync).toBe(false);
  });

  it("accepts the three release-import modes and rejects anything else", () => {
    for (const mode of ["off", "changeNotice", "revision"]) {
      expect(
        parseOnshapeV2Settings(
          { pipeline: "next", releaseImportV2: mode },
          { active: true }
        ).releaseImportV2
      ).toBe(mode);
    }
    expect(
      parseOnshapeV2Settings(
        { pipeline: "next", releaseImportV2: "directRevision" },
        { active: true }
      ).releaseImportV2
    ).toBe("changeNotice");
  });

  it("reads a cached Onshape tenant id, treating empty as absent", () => {
    expect(
      parseOnshapeV2Settings(
        { pipeline: "next", onshapeCompanyId: "abc123" },
        { active: true }
      ).onshapeCompanyId
    ).toBe("abc123");
    expect(
      parseOnshapeV2Settings(
        { pipeline: "next", onshapeCompanyId: "" },
        { active: true }
      ).onshapeCompanyId
    ).toBeNull();
  });
});
