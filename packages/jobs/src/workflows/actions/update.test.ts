import type { Database } from "@carbon/database";
import {
  type CatalogAction,
  createWorkflowCatalog,
  entityValue,
  primitiveValue
} from "@carbon/workflows";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { runUpdateAction } from "./update";

const COMPANY = "cmp_1";
const OWNER = "usr_owner";

const jobUpdate = createWorkflowCatalog().getAction(
  "job.update"
) as CatalogAction;

type Tables = Record<string, Record<string, unknown>[]>;

/** The narrowest chainable stub that answers what the executor asks:
 * `.select().eq().eq().maybeSingle()` and `.update().eq().eq()`. */
function createClient(tables: Tables, updateError?: { message: string }) {
  const selects: { table: string; filters: Record<string, unknown> }[] = [];
  const updates: {
    table: string;
    values: Record<string, unknown>;
    filters: Record<string, unknown>;
  }[] = [];

  const from = (table: string) => {
    const filters: Record<string, unknown> = {};

    const chain = {
      select: () => chain,
      update: (values: Record<string, unknown>) => {
        updates.push({ table, values, filters });
        return chain;
      },
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        return chain;
      },
      maybeSingle: async () => {
        selects.push({ table, filters });
        const row = (tables[table] ?? []).find((candidate) =>
          Object.entries(filters).every(
            ([column, value]) => candidate[column] === value
          )
        );
        return { data: row ?? null, error: null };
      },
      then: (
        resolve: (result: { error: { message: string } | null }) => void
      ) => resolve({ error: updateError ?? null })
    };

    return chain;
  };

  return {
    client: { from } as unknown as SupabaseClient<Database>,
    selects,
    updates
  };
}

const tables: Tables = {
  job: [{ id: "job_1", companyId: COMPANY }],
  userToCompany: [
    { userId: "usr_here", companyId: COMPANY },
    { userId: "usr_elsewhere", companyId: "cmp_2" }
  ]
};

describe("runUpdateAction", () => {
  it("writes the supplied fields with the owner's audit stamp", async () => {
    const { client, updates } = createClient(tables);

    const outcome = await runUpdateAction({
      client,
      companyId: COMPANY,
      ownerId: OWNER,
      entity: "job",
      action: jobUpdate,
      inputs: {
        job: entityValue("job", "job_1"),
        dueDate: primitiveValue("date", "2026-08-01T00:00:00.000Z"),
        assignee: entityValue("user", "usr_here")
      }
    });

    expect(outcome).toEqual({
      ok: true,
      outputs: { record: { kind: "entity", of: "job", id: "job_1" } },
      summary: "Updated 2 field(s)."
    });

    expect(updates).toHaveLength(1);
    expect(updates[0]?.table).toBe("job");
    expect(updates[0]?.filters).toEqual({ id: "job_1", companyId: COMPANY });
    expect(updates[0]?.values).toMatchObject({
      dueDate: "2026-08-01T00:00:00.000Z",
      assignee: "usr_here",
      updatedBy: OWNER
    });
    expect(typeof updates[0]?.values.updatedAt).toBe("string");
  });

  it("refuses a foreign key that belongs to another company, and writes nothing", async () => {
    const { client, updates } = createClient(tables);

    const outcome = await runUpdateAction({
      client,
      companyId: COMPANY,
      ownerId: OWNER,
      entity: "job",
      action: jobUpdate,
      inputs: {
        job: entityValue("job", "job_1"),
        assignee: entityValue("user", "usr_elsewhere")
      }
    });

    expect(outcome).toEqual({
      ok: false,
      error: "The assignee you chose is not in this company."
    });
    expect(updates).toHaveLength(0);
  });

  it("refuses a value the column's enum does not allow", async () => {
    const { client, updates } = createClient(tables);

    const outcome = await runUpdateAction({
      client,
      companyId: COMPANY,
      ownerId: OWNER,
      entity: "job",
      action: jobUpdate,
      inputs: {
        job: entityValue("job", "job_1"),
        deadlineType: primitiveValue("string", "Whenever")
      }
    });

    expect(outcome).toEqual({
      ok: false,
      error: '"Whenever" is not a valid deadlineType.'
    });
    expect(updates).toHaveLength(0);
  });

  it("refuses a record it cannot read, and writes nothing", async () => {
    const { client, updates } = createClient(tables);

    const outcome = await runUpdateAction({
      client,
      companyId: COMPANY,
      ownerId: OWNER,
      entity: "job",
      action: jobUpdate,
      inputs: {
        job: entityValue("job", "job_missing"),
        assignee: entityValue("user", "usr_here")
      }
    });

    expect(outcome).toEqual({
      ok: false,
      error: "That job could not be read."
    });
    expect(updates).toHaveLength(0);
  });

  it("needs an entity to update, not a null", async () => {
    const { client, updates } = createClient(tables);

    const outcome = await runUpdateAction({
      client,
      companyId: COMPANY,
      ownerId: OWNER,
      entity: "job",
      action: jobUpdate,
      inputs: { job: primitiveValue("null", null) }
    });

    expect(outcome).toEqual({
      ok: false,
      error: "This step needs a record to update."
    });
    expect(updates).toHaveLength(0);
  });

  // The mirror of the case below: `dueDate` accepts null, so resolving to nothing is a
  // real edit — clearing it must still reach the database.
  it("clears a nullable column when its value resolves to nothing", async () => {
    const { client, updates } = createClient(tables);

    const outcome = await runUpdateAction({
      client,
      companyId: COMPANY,
      ownerId: OWNER,
      entity: "job",
      action: jobUpdate,
      inputs: {
        job: entityValue("job", "job_1"),
        dueDate: primitiveValue("null", null)
      }
    });

    expect(outcome).toMatchObject({ ok: true });
    expect(updates[0]?.values).toMatchObject({ dueDate: null });
  });

  // `job.priority` and `job.deadlineType` are NOT NULL but declared optional, so a
  // mapping that resolves to nothing used to write the null through and fail the whole
  // step on a constraint the builder gives no way to see.
  it("leaves a NOT NULL column alone when its value resolves to nothing", async () => {
    const { client, updates } = createClient(tables);

    const outcome = await runUpdateAction({
      client,
      companyId: COMPANY,
      ownerId: OWNER,
      entity: "job",
      action: jobUpdate,
      inputs: {
        job: entityValue("job", "job_1"),
        deadlineType: primitiveValue("null", null),
        dueDate: primitiveValue("date", "2026-08-01T00:00:00.000Z")
      }
    });

    expect(outcome).toMatchObject({ ok: true, summary: "Updated 1 field(s)." });
    expect(updates[0]?.values).not.toHaveProperty("deadlineType");
    expect(updates[0]?.values).toMatchObject({
      dueDate: "2026-08-01T00:00:00.000Z"
    });
  });

  // `customerTypeId` is typed as a plain string, because `customerType` is not a registry
  // entity — so it used to skip the check entirely. Its foreign key references `id` alone,
  // not the composite `(id, companyId)`, so Postgres would have accepted the other
  // company's row.
  it("refuses a string-typed foreign key from another company", async () => {
    const customerUpdate = createWorkflowCatalog().getAction(
      "customer.update"
    ) as CatalogAction;
    const { client, updates } = createClient({
      customer: [{ id: "cus_1", companyId: COMPANY }],
      customerType: [{ id: "ctp_theirs", companyId: "cmp_2" }]
    });

    const outcome = await runUpdateAction({
      client,
      companyId: COMPANY,
      ownerId: OWNER,
      entity: "customer",
      action: customerUpdate,
      inputs: {
        customer: entityValue("customer", "cus_1"),
        customerTypeId: primitiveValue("string", "ctp_theirs")
      }
    });

    expect(outcome).toEqual({
      ok: false,
      error: "The customerTypeId you chose is not in this company."
    });
    expect(updates).toHaveLength(0);
  });

  it("surfaces a write failure as it comes back", async () => {
    const { client } = createClient(tables, { message: "permission denied" });

    const outcome = await runUpdateAction({
      client,
      companyId: COMPANY,
      ownerId: OWNER,
      entity: "job",
      action: jobUpdate,
      inputs: {
        job: entityValue("job", "job_1"),
        deadlineType: primitiveValue("string", "ASAP")
      }
    });

    expect(outcome).toEqual({ ok: false, error: "permission denied" });
  });
});
