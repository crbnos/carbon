// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import {
  onshapeGrantPatch,
  onshapeSettingsPatch,
  onshapeTokenPatch
} from "./state";

function touchedPaths(patch: {
  metadata?: object;
  secrets?: object;
  removeMetadata?: string[];
  removeSecrets?: string[];
}) {
  return [
    ...Object.keys(patch.metadata ?? {}),
    ...Object.keys(patch.secrets ?? {}),
    ...(patch.removeMetadata ?? []),
    ...(patch.removeSecrets ?? [])
  ];
}

describe("onshapeSettingsPatch", () => {
  it("writes only the keys the form owns, never credentials or the property map", () => {
    const patch = onshapeSettingsPatch("onshape-government", {
      baseUrl: "https://acme.onshape.com",
      credentials: { accessToken: "stale" },
      propertyMap: []
    });
    expect(touchedPaths(patch)).toEqual(["baseUrl"]);
  });

  it("writes nothing for the panel integration, whose push defaults the Fields page owns", () => {
    const patch = onshapeSettingsPatch("onshape-v2", {
      defaultReplenishmentSystem: "Make",
      credentials: { accessToken: "stale" },
      propertyMap: []
    });
    expect(touchedPaths(patch)).toEqual([]);
  });

  it("clears a field saved empty", () => {
    expect(
      onshapeSettingsPatch("onshape-government", { baseUrl: "" }).removeMetadata
    ).toEqual(["baseUrl"]);
  });

  it("vaults a new Government client secret and keeps the old one when left empty", () => {
    expect(
      onshapeSettingsPatch("onshape-government", { clientSecret: "new" })
        .secrets
    ).toEqual({ clientSecret: "new" });
    expect(
      touchedPaths(
        onshapeSettingsPatch("onshape-government", { clientSecret: "" })
      )
    ).toEqual([]);
  });

  it("leaves a sync connection's grant alone when asset sync is saved", () => {
    expect(
      touchedPaths(
        onshapeSettingsPatch("onshape", {
          assetSyncEnabled: true,
          scope: "OAuth2Read",
          onshapeCompanyId: "c1"
        })
      )
    ).toEqual(["assetSyncEnabled"]);
  });
});

describe("onshapeTokenPatch", () => {
  it("touches only credential paths", () => {
    const patch = onshapeTokenPatch({
      accessToken: "a",
      refreshToken: "r",
      expiresAt: "2026-10-01T00:00:00.000Z"
    });
    expect(
      touchedPaths(patch).every((path) => path.startsWith("credentials."))
    ).toBe(true);
  });

  it("keeps the stored refresh token when the response carries none", () => {
    expect(
      onshapeTokenPatch({ accessToken: "a", expiresAt: "2026-10-01" }).secrets
    ).toEqual({ "credentials.accessToken": "a" });
  });
});

describe("onshapeGrantPatch", () => {
  const grant = {
    accessToken: "a",
    expiresAt: "2026-10-01T00:00:00.000Z",
    scope: "OAuth2Read",
    baseUrl: "https://cad.onshape.com",
    updatedBy: "u"
  };

  it("turns asset sync off for a read-only grant and drops the old refresh token", () => {
    const patch = onshapeGrantPatch({ ...grant, canWrite: false });
    expect(patch.metadata.assetSyncEnabled).toBe(false);
    expect(patch.removeSecrets).toEqual(["credentials.refreshToken"]);
    expect(patch.removeMetadata).toEqual(["onshapeCompanyId"]);
  });

  it("leaves asset sync and the property map untouched for a write grant", () => {
    const patch = onshapeGrantPatch({
      ...grant,
      canWrite: true,
      refreshToken: "r"
    });
    expect(touchedPaths(patch)).not.toContain("assetSyncEnabled");
    expect(touchedPaths(patch)).not.toContain("propertyMap");
    expect(patch.removeSecrets).toEqual([]);
  });
});
