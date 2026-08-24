import { describe, expect, it } from "vitest";
import {
  legacyWebhookWanted,
  onshapeV2SettingsSchema,
  parseOnshapeV2Settings,
  v2WebhookWanted
} from "./settings-v2";

// Before the split these tests pinned that a legacy-shaped row resolved to
// isV2:false — the whole safety argument for two pipelines in one record. That
// question no longer exists: v2 lives in its own record, so "is this company on
// v2" is "does an active onshape-v2 row exist". What still needs pinning is the
// reading of the settings themselves, where a wrong default silently changes
// behaviour on deploy.

describe("parseOnshapeV2Settings", () => {
  it("treats an absent, inactive, or unreadable record as not on v2", () => {
    expect(parseOnshapeV2Settings(null, { active: false }).active).toBe(false);
    expect(parseOnshapeV2Settings({}, { active: false }).active).toBe(false);
    expect(
      parseOnshapeV2Settings(null, { active: false, readFailed: true }).active
    ).toBe(false);
  });

  it("distinguishes a query failure from a deliberate opt-out", () => {
    // A caller about to WRITE must retry on readFailed rather than treat it as
    // "not on v2" — a transient database error would otherwise turn a real
    // import into a silent no-op run.
    expect(parseOnshapeV2Settings(null, { active: false }).readFailed).toBe(
      false
    );
    expect(
      parseOnshapeV2Settings(null, { active: false, readFailed: true })
        .readFailed
    ).toBe(true);
  });

  it("defaults an installed record to attach-assets on, change-notice, no minting", () => {
    const settings = parseOnshapeV2Settings({}, { active: true });
    expect(settings.active).toBe(true);
    expect(settings.attachAssetsOnRelease).toBe(true);
    expect(settings.releaseImportV2).toBe("changeNotice");
    expect(settings.allowUnreleasedSync).toBe(false);
    // FALSE, not true. Copying attachAssetsOnRelease's "absent means on" reading
    // would start minting parts for every v2 install on deploy, unasked.
    expect(settings.createItemsOnRelease).toBe(false);
  });

  it("accepts the form's string booleans as well as real ones", () => {
    // A row can hold either shape: the form posts "true"/"false", but a
    // hand-edited row or an older build's write holds a real boolean.
    const fromForm = parseOnshapeV2Settings(
      {
        attachAssetsOnRelease: "false",
        allowUnreleasedSync: "true",
        createItemsOnRelease: "true"
      },
      { active: true }
    );
    expect(fromForm.attachAssetsOnRelease).toBe(false);
    expect(fromForm.allowUnreleasedSync).toBe(true);
    expect(fromForm.createItemsOnRelease).toBe(true);
  });

  it("falls back to the default for an unrecognised value, never to truthy", () => {
    const settings = parseOnshapeV2Settings(
      {
        attachAssetsOnRelease: "yes",
        createItemsOnRelease: 1,
        releaseImportV2: "sometimes"
      },
      { active: true }
    );
    expect(settings.attachAssetsOnRelease).toBe(true);
    expect(settings.createItemsOnRelease).toBe(false);
    expect(settings.releaseImportV2).toBe("changeNotice");
  });

  it("reads the three real release modes", () => {
    for (const mode of ["off", "changeNotice", "revision"] as const) {
      expect(
        parseOnshapeV2Settings({ releaseImportV2: mode }, { active: true })
          .releaseImportV2
      ).toBe(mode);
    }
  });

  it("only reports an onshapeCompanyId when one is really stored", () => {
    expect(parseOnshapeV2Settings({}, { active: true }).onshapeCompanyId).toBe(
      null
    );
    expect(
      parseOnshapeV2Settings({ onshapeCompanyId: "" }, { active: true })
        .onshapeCompanyId
    ).toBe(null);
    expect(
      parseOnshapeV2Settings({ onshapeCompanyId: "abc" }, { active: true })
        .onshapeCompanyId
    ).toBe("abc");
  });
});

describe("v2WebhookWanted", () => {
  const base = parseOnshapeV2Settings(
    { attachAssetsOnRelease: "false", releaseImportV2: "off" },
    { active: true }
  );

  it("is false only when every consumer is off", () => {
    expect(v2WebhookWanted(base)).toBe(false);
  });

  it("is true for each consumer on its own", () => {
    expect(v2WebhookWanted({ ...base, attachAssetsOnRelease: true })).toBe(
      true
    );
    expect(v2WebhookWanted({ ...base, releaseImportV2: "changeNotice" })).toBe(
      true
    );
    expect(v2WebhookWanted({ ...base, releaseImportV2: "revision" })).toBe(
      true
    );
    // Not optional: omitting this term deletes the subscription of a company
    // that turned auto-create on and everything else off, while flashing
    // success.
    expect(v2WebhookWanted({ ...base, createItemsOnRelease: true })).toBe(true);
  });
});

describe("legacyWebhookWanted", () => {
  it("reads only the legacy record's own toggles", () => {
    expect(legacyWebhookWanted(null)).toBe(false);
    expect(legacyWebhookWanted({})).toBe(false);
    expect(legacyWebhookWanted({ assetSyncEnabled: true })).toBe(true);
    expect(legacyWebhookWanted({ releaseImportEnabled: true })).toBe(true);
    // Strict === true: a string "true" in the column is not a legacy shape the
    // shipped integration ever writes, and the receiver reads it strictly too.
    expect(legacyWebhookWanted({ assetSyncEnabled: "true" })).toBe(false);
    // A v2 key on the legacy row means nothing.
    expect(legacyWebhookWanted({ attachAssetsOnRelease: true })).toBe(false);
  });
});

describe("onshapeV2SettingsSchema", () => {
  it("leaves every key absent when the form posts nothing", () => {
    // Every key is optional rather than defaulted. The save merges parsed values
    // over stored metadata, so a default would rewrite a stored setting on any
    // save that did not render the field.
    expect(onshapeV2SettingsSchema.parse({})).toEqual({});
  });

  it("coerces the switch strings the form actually posts", () => {
    expect(
      onshapeV2SettingsSchema.parse({
        attachAssetsOnRelease: "false",
        allowUnreleasedSync: "true",
        createItemsOnRelease: "false"
      })
    ).toEqual({
      attachAssetsOnRelease: false,
      allowUnreleasedSync: true,
      createItemsOnRelease: false
    });
  });

  it("keeps an empty signing secret as an empty string, not a deletion", () => {
    // splitSecrets drops an empty value rather than persisting it, which is what
    // makes "leave the field blank to keep the stored key" work. The schema must
    // not reject or default it.
    expect(onshapeV2SettingsSchema.parse({ webhookSigningSecret: "" })).toEqual(
      {
        webhookSigningSecret: ""
      }
    );
  });

  it("rejects a release mode it does not know", () => {
    expect(() =>
      onshapeV2SettingsSchema.parse({ releaseImportV2: "sometimes" })
    ).toThrow();
  });
});
