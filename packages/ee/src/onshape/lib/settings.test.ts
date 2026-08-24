import { describe, expect, it } from "vitest";
import {
  onshapeSettingsSchema,
  onshapeWebhookWanted,
  parseOnshapeSettings
} from "./settings";

// Before the split these tests pinned that a legacy-shaped row resolved to
// isV2:false — the whole safety argument for two pipelines in one record. That
// question no longer exists: v2 lives in its own record, so "is this company on
// v2" is "does an active onshape-v2 row exist". What still needs pinning is the
// reading of the settings themselves, where a wrong default silently changes
// behaviour on deploy.

describe("parseOnshapeSettings", () => {
  it("treats an absent, inactive, or unreadable record as not on v2", () => {
    expect(parseOnshapeSettings(null, { active: false }).active).toBe(false);
    expect(parseOnshapeSettings({}, { active: false }).active).toBe(false);
    expect(
      parseOnshapeSettings(null, { active: false, readFailed: true }).active
    ).toBe(false);
  });

  it("distinguishes a query failure from a deliberate opt-out", () => {
    // A caller about to WRITE must retry on readFailed rather than treat it as
    // "not on v2" — a transient database error would otherwise turn a real
    // import into a silent no-op run.
    expect(parseOnshapeSettings(null, { active: false }).readFailed).toBe(
      false
    );
    expect(
      parseOnshapeSettings(null, { active: false, readFailed: true }).readFailed
    ).toBe(true);
  });

  it("defaults an installed record to attach-assets on, change-notice, no minting", () => {
    const settings = parseOnshapeSettings({}, { active: true });
    expect(settings.active).toBe(true);
    expect(settings.attachAssetsOnRelease).toBe(true);
    expect(settings.releaseImportMode).toBe("changeNotice");
    expect(settings.allowUnreleasedSync).toBe(false);
    // FALSE, not true. Copying attachAssetsOnRelease's "absent means on" reading
    // would start minting parts for every v2 install on deploy, unasked.
    expect(settings.createItemsOnRelease).toBe(false);
  });

  it("accepts the form's string booleans as well as real ones", () => {
    // A row can hold either shape: the form posts "true"/"false", but a
    // hand-edited row or an older build's write holds a real boolean.
    const fromForm = parseOnshapeSettings(
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
    const settings = parseOnshapeSettings(
      {
        attachAssetsOnRelease: "yes",
        createItemsOnRelease: 1,
        releaseImportMode: "sometimes"
      },
      { active: true }
    );
    expect(settings.attachAssetsOnRelease).toBe(true);
    expect(settings.createItemsOnRelease).toBe(false);
    expect(settings.releaseImportMode).toBe("changeNotice");
  });

  it("reads the three real release modes", () => {
    for (const mode of ["off", "changeNotice", "revision"] as const) {
      expect(
        parseOnshapeSettings({ releaseImportMode: mode }, { active: true })
          .releaseImportMode
      ).toBe(mode);
    }
  });

  it("only reports an onshapeCompanyId when one is really stored", () => {
    expect(parseOnshapeSettings({}, { active: true }).onshapeCompanyId).toBe(
      null
    );
    expect(
      parseOnshapeSettings({ onshapeCompanyId: "" }, { active: true })
        .onshapeCompanyId
    ).toBe(null);
    expect(
      parseOnshapeSettings({ onshapeCompanyId: "abc" }, { active: true })
        .onshapeCompanyId
    ).toBe("abc");
  });
});

describe("onshapeWebhookWanted", () => {
  const base = parseOnshapeSettings(
    { attachAssetsOnRelease: "false", releaseImportMode: "off" },
    { active: true }
  );

  it("is false only when every consumer is off", () => {
    expect(onshapeWebhookWanted(base)).toBe(false);
  });

  it("is true for each consumer on its own", () => {
    expect(onshapeWebhookWanted({ ...base, attachAssetsOnRelease: true })).toBe(
      true
    );
    expect(
      onshapeWebhookWanted({ ...base, releaseImportMode: "changeNotice" })
    ).toBe(true);
    expect(
      onshapeWebhookWanted({ ...base, releaseImportMode: "revision" })
    ).toBe(true);
    // Not optional: omitting this term deletes the subscription of a company
    // that turned auto-create on and everything else off, while flashing
    // success.
    expect(onshapeWebhookWanted({ ...base, createItemsOnRelease: true })).toBe(
      true
    );
  });
});

describe("onshapeSettingsSchema", () => {
  it("leaves every key absent when the form posts nothing", () => {
    // Every key is optional rather than defaulted. The save merges parsed values
    // over stored metadata, so a default would rewrite a stored setting on any
    // save that did not render the field.
    expect(onshapeSettingsSchema.parse({})).toEqual({});
  });

  it("coerces the switch strings the form actually posts", () => {
    expect(
      onshapeSettingsSchema.parse({
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
    expect(onshapeSettingsSchema.parse({ webhookSigningSecret: "" })).toEqual({
      webhookSigningSecret: ""
    });
  });

  it("rejects a release mode it does not know", () => {
    expect(() =>
      onshapeSettingsSchema.parse({ releaseImportMode: "sometimes" })
    ).toThrow();
  });
});
