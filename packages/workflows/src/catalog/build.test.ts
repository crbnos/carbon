import swaggerDocsSchema from "@carbon/database/swagger-docs-schema";
import { describe, expect, it } from "vitest";
import { WORKFLOW_ACTIONS } from "./actions";
import type {
  MomentDeclarationLike,
  RegistryEntry,
  SwaggerSchema
} from "./build";
import { buildCatalog, validateCatalogInputs } from "./build";
import { REGISTRY_ENTRIES, WORKFLOW_ENTITY_REGISTRY } from "./entities";
import { WORKFLOW_MOMENTS } from "./moments";
import { WORKFLOW_OPERATIONS } from "./operations";

const text = { format: "text", type: "string" };

/** Indexed reads are `| undefined` under noUncheckedIndexedAccess. */
function need<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`missing ${what}`);
  return value;
}

const schema: SwaggerSchema = {
  definitions: {
    order: {
      properties: {
        id: text,
        status: { enum: ["Draft", "Sent"], type: "string" },
        supplierId: text,
        buyerId: {
          type: "string",
          format: "text",
          description: "<fk table='person' column='id'/>"
        },
        vendorId: {
          type: "string",
          format: "text",
          description: "<fk table='vendorTable' column='id'/>"
        },
        orderDate: { format: "date", type: "string" },
        createdAt: { format: "timestamp with time zone", type: "string" },
        total: { format: "numeric", type: "number" },
        revision: { format: "integer", type: "integer" },
        approved: { format: "boolean", type: "boolean" },
        tags: { format: "text[]", type: "array", items: { type: "string" } },
        config: { format: "jsonb" },
        companyId: text,
        customFields: { format: "jsonb" },
        updatedAt: { format: "timestamp with time zone", type: "string" },
        updatedBy: text,
        embedding: text
      }
    },
    person: { properties: { id: text, email: text } },
    vendorTable: { properties: { id: text, name: text } }
  }
};

const registry: Record<string, RegistryEntry> = {
  order: {
    table: "order",
    label: "Order",
    permission: "purchasing",
    watch: {
      status: { label: "status" },
      supplierId: { label: "supplier", ref: "person" },
      buyerId: { label: "buyer" }
    }
  },
  person: { table: "person", label: "Person", permission: "users" }
};

const moments: Record<string, MomentDeclarationLike> = {
  "order.approved": {
    label: "An order is approved",
    permission: "purchasing",
    outputs: {
      order: { kind: "entity", of: "order" },
      approvedBy: { kind: "entity", of: "person" }
    }
  }
};

/** Every registry table stubbed, so these tests never import `@carbon/database` as a value. */
function realDefinitions(): SwaggerSchema["definitions"] {
  const definitions: SwaggerSchema["definitions"] = {};
  for (const entry of Object.values(REGISTRY_ENTRIES)) {
    const properties: Record<string, typeof text> = { id: text };
    for (const column of [
      ...Object.keys(entry.watch ?? {}),
      ...Object.keys(entry.write ?? {})
    ]) {
      properties[column] = text;
    }
    definitions[entry.table] = { properties };
  }
  return definitions;
}

describe("buildCatalog — record events", () => {
  const built = buildCatalog(registry, moments, {}, {}, schema);
  const ev = (id: string) => need(built.events[id], id);

  it("emits created, deleted and one changed event per watched column", () => {
    const ids = Object.keys(built.events).filter((id) =>
      id.startsWith("order.")
    );
    expect(ids).toEqual(
      expect.arrayContaining([
        "order.created",
        "order.deleted",
        "order.status.changed",
        "order.supplierId.changed",
        "order.buyerId.changed"
      ])
    );
    // 3 watched columns => 5 record events, plus the moment keyed "order.approved".
    expect(ids).toHaveLength(6);
  });

  it("emits no generic updated event", () => {
    expect(built.events["order.updated"]).toBeUndefined();
  });

  it("emits no events for a reference-only entity", () => {
    expect(
      Object.keys(built.events).some((id) => id.startsWith("person."))
    ).toBe(false);
  });

  it("carries the INSERT, DELETE and UPDATE match shapes", () => {
    expect(ev("order.created").match).toEqual({
      table: "order",
      operation: "INSERT"
    });
    expect(ev("order.deleted").match).toEqual({
      table: "order",
      operation: "DELETE"
    });
    expect(ev("order.status.changed").match).toEqual({
      table: "order",
      operation: "UPDATE",
      field: "status"
    });
  });

  it("hands out record, before and after on a changed event", () => {
    expect(ev("order.status.changed").outputs).toEqual({
      record: { kind: "entity", of: "order" },
      before: { kind: "entity", of: "order" },
      after: { kind: "entity", of: "order" }
    });
  });

  it("hands out only record on created and deleted", () => {
    expect(ev("order.created").outputs).toEqual({
      record: { kind: "entity", of: "order" }
    });
    expect(ev("order.deleted").outputs).toEqual({
      record: { kind: "entity", of: "order" }
    });
  });

  it("carries the entity's permission on every event", () => {
    expect(ev("order.created").permission).toBe("purchasing");
  });
});

describe("buildCatalog — labels", () => {
  const built = buildCatalog(registry, moments, {}, {}, schema);

  it("uses the three templates", () => {
    expect(built.labels["order.created"]).toBe("An order is created");
    expect(built.labels["order.deleted"]).toBe("An order is deleted");
    expect(built.labels["order.status.changed"]).toBe(
      "An order's status changes"
    );
  });

  it("lets a registry entry override the article the vowel test gets wrong", () => {
    const built2 = buildCatalog(
      {
        user: {
          table: "person",
          label: "User",
          article: "A",
          permission: "users",
          watch: { email: { label: "email" } }
        }
      },
      {},
      {},
      {},
      schema
    );
    expect(built2.labels["user.created"]).toBe("A user is created");
  });

  it("picks the article from the entity label", () => {
    const built2 = buildCatalog(
      {
        quote: {
          table: "order",
          label: "Quote",
          permission: "sales",
          watch: { status: { label: "status" } }
        }
      },
      {},
      {},
      {},
      schema
    );
    expect(built2.labels["quote.created"]).toBe("A quote is created");
  });

  it("uses the column's own label, not its column name", () => {
    expect(built.labels["order.supplierId.changed"]).toBe(
      "An order's supplier changes"
    );
  });

  it("passes a moment's hand-written label through unchanged", () => {
    expect(built.labels["order.approved"]).toBe("An order is approved");
  });

  it("emits a label for every event", () => {
    for (const id of Object.keys(built.events)) {
      expect(built.labels[id]).toBeDefined();
    }
  });

  it("emits an entity label for each registry entity", () => {
    expect(built.labels["entity.order"]).toBe("Order");
    expect(built.labels["entity.person"]).toBe("Person");
  });

  it("sentence-cases a hand-written column label", () => {
    // supplierId is in `watch` with label "supplier"
    expect(built.labels["entity.order.supplierId"]).toBe("Supplier");
    expect(built.labels["entity.order.status"]).toBe("Status");
  });

  it("humanizes an uncurated column", () => {
    // vendorId is not in watch or write
    expect(built.labels["entity.order.vendorId"]).toBe("Vendor");
    // orderDate is not in watch or write
    expect(built.labels["entity.order.orderDate"]).toBe("Order date");
  });

  it("throws when a column label contains a backtick", () => {
    expect(() =>
      buildCatalog(
        {
          order: {
            table: "order",
            label: "Order",
            permission: "purchasing",
            watch: { status: { label: "`template`" } }
          }
        },
        {},
        {},
        {},
        schema
      )
    ).toThrow(/contains a backtick/);
  });
});

describe("buildCatalog — moments", () => {
  const built = buildCatalog(registry, moments, {}, {}, schema);

  it("passes declared outputs through unchanged and matches on the key", () => {
    expect(built.events["order.approved"]).toEqual({
      outputs: {
        order: { kind: "entity", of: "order" },
        approvedBy: { kind: "entity", of: "person" }
      },
      permission: "purchasing",
      match: { moment: "order.approved" }
    });
  });

  it("throws when an output names an entity outside the registry", () => {
    expect(() =>
      buildCatalog(
        registry,
        {
          "order.shipped": {
            label: "An order is shipped",
            permission: "inventory",
            outputs: { carrier: { kind: "entity", of: "carrier" } }
          }
        },
        {},
        {},
        schema
      )
    ).toThrow(/names entity "carrier"/);
  });

  it("throws when a label is blank", () => {
    expect(() =>
      buildCatalog(
        registry,
        {
          "order.shipped": {
            label: "   ",
            permission: "inventory",
            outputs: {}
          }
        },
        {},
        {},
        schema
      )
    ).toThrow(/has no label/);
  });
});

describe("buildCatalog — entity properties", () => {
  const built = buildCatalog(registry, moments, {}, {}, schema);
  const order = need(built.entities.order, "order entity");
  const person = need(built.entities.person, "person entity");

  it("drops tenancy, extensibility and audit columns", () => {
    expect(order.companyId).toBeUndefined();
    expect(order.customFields).toBeUndefined();
    expect(order.updatedAt).toBeUndefined();
    expect(order.updatedBy).toBeUndefined();
    expect(order.embedding).toBeUndefined();
  });

  it("keeps every other column, including unwatched ones", () => {
    expect(order.id).toEqual({ kind: "primitive", of: "string" });
    expect(order.total).toEqual({ kind: "primitive", of: "number" });
    expect(order.revision).toEqual({ kind: "primitive", of: "number" });
    expect(order.approved).toEqual({ kind: "primitive", of: "boolean" });
  });

  it("maps date and timestamp formats to date", () => {
    expect(order.orderDate).toEqual({ kind: "primitive", of: "date" });
    expect(order.createdAt).toEqual({ kind: "primitive", of: "date" });
  });

  it("maps an array column to a list of its item type", () => {
    expect(order.tags).toEqual({
      kind: "list",
      of: { kind: "primitive", of: "string" }
    });
  });

  it("maps an opaque json column to string", () => {
    expect(order.config).toEqual({ kind: "primitive", of: "string" });
  });

  it("turns a foreign key into an entity ref when the target is in the registry", () => {
    expect(order.buyerId).toEqual({ kind: "entity", of: "person" });
  });

  it("leaves a foreign key to a non-registry table as a plain string", () => {
    expect(order.vendorId).toEqual({ kind: "primitive", of: "string" });
  });

  it("honors an explicit ref where the schema carries no foreign key note", () => {
    expect(order.supplierId).toEqual({ kind: "entity", of: "person" });
  });

  it("generates properties for reference-only entities too", () => {
    expect(person.email).toEqual({ kind: "primitive", of: "string" });
  });

  it("throws when a declared ref disagrees with the schema's foreign key", () => {
    expect(() =>
      buildCatalog(
        {
          ...registry,
          order: {
            table: "order",
            label: "Order",
            permission: "purchasing",
            watch: { buyerId: { label: "buyer", ref: "order" } }
          }
        },
        {},
        {},
        {},
        schema
      )
    ).toThrow(/foreign key points at "person"/);
  });

  it("throws when a declared ref is not a registry entity", () => {
    expect(() =>
      buildCatalog(
        {
          ...registry,
          order: {
            table: "order",
            label: "Order",
            permission: "purchasing",
            watch: { status: { label: "status", ref: "ghost" } }
          }
        },
        {},
        {},
        {},
        schema
      )
    ).toThrow(/not a registry entity/);
  });

  it("throws when a watched column does not exist on the table", () => {
    expect(() =>
      buildCatalog(
        {
          order: {
            table: "order",
            label: "Order",
            permission: "purchasing",
            watch: { ghostColumn: { label: "ghost" } }
          }
        },
        {},
        {},
        {},
        schema
      )
    ).toThrow(/watches column "ghostColumn"/);
  });

  it("throws when an entity names a table outside the schema", () => {
    expect(() =>
      buildCatalog(
        { ghost: { table: "ghostTable", label: "Ghost", permission: "sales" } },
        {},
        {},
        {},
        schema
      )
    ).toThrow(/not in the database schema/);
  });

  it("collects enum values for a column that declares them", () => {
    expect(built.enums.order?.status).toEqual(["Draft", "Sent"]);
  });

  it("does not collect enums for non-enum columns", () => {
    expect(built.enums.order?.total).toBeUndefined();
    expect(built.enums.order?.revision).toBeUndefined();
  });
});

describe("validateCatalogInputs", () => {
  it("collects every problem instead of stopping at the first", () => {
    const problems = validateCatalogInputs(
      {
        order: {
          table: "order",
          label: "Order",
          permission: "purchasing",
          watch: {
            ghostOne: { label: "one" },
            ghostTwo: { label: "two" },
            updatedAt: { label: "updated" }
          }
        }
      },
      {
        "order.x": {
          label: "",
          permission: "sales",
          outputs: { who: { kind: "entity", of: "nobody" } }
        }
      },
      {},
      {},
      schema
    );
    expect(problems).toHaveLength(5);
    expect(problems.join("\n")).toMatch(/ghostOne/);
    expect(problems.join("\n")).toMatch(/ghostTwo/);
    expect(problems.join("\n")).toMatch(/has no label/);
    expect(problems.join("\n")).toMatch(/names entity "nobody"/);
  });

  it("returns nothing for the real hand-written inputs", () => {
    expect(
      validateCatalogInputs(
        WORKFLOW_ENTITY_REGISTRY,
        WORKFLOW_MOMENTS,
        WORKFLOW_ACTIONS,
        WORKFLOW_OPERATIONS,
        { definitions: realDefinitions() }
      )
    ).toEqual([]);
  });

  it("rejects a writable column that does not exist on the table", () => {
    const problems = validateCatalogInputs(
      {
        order: {
          table: "order",
          label: "Order",
          permission: "purchasing",
          write: { ghostWrite: { label: "ghost" } }
        }
      },
      {},
      {},
      {},
      schema
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(
      /declares writable column "ghostWrite", which does not exist/
    );
  });

  it("rejects a writable column a workflow may never set", () => {
    const problems = validateCatalogInputs(
      {
        order: {
          table: "order",
          label: "Order",
          permission: "purchasing",
          write: { companyId: { label: "company" } }
        }
      },
      {},
      {},
      {},
      schema
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/which a workflow may never set/);
  });

  it("rejects a writable ref that disagrees with the schema's foreign key", () => {
    const problems = validateCatalogInputs(
      {
        order: {
          table: "order",
          label: "Order",
          permission: "purchasing",
          write: { buyerId: { label: "buyer", ref: "order" } }
        },
        person: { table: "person", label: "Person", permission: "users" }
      },
      {},
      {},
      {},
      schema
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/its foreign key points at "person"/);
  });

  it("rejects watching a column that is dropped from every property map", () => {
    expect(() =>
      buildCatalog(
        {
          order: {
            table: "order",
            label: "Order",
            permission: "purchasing",
            watch: { updatedBy: { label: "updated by" } }
          }
        },
        {},
        {},
        {},
        schema
      )
    ).toThrow(/dropped from every entity's properties/);
  });

  it("rejects a template input typed as a non-string", () => {
    const problems = validateCatalogInputs(
      registry,
      {},
      {
        "order.archive": {
          label: "Archive an order",
          permission: { module: "purchasing", action: "update" },
          call: "purchasing_archiveOrder",
          inputs: {
            score: {
              type: { kind: "primitive", of: "number" },
              required: false,
              label: "score",
              template: true
            }
          },
          outputs: {},
          batchable: false
        }
      },
      {},
      schema
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/is a template but is not a string/);
  });

  const gated = (
    showWhen: { input: string; equals: readonly string[] },
    methodChoices?: readonly string[]
  ) =>
    validateCatalogInputs(
      registry,
      {},
      {
        "order.archive": {
          label: "Archive an order",
          permission: { module: "purchasing", action: "update" },
          call: "purchasing_archiveOrder",
          inputs: {
            method: {
              type: { kind: "primitive", of: "string" },
              required: false,
              label: "method",
              ...(methodChoices ? { choices: methodChoices } : {})
            },
            body: {
              type: { kind: "primitive", of: "string" },
              required: false,
              label: "body",
              showWhen
            }
          },
          outputs: {},
          batchable: false
        }
      },
      {},
      schema
    );

  it("rejects a showWhen naming an input the action does not have", () => {
    const problems = gated({ input: "verb", equals: ["POST"] }, ["POST"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/not an input of "order.archive"/);
  });

  it("rejects a showWhen against an input with no fixed set of values", () => {
    const problems = gated({ input: "method", equals: ["POST"] });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/has no fixed set of values/);
  });

  it("rejects a showWhen expecting a value the gating input cannot hold", () => {
    const problems = gated({ input: "method", equals: ["TRACE"] }, ["POST"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/which is not one of its values/);
  });

  it("accepts a well-formed showWhen", () => {
    expect(
      gated({ input: "method", equals: ["POST"] }, ["POST", "GET"])
    ).toEqual([]);
  });
});

describe("buildCatalog — the real hand-written inputs", () => {
  const built = buildCatalog(
    WORKFLOW_ENTITY_REGISTRY,
    WORKFLOW_MOMENTS,
    WORKFLOW_ACTIONS,
    WORKFLOW_OPERATIONS,
    { definitions: realDefinitions() }
  );

  it("accepts the real registry, moments, actions and operations", () => {
    expect(Object.keys(WORKFLOW_MOMENTS)).toHaveLength(9);
    // 77 watched columns + 10 created + 10 deleted + 9 moments.
    expect(Object.keys(built.events)).toHaveLength(106);
    expect(Object.keys(built.entities)).toHaveLength(17);
    // 10 generated `<entity>.update` plus the 6 hand-written.
    expect(Object.keys(built.actions)).toHaveLength(16);
    expect(Object.keys(built.operations)).toHaveLength(15);
    // 106 events + 16 actions + 15 operations + 17 entity labels + 95 column labels
    // + 27 action input labels + 15 operation input labels
    // + 44 generated update-action input labels (10 record inputs + 34 writable columns)
    expect(Object.keys(built.labels)).toHaveLength(335);
  });

  it("sets template: true on inputs marked as templates", () => {
    expect(built.actions.notify?.inputs.subject?.template).toBe(true);
    expect(built.actions.notify?.inputs.message?.template).toBe(true);
    expect(built.actions.webhook?.inputs.body?.template).toBe(true);
  });

  it("does not set template on non-template inputs", () => {
    expect(built.actions.webhook?.inputs.url?.template).toBeUndefined();
    expect(built.actions.notify?.inputs.user?.template).toBeUndefined();
  });

  it("emits action input labels", () => {
    expect(built.labels["action.notify.input.subject"]).toBe("Subject");
    expect(built.labels["action.webhook.input.url"]).toBe("URL");
    expect(built.labels["action.job.create.input.dueDate"]).toBe("Due date");
  });

  it("emits operation input labels", () => {
    expect(
      built.labels["operation.purchaseOrder.total.input.purchaseOrder"]
    ).toBe("Record");
    expect(built.labels["operation.job.scrapPercentage.input.job"]).toBe(
      "Record"
    );
  });
});

describe("buildCatalog — enums from real schema", () => {
  const built = buildCatalog(
    WORKFLOW_ENTITY_REGISTRY,
    WORKFLOW_MOMENTS,
    WORKFLOW_ACTIONS,
    WORKFLOW_OPERATIONS,
    swaggerDocsSchema as SwaggerSchema
  );

  it("populates deadlineType enum values for job entity", () => {
    expect(built.enums.job?.deadlineType).toEqual([
      "No Deadline",
      "ASAP",
      "Soft Deadline",
      "Hard Deadline"
    ]);
  });

  it("does not populate enums for numeric columns", () => {
    // priority is a number column (double precision), not an enum
    expect(built.enums.job?.priority).toBeUndefined();
  });
});

describe("buildCatalog — actions and operations", () => {
  const writeRegistry: Record<string, RegistryEntry> = {
    ...registry,
    order: {
      ...need(registry.order, "order"),
      write: {
        status: { label: "status" },
        orderDate: { label: "order date" },
        buyerId: { label: "buyer" }
      }
    }
  };

  it("expands a write allowlist into one update action", () => {
    const built = buildCatalog(writeRegistry, {}, {}, {}, schema);
    const action = need(built.actions["order.update"], "order.update");

    expect(Object.keys(action.inputs).sort()).toEqual([
      "buyerId",
      "order",
      "orderDate",
      "status"
    ]);
    expect(action.inputs.order?.required).toBe(true);
    expect(action.inputs.status?.required).toBe(false);
    expect(action.inputs.buyerId?.type).toEqual({
      kind: "entity",
      of: "person"
    });
    expect(action.update).toEqual({ entity: "order" });
    expect(action.permission).toEqual({
      module: "purchasing",
      action: "update"
    });
    expect(built.labels["order.update"]).toBe("Update an order");
  });

  it("generates no update action for an entity with no write allowlist", () => {
    const built = buildCatalog(registry, {}, {}, {}, schema);
    expect(built.actions["order.update"]).toBeUndefined();
  });

  it("carries a hand-written choices, pairs and showWhen into the built action", () => {
    const built = buildCatalog(
      registry,
      {},
      {
        "order.archive": {
          label: "Archive an order",
          permission: { module: "purchasing", action: "update" },
          call: "purchasing_archiveOrder",
          inputs: {
            method: {
              type: { kind: "primitive", of: "string" },
              required: false,
              label: "method",
              choices: ["GET", "POST"]
            },
            headers: {
              type: { kind: "primitive", of: "string" },
              required: false,
              label: "headers",
              pairs: true
            },
            body: {
              type: { kind: "primitive", of: "string" },
              required: false,
              label: "body",
              showWhen: { input: "method", equals: ["POST"] }
            }
          },
          outputs: {},
          batchable: false
        }
      },
      {},
      schema
    );
    const inputs = built.actions["order.archive"]?.inputs;
    expect(inputs?.method?.choices).toEqual(["GET", "POST"]);
    expect(inputs?.headers?.pairs).toBe(true);
    expect(inputs?.body?.showWhen).toEqual({
      input: "method",
      equals: ["POST"]
    });
  });

  it("throws when a hand-written action collides with a generated one", () => {
    expect(() =>
      buildCatalog(
        writeRegistry,
        {},
        {
          "order.update": {
            label: "Update an order by hand",
            permission: { module: "purchasing", action: "update" },
            inputs: {},
            outputs: {},
            batchable: false,
            call: "purchasing_upsertPurchaseOrder"
          }
        },
        {},
        schema
      )
    ).toThrow(/declared by hand and also generated/);
  });

  it("reports a hand-written action with no implementation route", () => {
    const problems = validateCatalogInputs(
      registry,
      {},
      {
        "order.archive": {
          label: "Archive an order",
          permission: { module: "purchasing", action: "update" },
          inputs: {},
          outputs: {},
          batchable: false
        }
      },
      {},
      schema
    );
    expect(problems).toEqual([
      'Action "order.archive" has no implementation route.'
    ]);
  });

  it("reports an operation naming an entity outside the registry", () => {
    const problems = validateCatalogInputs(
      registry,
      {},
      {},
      {
        "carrier.total": {
          label: "Total",
          entity: "carrier",
          permission: { module: "sales", action: "view" },
          inputs: {},
          output: { kind: "primitive", of: "number" }
        }
      },
      schema
    );
    expect(problems).toEqual([
      'Operation "carrier.total" names entity "carrier", which is not in the registry.'
    ]);
  });
});
