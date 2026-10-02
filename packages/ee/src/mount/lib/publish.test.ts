// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import {
  type MountPublishSource,
  type PublishablePart,
  publishEntityType
} from "./publish";
import type { MountApiPort, MountMappingPort } from "./push";
import {
  type MountCompany,
  MountNotFoundError,
  type MountObject
} from "./types";

const COMPANY_ID = "co_1";
const PART_DEFINITION = "def_part";

function createFakeMount(overrides: Partial<MountApiPort> = {}) {
  const objects: MountObject[] = [];
  const companies: MountCompany[] = [];
  let next = 0;

  const api: MountApiPort = {
    async findCompaniesByIdentifier(_c, identifier) {
      return companies.filter((c) => c.identifier === identifier);
    },
    async createCompany(_c, input) {
      const created = { ...input, id: `cmp_${++next}` };
      companies.push(created);
      return created;
    },
    async updateCompany(_c, mountId, input) {
      const existing = companies.find((c) => c.id === mountId);
      if (!existing) throw new MountNotFoundError("record", mountId);
      Object.assign(existing, input);
      // Mount answers a PATCH with the changed fields, not the record.
      return [];
    },
    async findObjectsByIdentifier(_c, definitionId, identifier) {
      return objects.filter(
        (o) => o.definitionId === definitionId && o.identifier === identifier
      );
    },
    async createObject(_c, input) {
      const created = { ...input, id: `obj_${++next}` };
      objects.push(created);
      return created;
    },
    async updateObject(_c, mountId, input) {
      const existing = objects.find((o) => o.id === mountId);
      if (!existing) throw new MountNotFoundError("record", mountId);
      Object.assign(existing, input);
      // Mount answers a PATCH with the changed fields, not the record.
      return [];
    },
    ...overrides
  };

  return { api, objects, companies };
}

function createFakeMappings() {
  const rows = new Map<string, string>();
  const mappings: MountMappingPort = {
    async getExternalId(entityType, entityId, integration) {
      return rows.get(`${integration}:${entityType}:${entityId}`) ?? null;
    },
    async link(entityType, entityId, integration, externalId) {
      rows.set(`${integration}:${entityType}:${entityId}`, externalId);
    }
  };
  return { mappings, rows };
}

function partSource(parts: PublishablePart[]): MountPublishSource {
  return {
    async listStale(_entityType, limit, deferIds = []) {
      const deferred = new Set(deferIds);
      return [
        ...parts.filter((p) => !deferred.has(p.id)),
        ...parts.filter((p) => deferred.has(p.id))
      ].slice(0, limit);
    }
  };
}

function failingOn(identifiers: string[]) {
  return createFakeMount({
    async createObject(_c, input) {
      if (identifiers.includes(input.identifier)) throw new Error("rejected");
      return { ...input, id: `obj_${input.identifier}` };
    }
  });
}

describe("publishEntityType", () => {
  it("refuses parts with no object definition instead of inventing one", async () => {
    const { api, objects } = createFakeMount();
    const { mappings } = createFakeMappings();

    const summary = await publishEntityType(
      partSource([{ id: "i1", readableId: "P-1", name: "Bracket" }]),
      mappings,
      api,
      COMPANY_ID,
      "item",
      {}
    );

    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0]?.reason).toContain("part object definition");
    expect(objects).toHaveLength(0);
  });

  it("reports more when the cap is hit, without publishing past it", async () => {
    const { api, objects } = createFakeMount();
    const { mappings } = createFakeMappings();

    const parts: PublishablePart[] = Array.from({ length: 5 }, (_, i) => ({
      id: `i${i}`,
      readableId: `P-${i}`,
      name: `Part ${i}`
    }));

    const summary = await publishEntityType(
      partSource(parts),
      mappings,
      api,
      COMPANY_ID,
      "item",
      { partDefinitionId: PART_DEFINITION },
      3
    );

    expect(summary.created).toBe(3);
    expect(summary.more).toBe(true);
    expect(objects).toHaveLength(3);
  });

  it("keeps going after one record fails, and names the one that did", async () => {
    const { api, objects } = createFakeMount({
      async createObject(_c, input) {
        if (input.identifier === "P-2") throw new Error("Mount said no");
        return { ...input, id: `obj_${input.identifier}` };
      }
    });
    const { mappings } = createFakeMappings();

    const summary = await publishEntityType(
      partSource([
        { id: "i1", readableId: "P-1", name: "One" },
        { id: "i2", readableId: "P-2", name: "Two" },
        { id: "i3", readableId: "P-3", name: "Three" }
      ]),
      mappings,
      api,
      COMPANY_ID,
      "item",
      { partDefinitionId: PART_DEFINITION }
    );

    expect(summary.created).toBe(2);
    expect(summary.failed).toEqual([
      { entityId: "i2", reason: "Mount said no" }
    ]);
    expect(objects).toHaveLength(0); // the overridden create does not record
  });

  it("records a record with no identifier as failed rather than throwing", async () => {
    const { api } = createFakeMount();
    const { mappings } = createFakeMappings();

    const summary = await publishEntityType(
      partSource([{ id: "i1", readableId: null, name: "Nameless" }]),
      mappings,
      api,
      COMPANY_ID,
      "item",
      { partDefinitionId: PART_DEFINITION }
    );

    expect(summary.created).toBe(0);
    expect(summary.failed[0]?.entityId).toBe("i1");
    expect(summary.failed[0]?.reason).toContain("readableId");
  });

  it("records the read time, not the link time, as lastSyncedAt", async () => {
    const { api } = createFakeMount();
    const synced: Array<string | undefined> = [];
    const mappings: MountMappingPort = {
      async getExternalId() {
        return null;
      },
      async link(_t, _id, _i, _ext, options) {
        synced.push(options?.lastSyncedAt);
      }
    };
    let listedAt = "";
    const source: MountPublishSource = {
      async listStale() {
        listedAt = new Date().toISOString();
        // An edit landing after the read must still sort after lastSyncedAt.
        await new Promise((resolve) => setTimeout(resolve, 5));
        return [{ id: "i1", readableId: "P-1", name: "Bracket" }];
      }
    };

    await publishEntityType(source, mappings, api, COMPANY_ID, "item", {
      partDefinitionId: PART_DEFINITION
    });

    expect(synced).toHaveLength(1);
    expect(synced[0]).toBeDefined();
    expect(synced[0]! <= listedAt).toBe(true);
  });

  describe("records that keep failing", () => {
    const parts: PublishablePart[] = Array.from({ length: 5 }, (_, i) => ({
      id: `i${i}`,
      readableId: `P-${i}`,
      name: `Part ${i}`
    }));

    it("defers this run's failures to the next run", async () => {
      const { api } = failingOn(["P-0"]);
      const { mappings } = createFakeMappings();

      const summary = await publishEntityType(
        partSource(parts),
        mappings,
        api,
        COMPANY_ID,
        "item",
        { partDefinitionId: PART_DEFINITION }
      );

      expect(summary.deferred).toEqual(["i0"]);
    });

    it("spends the cap on fresh records before retrying deferred ones", async () => {
      const { api } = failingOn(["P-0", "P-1"]);
      const { mappings } = createFakeMappings();

      const summary = await publishEntityType(
        partSource(parts),
        mappings,
        api,
        COMPANY_ID,
        "item",
        { partDefinitionId: PART_DEFINITION },
        2,
        ["i0", "i1"]
      );

      expect(summary.created).toBe(2);
      expect(summary.failed).toHaveLength(0);
      expect(summary.more).toBe(true); // i4 is fresh and did not fit
      expect(summary.deferred.sort()).toEqual(["i0", "i1"]);
    });

    it("does not report more when only deferred records remain", async () => {
      const { api } = failingOn(["P-0", "P-1"]);
      const { mappings } = createFakeMappings();

      const summary = await publishEntityType(
        partSource(parts),
        mappings,
        api,
        COMPANY_ID,
        "item",
        { partDefinitionId: PART_DEFINITION },
        4,
        ["i0", "i1"]
      );

      expect(summary.created).toBe(3);
      expect(summary.failed).toEqual([{ entityId: "i0", reason: "rejected" }]);
      expect(summary.more).toBe(false);
      expect(summary.deferred.sort()).toEqual(["i0", "i1"]);
    });

    it("drops a deferred record once it publishes", async () => {
      const { api } = createFakeMount();
      const { mappings } = createFakeMappings();

      const summary = await publishEntityType(
        partSource(parts),
        mappings,
        api,
        COMPANY_ID,
        "item",
        { partDefinitionId: PART_DEFINITION },
        10,
        ["i0"]
      );

      expect(summary.created).toBe(5);
      expect(summary.deferred).toEqual([]);
    });
  });
});
