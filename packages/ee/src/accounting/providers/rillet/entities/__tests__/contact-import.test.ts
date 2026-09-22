import { describe, expect, it, vi } from "vitest";
import type { Rillet } from "../../models";
import { mapRilletCustomerToLocal, RilletCustomerSyncer } from "../customer";
import { readCarbonExternalReference, splitRilletContactName } from "../shared";
import { mapRilletVendorToLocal, RilletVendorSyncer } from "../vendor";

/**
 * The INBOUND half of the Rillet contact syncers — the "Import customers &
 * vendors" action. The outbound mappers live in contact.test.ts.
 */

const COMPANY_ID = "company-1";

const customer = (overrides: Partial<Rillet.Customer> = {}): Rillet.Customer =>
  ({
    id: "ril-cus-1",
    name: "Acme Manufacturing",
    ...overrides
  }) as Rillet.Customer;

const vendor = (overrides: Partial<Rillet.Vendor> = {}): Rillet.Vendor =>
  ({
    id: "ril-ven-1",
    name: "Bolt Supply Co",
    ...overrides
  }) as Rillet.Vendor;

// /********************************************************\
// *                   Pure mappers                         *
// \********************************************************/

describe("readCarbonExternalReference", () => {
  it("returns the carbon id when the carbon-company tag names this company", () => {
    expect(
      readCarbonExternalReference(
        [
          { type: "carbon", id: "cus-local" },
          { type: "carbon-company", id: COMPANY_ID }
        ],
        COMPANY_ID
      )
    ).toBe("cus-local");
  });

  it("refuses a carbon id tagged for a DIFFERENT Carbon instance", () => {
    // Several Carbon instances can write into one Rillet organization and
    // entity ids are only unique per database, so an unqualified match could
    // link this company's mapping row to another instance's customer id.
    expect(
      readCarbonExternalReference(
        [
          { type: "carbon", id: "cus-local" },
          { type: "carbon-company", id: "another-company" }
        ],
        COMPANY_ID
      )
    ).toBeNull();
  });

  it("accepts a carbon id with no company tag (written before the tag shipped)", () => {
    expect(
      readCarbonExternalReference(
        [{ type: "carbon", id: "cus-local" }],
        COMPANY_ID
      )
    ).toBe("cus-local");
  });

  it("returns null for no references and for foreign reference types", () => {
    expect(readCarbonExternalReference(undefined, COMPANY_ID)).toBeNull();
    expect(
      readCarbonExternalReference(
        [{ type: "CUSTOMER_CUSTOM", id: "cus-local" }],
        COMPANY_ID
      )
    ).toBeNull();
  });
});

describe("splitRilletContactName", () => {
  it.each([
    ["Jane Doe", { firstName: "Jane", lastName: "Doe" }],
    [
      "Acme Industrial Supply",
      { firstName: "Acme Industrial", lastName: "Supply" }
    ],
    ["Acme", { firstName: "Acme", lastName: "" }],
    ["  Jane   Doe  ", { firstName: "Jane", lastName: "Doe" }]
  ])("splits %j on the last space", (name, expected) => {
    expect(splitRilletContactName(name as string)).toEqual(expected);
  });
});

describe("mapRilletCustomerToLocal", () => {
  it("prefers the MAIN_SENDER email over CC/BCC", () => {
    const local = mapRilletCustomerToLocal(
      customer({
        emails: [
          { email: "cc@acme.example", type: "CC" },
          { email: "ar@acme.example", type: "MAIN_SENDER" }
        ]
      }),
      { companyId: COMPANY_ID }
    );

    expect(local.email).toBe("ar@acme.example");
  });

  it("falls back to the first email when none is MAIN_SENDER", () => {
    const local = mapRilletCustomerToLocal(
      customer({ emails: [{ email: "cc@acme.example", type: "CC" }] }),
      { companyId: COMPANY_ID }
    );

    expect(local.email).toBe("cc@acme.example");
  });

  it("carries the claimed Carbon id, the split name and the customer flags", () => {
    const local = mapRilletCustomerToLocal(
      customer({
        external_references: [
          { type: "carbon", id: "cus-local" },
          { type: "carbon-company", id: COMPANY_ID }
        ]
      }),
      { companyId: COMPANY_ID }
    );

    expect(local).toMatchObject({
      id: "cus-local",
      name: "Acme Manufacturing",
      companyId: COMPANY_ID,
      firstName: "Acme",
      lastName: "Manufacturing",
      isCustomer: true,
      isVendor: false
    });
  });

  it("omits id entirely when the record claims no Carbon customer", () => {
    expect(
      mapRilletCustomerToLocal(customer(), { companyId: COMPANY_ID })
    ).not.toHaveProperty("id");
  });
});

describe("mapRilletVendorToLocal", () => {
  it("maps the flat email and tax id onto the supplier shape", () => {
    expect(
      mapRilletVendorToLocal(
        vendor({ email: "ap@bolt.example", tax_id: "12-3456789" }),
        { companyId: COMPANY_ID }
      )
    ).toMatchObject({
      name: "Bolt Supply Co",
      email: "ap@bolt.example",
      taxId: "12-3456789",
      isCustomer: false,
      isVendor: true
    });
  });

  it("nulls the tax id when Rillet has none", () => {
    expect(
      mapRilletVendorToLocal(vendor(), { companyId: COMPANY_ID }).taxId
    ).toBeNull();
  });
});

// /********************************************************\
// *              Remote batch fetch strategy               *
// \********************************************************/

function setupCustomerSyncer(remote: Rillet.Customer[]) {
  const getCustomer = vi.fn(
    async (id: string) => remote.find((c) => c.id === id) ?? null
  );
  const listCustomers = vi.fn(async () => remote);

  const syncer = new RilletCustomerSyncer({
    database: {} as never,
    companyId: COMPANY_ID,
    provider: { id: "rillet", getCustomer, listCustomers } as never,
    config: { enabled: true, direction: "push-to-accounting", owner: "carbon" },
    entityType: "customer"
  });

  return { syncer, getCustomer, listCustomers };
}

describe("RilletCustomerSyncer.fetchRemoteBatch", () => {
  it("takes the direct GET for a single id", async () => {
    const test = setupCustomerSyncer([customer()]);

    const result = await (test.syncer as any).fetchRemoteBatch(["ril-cus-1"]);

    expect([...result.keys()]).toEqual(["ril-cus-1"]);
    expect(test.getCustomer).toHaveBeenCalledOnce();
    expect(test.listCustomers).not.toHaveBeenCalled();
  });

  it("drains the list ONCE for a batch and reuses it across calls", async () => {
    // Rillet has no get-many endpoint, so N single GETs is the alternative;
    // one cursor drain costs the same no matter how many ids are asked for.
    const test = setupCustomerSyncer([
      customer({ id: "a" }),
      customer({ id: "b" }),
      customer({ id: "c" })
    ]);

    const first = await (test.syncer as any).fetchRemoteBatch(["a", "b"]);
    const second = await (test.syncer as any).fetchRemoteBatch(["b", "c"]);

    expect([...first.keys()]).toEqual(["a", "b"]);
    expect([...second.keys()]).toEqual(["b", "c"]);
    expect(test.listCustomers).toHaveBeenCalledOnce();
    expect(test.getCustomer).not.toHaveBeenCalled();
  });

  it("omits an id the list does not carry rather than inventing a row", async () => {
    const test = setupCustomerSyncer([customer({ id: "a" })]);

    const result = await (test.syncer as any).fetchRemoteBatch(["a", "gone"]);

    expect([...result.keys()]).toEqual(["a"]);
  });
});

describe("RilletVendorSyncer.fetchRemoteBatch", () => {
  it("drains the vendor list once for a batch", async () => {
    const remote = [vendor({ id: "a" }), vendor({ id: "b" })];
    const getVendor = vi.fn(
      async (id: string) => remote.find((v) => v.id === id) ?? null
    );
    const listVendors = vi.fn(async () => remote);

    const syncer = new RilletVendorSyncer({
      database: {} as never,
      companyId: COMPANY_ID,
      provider: { id: "rillet", getVendor, listVendors } as never,
      config: {
        enabled: true,
        direction: "push-to-accounting",
        owner: "carbon"
      },
      entityType: "vendor"
    });

    expect([
      ...(await (syncer as any).fetchRemoteBatch(["a", "b"])).keys()
    ]).toEqual(["a", "b"]);
    expect(listVendors).toHaveBeenCalledOnce();
    expect(getVendor).not.toHaveBeenCalled();
  });
});

// /********************************************************\
// *                  The match ladder                      *
// \********************************************************/

type Rows = Record<string, Array<Record<string, unknown>>>;

/**
 * Minimal chainable stand-in for the Kysely transaction the syncers use:
 * enough of `selectFrom/select/where/executeTakeFirst` and
 * `insertInto/values/returning/executeTakeFirstOrThrow` to exercise the
 * match ladder without a database. `where(col, "=", value)` filters on
 * equality; `where(col, "is", null)` filters on null, matching the guards
 * in the contact updates.
 */
function makeTx(rows: Rows) {
  let nextId = 0;

  const column = (col: string) => col.split(".").pop() as string;

  const select = (table: string) => {
    const clauses: Array<(row: Record<string, unknown>) => boolean> = [];
    const builder: any = {
      select: () => builder,
      where(col: string, op: string, value: unknown) {
        clauses.push((row) =>
          op === "is" ? row[column(col)] == null : row[column(col)] === value
        );
        return builder;
      },
      async executeTakeFirst() {
        return (rows[table] ?? []).find((row) =>
          clauses.every((clause) => clause(row))
        );
      }
    };
    return builder;
  };

  const insert = (table: string) => {
    let inserted: Record<string, unknown> = {};
    const builder: any = {
      values(value: Record<string, unknown>) {
        nextId += 1;
        inserted = { id: `${table}-${nextId}`, ...value };
        (rows[table] ??= []).push(inserted);
        return builder;
      },
      returning: () => builder,
      onConflict: () => builder,
      async execute() {
        return [];
      },
      async executeTakeFirstOrThrow() {
        return inserted;
      }
    };
    return builder;
  };

  const update = (table: string) => {
    const clauses: Array<(row: Record<string, unknown>) => boolean> = [];
    let patch: Record<string, unknown> = {};
    const builder: any = {
      set(value: Record<string, unknown>) {
        patch = value;
        return builder;
      },
      where(col: string, op: string, value: unknown) {
        clauses.push((row) =>
          op === "is" ? row[column(col)] == null : row[column(col)] === value
        );
        return builder;
      },
      async execute() {
        for (const row of rows[table] ?? []) {
          if (clauses.every((clause) => clause(row))) Object.assign(row, patch);
        }
        return [];
      }
    };
    return builder;
  };

  return {
    rows,
    tx: {
      selectFrom: select,
      insertInto: insert,
      updateTable: update
    } as never
  };
}

function customerSyncerFor(
  mappedLocalId: string | null,
  linkedRemoteIdByLocalId: Record<string, string> = {}
) {
  const syncer = new RilletCustomerSyncer({
    database: {} as never,
    companyId: COMPANY_ID,
    provider: { id: "rillet" } as never,
    config: { enabled: true, direction: "push-to-accounting", owner: "carbon" },
    entityType: "customer"
  });
  (syncer as any).getLocalId = async () => mappedLocalId;
  (syncer as any).getRemoteId = async (localId: string) =>
    linkedRemoteIdByLocalId[localId] ?? null;
  return syncer;
}

describe("RilletCustomerSyncer.upsertLocal match ladder", () => {
  it("prefers the existing mapping row over every other candidate", async () => {
    const syncer = customerSyncerFor("cus-mapped");
    const { tx, rows } = makeTx({
      customer: [
        { id: "cus-mapped", name: "Old Name", companyId: COMPANY_ID },
        { id: "cus-by-name", name: "Acme Manufacturing", companyId: COMPANY_ID }
      ]
    });

    const id = await (syncer as any).upsertLocal(
      tx,
      mapRilletCustomerToLocal(customer(), { companyId: COMPANY_ID }),
      "ril-cus-1"
    );

    expect(id).toBe("cus-mapped");
    expect(rows.customer).toHaveLength(2);
  });

  it("links to the Carbon customer named by the record's carbon reference", async () => {
    const syncer = customerSyncerFor(null);
    const { tx, rows } = makeTx({
      customer: [{ id: "cus-local", name: "Acme", companyId: COMPANY_ID }]
    });

    const id = await (syncer as any).upsertLocal(
      tx,
      mapRilletCustomerToLocal(
        customer({
          external_references: [
            { type: "carbon", id: "cus-local" },
            { type: "carbon-company", id: COMPANY_ID }
          ]
        }),
        { companyId: COMPANY_ID }
      ),
      "ril-cus-1"
    );

    // Matched on the reference even though the NAMES disagree.
    expect(id).toBe("cus-local");
    expect(rows.customer).toHaveLength(1);
  });

  it("falls through to the name when the claimed Carbon id is stale", async () => {
    // A deleted customer, or a reference written by another Carbon instance,
    // must not link the mapping row to an id that does not exist.
    const syncer = customerSyncerFor(null);
    const { tx, rows } = makeTx({
      customer: [
        { id: "cus-real", name: "Acme Manufacturing", companyId: COMPANY_ID }
      ]
    });

    const id = await (syncer as any).upsertLocal(
      tx,
      mapRilletCustomerToLocal(
        customer({
          external_references: [{ type: "carbon", id: "cus-deleted" }]
        }),
        { companyId: COMPANY_ID }
      ),
      "ril-cus-1"
    );

    expect(id).toBe("cus-real");
    expect(rows.customer).toHaveLength(1);
  });

  it("matches a previously-pushed customer by name instead of inserting a duplicate", async () => {
    // customer_name_unique (name, companyId) would reject the insert, failing
    // the whole record — the name match is what makes a re-import survivable.
    const syncer = customerSyncerFor(null);
    const { tx, rows } = makeTx({
      customer: [
        {
          id: "cus-existing",
          name: "Acme Manufacturing",
          companyId: COMPANY_ID
        }
      ]
    });

    const id = await (syncer as any).upsertLocal(
      tx,
      mapRilletCustomerToLocal(customer(), { companyId: COMPANY_ID }),
      "ril-cus-1"
    );

    expect(id).toBe("cus-existing");
    expect(rows.customer).toHaveLength(1);
  });

  it("ignores a same-named customer belonging to ANOTHER company", async () => {
    const syncer = customerSyncerFor(null);
    const { tx, rows } = makeTx({
      customer: [
        {
          id: "cus-other-tenant",
          name: "Acme Manufacturing",
          companyId: "another-company"
        }
      ]
    });

    const id = await (syncer as any).upsertLocal(
      tx,
      mapRilletCustomerToLocal(customer(), { companyId: COMPANY_ID }),
      "ril-cus-1"
    );

    expect(id).not.toBe("cus-other-tenant");
    expect(rows.customer).toHaveLength(2);
    expect(rows.customer?.[1]).toMatchObject({ companyId: COMPANY_ID });
  });

  it("inserts the customer and its contact when nothing matches", async () => {
    const syncer = customerSyncerFor(null);
    const { tx, rows } = makeTx({ customer: [] });

    const id = await (syncer as any).upsertLocal(
      tx,
      mapRilletCustomerToLocal(
        customer({
          emails: [{ email: "ar@acme.example", type: "MAIN_SENDER" }]
        }),
        { companyId: COMPANY_ID }
      ),
      "ril-cus-1"
    );

    expect(rows.customer?.[0]).toMatchObject({
      id,
      name: "Acme Manufacturing",
      companyId: COMPANY_ID
    });
    expect(rows.contact?.[0]).toMatchObject({
      email: "ar@acme.example",
      firstName: "Acme",
      lastName: "Manufacturing",
      isCustomer: true
    });
    expect(rows.customerContact?.[0]).toMatchObject({ customerId: id });
  });

  it("creates no contact at all when Rillet has no email for the customer", async () => {
    const syncer = customerSyncerFor(null);
    const { tx, rows } = makeTx({ customer: [] });

    await (syncer as any).upsertLocal(
      tx,
      mapRilletCustomerToLocal(customer(), { companyId: COMPANY_ID }),
      "ril-cus-1"
    );

    expect(rows.contact).toBeUndefined();
    expect(rows.customerContact).toBeUndefined();
  });

  it("skips the contact rather than failing the link when the email is already taken", async () => {
    // contact_email_companyId_unique (email, companyId, isCustomer) would make
    // a second contact with this email throw, and upsertLocal runs in the same
    // transaction as linkEntities — so failing here would roll back the mapping
    // the whole import exists to write. The customer must still resolve.
    const syncer = customerSyncerFor(null, { "cus-existing": "ril-cus-1" });
    const { tx, rows } = makeTx({
      customer: [
        {
          id: "cus-existing",
          name: "Acme Manufacturing",
          companyId: COMPANY_ID
        }
      ],
      contact: [
        {
          id: "con-other",
          email: "ar@acme.example",
          companyId: COMPANY_ID,
          isCustomer: true
        }
      ]
    });

    const id = await (syncer as any).upsertLocal(
      tx,
      mapRilletCustomerToLocal(
        customer({
          emails: [{ email: "ar@acme.example", type: "MAIN_SENDER" }]
        }),
        { companyId: COMPANY_ID }
      ),
      "ril-cus-1"
    );

    expect(id).toBe("cus-existing");
    expect(rows.contact).toHaveLength(1);
    expect(rows.customerContact).toBeUndefined();
  });

  it("does not fill an existing contact's null email when another contact owns it", async () => {
    // The fill-missing UPDATE would violate the same partial unique index and
    // roll back the mapping, so the collision check gates it too.
    const syncer = customerSyncerFor("cus-linked");
    const { tx, rows } = makeTx({
      customer: [
        { id: "cus-linked", name: "Acme Manufacturing", companyId: COMPANY_ID }
      ],
      customerContact: [
        {
          id: "cc-1",
          customerId: "cus-linked",
          contactId: "con-self",
          companyId: COMPANY_ID
        }
      ],
      contact: [
        {
          id: "con-self",
          email: null,
          companyId: COMPANY_ID,
          isCustomer: true
        },
        {
          id: "con-other",
          email: "ar@acme.example",
          companyId: COMPANY_ID,
          isCustomer: true
        }
      ]
    });

    await (syncer as any).upsertLocal(
      tx,
      mapRilletCustomerToLocal(
        customer({
          emails: [{ email: "ar@acme.example", type: "MAIN_SENDER" }]
        }),
        { companyId: COMPANY_ID }
      ),
      "ril-cus-1"
    );

    expect(rows.contact?.find((c) => c.id === "con-self")?.email).toBeNull();
  });

  it("refuses to steal a Carbon customer already linked to another Rillet customer", async () => {
    // Rillet is not known to enforce unique customer names. Re-pointing the
    // mapping would silently unlink the first Rillet customer, and inserting
    // past the match would violate customer_name_unique with a cryptic error.
    const syncer = customerSyncerFor(null, { "cus-taken": "ril-cus-other" });
    const { tx, rows } = makeTx({
      customer: [
        { id: "cus-taken", name: "Acme Manufacturing", companyId: COMPANY_ID }
      ]
    });

    await expect(
      (syncer as any).upsertLocal(
        tx,
        mapRilletCustomerToLocal(customer(), { companyId: COMPANY_ID }),
        "ril-cus-1"
      )
    ).rejects.toThrow(/already linked to Rillet customer ril-cus-other/);
    expect(rows.customer).toHaveLength(1);
  });

  it("re-links a name match that already points at THIS Rillet customer", async () => {
    const syncer = customerSyncerFor(null, { "cus-existing": "ril-cus-1" });
    const { tx } = makeTx({
      customer: [
        {
          id: "cus-existing",
          name: "Acme Manufacturing",
          companyId: COMPANY_ID
        }
      ]
    });

    await expect(
      (syncer as any).upsertLocal(
        tx,
        mapRilletCustomerToLocal(customer(), { companyId: COMPANY_ID }),
        "ril-cus-1"
      )
    ).resolves.toBe("cus-existing");
  });

  it("refuses a nameless Rillet customer rather than inserting a blank one", async () => {
    const syncer = customerSyncerFor(null);
    const { tx } = makeTx({ customer: [] });

    await expect(
      (syncer as any).upsertLocal(tx, { companyId: COMPANY_ID }, "ril-cus-1")
    ).rejects.toThrow(/ril-cus-1/);
  });
});

describe("RilletVendorSyncer.upsertLocal", () => {
  function vendorSyncerFor(mappedLocalId: string | null) {
    const syncer = new RilletVendorSyncer({
      database: {} as never,
      companyId: COMPANY_ID,
      provider: { id: "rillet" } as never,
      config: {
        enabled: true,
        direction: "push-to-accounting",
        owner: "carbon"
      },
      entityType: "vendor"
    });
    (syncer as any).getLocalId = async () => mappedLocalId;
    (syncer as any).getRemoteId = async () => null;
    return syncer;
  }

  it("matches an existing supplier by name and leaves the row alone", async () => {
    const syncer = vendorSyncerFor(null);
    const { tx, rows } = makeTx({
      supplier: [
        { id: "sup-existing", name: "Bolt Supply Co", companyId: COMPANY_ID }
      ]
    });

    const id = await (syncer as any).upsertLocal(
      tx,
      mapRilletVendorToLocal(vendor(), { companyId: COMPANY_ID }),
      "ril-ven-1"
    );

    expect(id).toBe("sup-existing");
    expect(rows.supplier).toHaveLength(1);
  });

  it("inserts the supplier, its tax id and its contact when nothing matches", async () => {
    const syncer = vendorSyncerFor(null);
    const { tx, rows } = makeTx({ supplier: [] });

    const id = await (syncer as any).upsertLocal(
      tx,
      mapRilletVendorToLocal(
        vendor({ email: "ap@bolt.example", tax_id: "12-3456789" }),
        { companyId: COMPANY_ID }
      ),
      "ril-ven-1"
    );

    expect(rows.supplier?.[0]).toMatchObject({ id, name: "Bolt Supply Co" });
    expect(rows.supplierTax?.[0]).toMatchObject({
      supplierId: id,
      taxId: "12-3456789"
    });
    expect(rows.contact?.[0]).toMatchObject({
      email: "ap@bolt.example",
      isCustomer: false
    });
    expect(rows.supplierContact?.[0]).toMatchObject({ supplierId: id });
  });

  it("skips the contact rather than failing the link when the email is already taken", async () => {
    const syncer = vendorSyncerFor(null);
    const { tx, rows } = makeTx({
      supplier: [
        { id: "sup-existing", name: "Bolt Supply Co", companyId: COMPANY_ID }
      ],
      contact: [
        {
          id: "con-other",
          email: "ap@bolt.example",
          companyId: COMPANY_ID,
          isCustomer: false
        }
      ]
    });

    const id = await (syncer as any).upsertLocal(
      tx,
      mapRilletVendorToLocal(vendor({ email: "ap@bolt.example" }), {
        companyId: COMPANY_ID
      }),
      "ril-ven-1"
    );

    expect(id).toBe("sup-existing");
    expect(rows.contact).toHaveLength(1);
    expect(rows.supplierContact).toBeUndefined();
  });

  it("writes no supplierTax row when Rillet carries no tax id", async () => {
    const syncer = vendorSyncerFor(null);
    const { tx, rows } = makeTx({ supplier: [] });

    await (syncer as any).upsertLocal(
      tx,
      mapRilletVendorToLocal(vendor(), { companyId: COMPANY_ID }),
      "ril-ven-1"
    );

    expect(rows.supplierTax).toBeUndefined();
  });
});
