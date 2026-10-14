// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import { mapItemToMountObject, mapSupplierToMountCompany } from "./mappers";
import {
  type MountApiPort,
  type MountMappingPort,
  pushCompanyToMount,
  pushItemToMount
} from "./push";
import {
  type MountCompany,
  MountNotFoundError,
  type MountObject
} from "./types";

const COMPANY_ID = "co_1";
const PART_DEFINITION = "def_part";

function createFakeMount() {
  const companies: MountCompany[] = [];
  const objects: MountObject[] = [];
  let next = 0;
  const id = (prefix: string) => `${prefix}_${++next}`;

  const api: MountApiPort = {
    async findCompaniesByIdentifier(_companyId, identifier) {
      return companies.filter((c) => c.identifier === identifier);
    },
    async createCompany(_companyId, input) {
      const created: MountCompany = { ...input, id: id("cmp") };
      companies.push(created);
      return created;
    },
    async updateCompany(_companyId, mountId, input) {
      const existing = companies.find((c) => c.id === mountId);
      if (!existing) throw new MountNotFoundError("record", mountId);
      Object.assign(existing, input);
      // Mount answers a PATCH with the changed fields, not the record.
      return [];
    },
    async findObjectsByIdentifier(_companyId, definitionId, identifier) {
      return objects.filter(
        (o) => o.definitionId === definitionId && o.identifier === identifier
      );
    },
    async createObject(_companyId, input) {
      const created: MountObject = { ...input, id: id("obj") };
      objects.push(created);
      return created;
    },
    async updateObject(_companyId, mountId, input) {
      const existing = objects.find((o) => o.id === mountId);
      if (!existing) throw new MountNotFoundError("record", mountId);
      Object.assign(existing, input);
      // Mount answers a PATCH with the changed fields, not the record.
      return [];
    }
  };

  return { api, companies, objects };
}

function createFakeMappings() {
  const rows = new Map<string, string>();
  const key = (entityType: string, entityId: string, integration: string) =>
    `${integration}:${entityType}:${entityId}`;

  const mappings: MountMappingPort = {
    async getExternalId(entityType, entityId, integration) {
      return rows.get(key(entityType, entityId, integration)) ?? null;
    },
    async link(entityType, entityId, integration, externalId) {
      rows.set(key(entityType, entityId, integration), externalId);
    }
  };

  return { mappings, rows };
}

describe("pushCompanyToMount", () => {
  it("creates once, then updates the same record on re-push", async () => {
    const { api, companies } = createFakeMount();
    const { mappings } = createFakeMappings();

    const input = mapSupplierToMountCompany({
      readableId: "SUP000123",
      name: "Northline Metals",
      taxId: "912345671"
    });

    const first = await pushCompanyToMount(
      mappings,
      api,
      COMPANY_ID,
      "supplier",
      "sup_1",
      input
    );
    const second = await pushCompanyToMount(
      mappings,
      api,
      COMPANY_ID,
      "supplier",
      "sup_1",
      { ...input, name: "Northline Metals AS" }
    );

    expect(first.status).toBe("created");
    expect(second.status).toBe("updated");
    expect(companies).toHaveLength(1);
    expect(companies[0]?.name).toBe("Northline Metals AS");
  });

  it("publishes again when the mapped record was deleted in Mount", async () => {
    const { api, companies } = createFakeMount();
    const { mappings } = createFakeMappings();

    const input = mapSupplierToMountCompany({
      readableId: "SUP000124",
      name: "Fjord Fasteners"
    });

    const first = await pushCompanyToMount(
      mappings,
      api,
      COMPANY_ID,
      "supplier",
      "sup_2",
      input
    );
    companies.splice(0, companies.length);

    const second = await pushCompanyToMount(
      mappings,
      api,
      COMPANY_ID,
      "supplier",
      "sup_2",
      input
    );

    expect(second.status).toBe("created");
    expect(second).not.toEqual(first);
    expect(companies).toHaveLength(1);
    expect(await mappings.getExternalId("supplier", "sup_2", "mount")).toBe(
      companies[0]?.id
    );
  });

  it("adopts a record created by hand in Mount instead of duplicating it", async () => {
    const { api, companies } = createFakeMount();
    const { mappings, rows } = createFakeMappings();

    await api.createCompany(COMPANY_ID, {
      identifier: "CUS000007",
      name: "Typed in by a quality lead"
    });

    const outcome = await pushCompanyToMount(
      mappings,
      api,
      COMPANY_ID,
      "customer",
      "cust_1",
      mapSupplierToMountCompany({
        readableId: "CUS000007",
        name: "Nordvik Transport"
      })
    );

    expect(outcome.status).toBe("updated");
    expect(companies).toHaveLength(1);
    expect(companies[0]?.name).toBe("Nordvik Transport");
    expect(rows.size).toBe(1);
  });

  it("refuses to guess when Mount holds two records with the identifier", async () => {
    const { api, companies } = createFakeMount();
    const { mappings, rows } = createFakeMappings();

    await api.createCompany(COMPANY_ID, {
      identifier: "SUP000123",
      name: "One"
    });
    await api.createCompany(COMPANY_ID, {
      identifier: "SUP000123",
      name: "Two"
    });

    const outcome = await pushCompanyToMount(
      mappings,
      api,
      COMPANY_ID,
      "supplier",
      "sup_1",
      mapSupplierToMountCompany({
        readableId: "SUP000123",
        name: "Northline Metals"
      })
    );

    expect(outcome).toEqual({
      status: "ambiguous",
      identifier: "SUP000123",
      matches: 2
    });
    // Nothing was written, and nothing was mapped.
    expect(companies.map((c) => c.name)).toEqual(["One", "Two"]);
    expect(rows.size).toBe(0);
  });
});

describe("pushItemToMount", () => {
  it("writes the part number as identifier and the part name as title", async () => {
    const { api, objects } = createFakeMount();
    const { mappings } = createFakeMappings();

    await pushItemToMount(
      mappings,
      api,
      COMPANY_ID,
      "item_1",
      mapItemToMountObject(
        { readableId: "P-1042", name: "Left Wing Bracket" },
        PART_DEFINITION
      )
    );

    expect(objects).toEqual([
      {
        id: "obj_1",
        identifier: "P-1042",
        title: "Left Wing Bracket",
        definitionId: PART_DEFINITION
      }
    ]);
  });

  it("scopes the adopt lookup to the part definition", async () => {
    const { api, objects } = createFakeMount();
    const { mappings } = createFakeMappings();

    // An object in a DIFFERENT register that happens to share the identifier.
    await api.createObject(COMPANY_ID, {
      identifier: "P-1042",
      title: "An equipment record",
      definitionId: "def_equipment"
    });

    const outcome = await pushItemToMount(
      mappings,
      api,
      COMPANY_ID,
      "item_1",
      mapItemToMountObject(
        { readableId: "P-1042", name: "Left Wing Bracket" },
        PART_DEFINITION
      )
    );

    expect(outcome.status).toBe("created");
    expect(objects).toHaveLength(2);
    expect(objects.find((o) => o.definitionId === "def_equipment")?.title).toBe(
      "An equipment record"
    );
  });
});
