import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Doubles
//
// The route's job is to decide: refuse or create, link, and then queue EXACTLY
// ONE of two background paths. Everything it talks to is stubbed so those
// decisions are what the test observes.
// ---------------------------------------------------------------------------

const itemLookup = vi.fn();
const itemFilters: Record<string, unknown> = {};

const carbonClient = {
  from(table: string) {
    if (table !== "item") {
      throw new Error(`unexpected table: ${table}`);
    }
    const chain = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        itemFilters[column] = value;
        return chain;
      },
      maybeSingle: () => itemLookup()
    };
    return chain;
  }
};

// `@carbon/glossary` marks its terms with the Lingui `msg` MACRO, which is
// compiled by the vite plugin the app build configures and the vitest config
// does not. The route reaches it transitively through `@carbon/form`'s
// components — none of which this test renders.
vi.mock("@carbon/glossary", () => ({
  terms: {},
  glossaryEntries: [],
  getDefinitionText: () => "",
  getTermText: () => "",
  getEntry: () => undefined,
  hasEntry: () => false,
  listEntries: () => [],
  lookupEntry: () => undefined,
  termSlug: (id: string) => id
}));

const requirePermissions = vi.fn();
vi.mock("@carbon/auth/auth.server", () => ({
  requirePermissions: (...args: unknown[]) => requirePermissions(...args)
}));
vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: () => ({ serviceRole: true })
}));

const getUserClaims = vi.fn();
vi.mock("@carbon/auth/users.server", () => ({
  getUserClaims: (...args: unknown[]) => getUserClaims(...args)
}));

const trigger = vi.fn();
vi.mock("@carbon/lib/trigger", () => ({
  trigger: (...args: unknown[]) => trigger(...args)
}));

const getOnshapeSettings = vi.fn();
const readItemIdsForElement = vi.fn();
const readItemIdForRevision = vi.fn();
const resolveOnshapeRevision = vi.fn();
const writeElementMapping = vi.fn();
const writeRevisionMapping = vi.fn();
const patchElementMappingMetadata = vi.fn();

vi.mock("@carbon/ee/onshape", () => ({
  // Real constant, not a stub: the route passes it to getOnshapeClient to say
  // WHICH Onshape record to authenticate as, and a wrong value there is exactly
  // the bug the required parameter exists to catch.
  ONSHAPE_V2_INTEGRATION_ID: "onshape-v2",
  getOnshapeSettings: (...args: unknown[]) => getOnshapeSettings(...args),
  getOnshapeClient: async () => ({
    client: { getCompanies: async () => [{ id: "onshape-co" }] },
    error: null
  }),
  readItemIdsForElement: (...args: unknown[]) => readItemIdsForElement(...args),
  readItemIdForRevision: (...args: unknown[]) => readItemIdForRevision(...args),
  resolveOnshapeRevision: (...args: unknown[]) =>
    resolveOnshapeRevision(...args),
  writeElementMapping: (...args: unknown[]) => writeElementMapping(...args),
  writeRevisionMapping: (...args: unknown[]) => writeRevisionMapping(...args),
  patchElementMappingMetadata: (...args: unknown[]) =>
    patchElementMappingMetadata(...args),
  writeOnshapeItemNotes: async () => undefined,
  buildOnshapeItemNotesBlock: () => ({}),
  readReleasePackageName: () => null,
  readReleasePackageNotes: () => null
}));

const upsertPart = vi.fn();
const getMakeMethods = vi.fn();
vi.mock("~/modules/items", async () => {
  // The validators are real — the whole point of widening the schema is that
  // the ordinary part fields validate the same way here as on the new-part
  // route, so stubbing them would test nothing.
  const models = await import("~/modules/items/items.models");
  return {
    ...models,
    upsertPart: (...args: unknown[]) => upsertPart(...args),
    getMakeMethods: (...args: unknown[]) => getMakeMethods(...args)
  };
});

import { action } from "./integrations.onshape.v2.create";

const COMPANY_ID = "company-1";
const USER_ID = "user-1";
const ITEM_ID = "item-created";

/** The revision Onshape answers with — deliberately NOT what the form posts. */
const ONSHAPE_REVISION = {
  id: "rev-onshape",
  partNumber: "rd-410",
  revision: "B",
  name: "Wandleser RFID",
  documentId: "doc-1",
  versionId: "ver-1",
  elementId: "el-1",
  elementType: 1,
  partId: null,
  releaseId: "release-1",
  releaseName: "REL-001"
};

function formData(overrides: Record<string, string> = {}) {
  const base: Record<string, string> = {
    // Identity, as the picker supplies it.
    partNumber: "RD-410",
    revision: "B",
    elementType: "1",
    documentId: "doc-1",
    versionId: "ver-1",
    elementId: "el-1",
    revisionId: "rev-onshape",
    // The Carbon half of the New Part form.
    replenishmentSystem: "Make",
    itemTrackingType: "Inventory",
    unitOfMeasureCode: "EA",
    defaultMethodType: "Make to Order",
    description: "A description the form collected",
    lotSize: "10",
    postingGroupId: "group-1",
    "custom-color": "red",
    ...overrides
  };

  const form = new FormData();
  for (const [key, value] of Object.entries(base)) {
    if (value === "") continue;
    form.append(key, value);
  }
  return form;
}

function request(form: FormData) {
  return new Request("http://localhost/api/integrations/onshape/v2/create", {
    method: "POST",
    body: form
  });
}

function claims(permissions: string[]) {
  return {
    role: "employee",
    permissions: {
      parts: {
        view: permissions.includes("view") ? [COMPANY_ID] : [],
        create: permissions.includes("create") ? [COMPANY_ID] : [],
        update: permissions.includes("update") ? [COMPANY_ID] : [],
        delete: permissions.includes("delete") ? [COMPANY_ID] : []
      }
    }
  };
}

function triggeredEvents() {
  return trigger.mock.calls.map((call) => call[0] as string);
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(itemFilters)) delete itemFilters[key];

  requirePermissions.mockResolvedValue({
    client: carbonClient,
    companyId: COMPANY_ID,
    userId: USER_ID
  });
  getOnshapeSettings.mockResolvedValue({
    readFailed: false,
    // The onshape-v2 record exists and is active — which IS the opt-in now that
    // v2 has its own integration rather than a pipeline key.
    active: true,
    onshapeCompanyId: "onshape-co"
  });
  readItemIdsForElement.mockResolvedValue([]);
  readItemIdForRevision.mockResolvedValue(null);
  resolveOnshapeRevision.mockResolvedValue({
    ok: true,
    revision: ONSHAPE_REVISION
  });
  upsertPart.mockResolvedValue({
    data: { id: "wrong-family-member" },
    error: null
  });
  itemLookup.mockResolvedValue({ data: { id: ITEM_ID }, error: null });
  writeElementMapping.mockResolvedValue(undefined);
  writeRevisionMapping.mockResolvedValue({ ok: true });
  patchElementMappingMetadata.mockResolvedValue(true);
  getMakeMethods.mockResolvedValue({
    data: [
      { id: "mm-active", status: "Active", changeOrderId: null },
      { id: "mm-co", status: "Draft", changeOrderId: "co-1" },
      { id: "mm-draft", status: "Draft", changeOrderId: null }
    ],
    error: null
  });
  getUserClaims.mockResolvedValue(
    claims(["view", "create", "update", "delete"])
  );
  trigger.mockResolvedValue(undefined);
});

describe("v2.create — what gets persisted", () => {
  it("takes id, revision and name from Onshape, never from the form", async () => {
    // The form posts RD-410; Onshape answers rd-410. Uppercasing a part number
    // the CAD system owns is the exact defect v2 exists to fix.
    await action({
      request: request(formData({ partNumber: "RD-410" })),
      params: {},
      context: {}
    } as never);

    expect(upsertPart).toHaveBeenCalledTimes(1);
    const part = upsertPart.mock.calls[0][1] as Record<string, unknown>;
    expect(part.id).toBe("rd-410");
    expect(part.revision).toBe("B");
    expect(part.name).toBe("Wandleser RFID");
  });

  it("carries the rest of the New Part form through to upsertPart", async () => {
    // The old modal collected four fields and hardcoded the rest. These are
    // the ones it could not reach.
    await action({
      request: request(formData()),
      params: {},
      context: {}
    } as never);

    const part = upsertPart.mock.calls[0][1] as Record<string, unknown>;
    expect(part.description).toBe("A description the form collected");
    expect(part.postingGroupId).toBe("group-1");
    expect(part.lotSize).toBe(10);
    expect(part.customFields).toEqual({ color: "red" });
  });

  it("confirms the created item by its full key, not by readable id alone", async () => {
    // `upsertPart` finishes with a lookup against the `parts` VIEW, which is
    // DISTINCT ON (readableId, companyId) and prefers a NAMED revision — so it
    // can hand back a different family member's id.
    const result = await action({
      request: request(formData()),
      params: {},
      context: {}
    } as never);

    expect(itemFilters).toMatchObject({
      readableId: "rd-410",
      revision: "B",
      companyId: COMPANY_ID,
      type: "Part"
    });
    expect((result as { itemId: string }).itemId).toBe(ITEM_ID);
    expect(writeElementMapping.mock.calls[0][1]).toMatchObject({
      itemId: ITEM_ID
    });
  });

  it("refuses to link when it cannot confirm which row it created", async () => {
    itemLookup.mockResolvedValue({ data: null, error: null });

    const result = await action({
      request: request(formData()),
      params: {},
      context: {}
    } as never);

    expect(result).toMatchObject({ success: false });
    expect(writeElementMapping).not.toHaveBeenCalled();
    expect(trigger).not.toHaveBeenCalled();
  });
});

describe("v2.create — duplicate refusals", () => {
  it("refuses an already-mapped element before creating anything", async () => {
    readItemIdsForElement.mockResolvedValue(["item-existing"]);

    const result = await action({
      request: request(formData()),
      params: {},
      context: {}
    } as never);

    expect(result).toMatchObject({ success: false, alreadyLinked: true });
    expect(upsertPart).not.toHaveBeenCalled();
    expect(trigger).not.toHaveBeenCalled();
  });
});

describe("v2.create — the bill of materials branch", () => {
  it("queues the import against the item's Draft, CO-free make method", async () => {
    const result = await action({
      request: request(formData({ importBom: "on" })),
      params: {},
      context: {}
    } as never);

    expect(result).toMatchObject({ success: true, importQueued: true });
    expect(triggeredEvents()).toEqual(["onshape-bom-import"]);
    expect(trigger.mock.calls[0][1]).toMatchObject({
      companyId: COMPANY_ID,
      userId: USER_ID,
      makeMethodId: "mm-draft",
      documentId: "doc-1",
      versionId: "ver-1",
      elementId: "el-1"
    });
  });

  it("never queues both asset paths", async () => {
    // The import job pulls the top-level item's own model itself. Running both
    // double-exports one element against a rate-limited API, and the loser
    // files its model away as a document.
    await action({
      request: request(formData({ importBom: "on" })),
      params: {},
      context: {}
    } as never);

    expect(triggeredEvents()).not.toContain("onshape-v2-item-assets");
  });

  it("pulls the assets itself when no BOM import was asked for", async () => {
    const result = await action({
      request: request(formData()),
      params: {},
      context: {}
    } as never);

    expect(result).toMatchObject({ success: true, importQueued: false });
    expect(triggeredEvents()).toEqual(["onshape-v2-item-assets"]);
  });

  it("marks the import in flight so the item can say so", async () => {
    await action({
      request: request(formData({ importBom: "on" })),
      params: {},
      context: {}
    } as never);

    expect(patchElementMappingMetadata).toHaveBeenCalledTimes(1);
    const patch = patchElementMappingMetadata.mock.calls[0][1] as {
      itemId: string;
      patch: { bomImport: { startedAt: string } };
    };
    expect(patch.itemId).toBe(ITEM_ID);
    expect(patch.patch.bomImport.startedAt).toEqual(expect.any(String));
  });

  it("still creates the part for a create-only user, and names what is missing", async () => {
    // `requirePermissions` THROWS a redirect on denial, so the import cannot be
    // declared on this route: a create-only user would be bounced off the page
    // and the part they asked for would never exist.
    getUserClaims.mockResolvedValue(claims(["view", "create"]));

    const result = await action({
      request: request(formData({ importBom: "on" })),
      params: {},
      context: {}
    } as never);

    expect(result).toMatchObject({ success: true, importQueued: false });
    expect((result as { message: string }).message).toMatch(
      /update and delete/i
    );
    expect(triggeredEvents()).toEqual(["onshape-v2-item-assets"]);
  });

  it("refuses a BOM import for a Part Studio body", async () => {
    // A body has no bill of materials. The form does not offer the option, so
    // this can only be a hand-posted request.
    const result = await action({
      request: request(formData({ importBom: "on", elementType: "0" })),
      params: {},
      context: {}
    } as never);

    expect(result).toMatchObject({ success: false });
    expect(upsertPart).not.toHaveBeenCalled();
    expect(trigger).not.toHaveBeenCalled();
  });

  it("falls back to the asset pull when there is no draft method to import into", async () => {
    getMakeMethods.mockResolvedValue({
      data: [{ id: "mm-co", status: "Draft", changeOrderId: "co-1" }],
      error: null
    });

    const result = await action({
      request: request(formData({ importBom: "on" })),
      params: {},
      context: {}
    } as never);

    expect(result).toMatchObject({ success: true, importQueued: false });
    expect(triggeredEvents()).toEqual(["onshape-v2-item-assets"]);
  });
});

describe("v2.create — the settings gate", () => {
  it("answers 'try again' on a failed settings READ, not 'v2 is off'", async () => {
    getOnshapeSettings.mockResolvedValue({
      readFailed: true,
      active: false,
      onshapeCompanyId: null
    });

    const result = await action({
      request: request(formData()),
      params: {},
      context: {}
    } as never);

    expect((result as { message: string }).message).toMatch(/try again/i);
    expect(upsertPart).not.toHaveBeenCalled();
  });

  it("refuses a company that has not connected the Onshape v2 integration", async () => {
    getOnshapeSettings.mockResolvedValue({
      readFailed: false,
      active: false,
      onshapeCompanyId: null
    });

    const result = await action({
      request: request(formData()),
      params: {},
      context: {}
    } as never);

    expect(result).toMatchObject({ success: false });
    expect(upsertPart).not.toHaveBeenCalled();
  });
});
