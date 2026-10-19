// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

// The service's imports reach the glossary, whose `msg` macro only runs compiled.
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray) => ({ id: strings.join("") })
}));
vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() })
}));
// The plan lookup: this company's plan has no workflows.
vi.mock("@carbon/ee/plan.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@carbon/ee/plan.server")>()),
  companyHasFeature: vi.fn(async () => false)
}));

import type { ModulePermissions } from "@carbon/api/permissions";
import { insertModelUpload } from "../app/modules/items/items.server";
import {
  type Actor,
  createServiceContext
} from "@carbon/api/service-fn.server";
import {
  createJiraIssue,
  importCsvFile
} from "../app/modules/shared/shared.server";
import { createWorkflow } from "../app/modules/workflows/workflows.server";

const grants = (...entries: [module: string, action: string][]) => {
  const permissions: ModulePermissions = {};
  for (const [module, action] of entries) {
    permissions[module] ??= { view: [], create: [], update: [], delete: [] };
    permissions[module][action as "view"] = ["company-1"];
  }
  return permissions;
};

const user = (permissions: ModulePermissions): Actor => ({
  type: "user",
  userId: "user-1",
  permissions
});

// Each of these refuses before it reads or writes anything: a handle that is
// touched fails the test.
const untouched = new Proxy(
  {},
  {
    get(_, key) {
      throw new Error(`Nothing should be read or written (${String(key)})`);
    }
  }
);

function contextFor(actor: Actor) {
  return createServiceContext({
    actor,
    company: { id: "company-1", groupId: "group-1" },
    caller: untouched as never,
    system: () => untouched as never,
    pg: () => untouched as never,
    kv: () => untouched as never
  });
}

describe("uploading a model", () => {
  const upload = {
    modelId: "model-1",
    name: "bracket.step",
    size: 1024
  };
  const ctx = contextFor(user(grants(["parts", "create"], ["parts", "update"])));

  it("refuses a path under another company's prefix", async () => {
    const result = await insertModelUpload(ctx, {
      ...upload,
      path: "company-2/models/model-1.step"
    });
    expect(result.error).toMatchObject({
      category: "validation",
      message: "Invalid model path"
    });
  });

  it("refuses a path that climbs out of the company's prefix", async () => {
    const result = await insertModelUpload(ctx, {
      ...upload,
      path: "company-1/../company-2/models/model-1.step"
    });
    expect(result.error).toMatchObject({ category: "validation" });
  });
});

describe("importing a CSV file", () => {
  const stockImport = {
    table: "inventoryQuantity" as const,
    filePath: "company-1/imports/stock.csv",
    columnMappings: {}
  };

  it("needs create as well as update on inventory to post stock", async () => {
    const result = await importCsvFile(
      contextFor(user(grants(["inventory", "update"]))),
      stockImport
    );
    expect(result.error).toMatchObject({ category: "forbidden" });
  });

  it("needs the table's own module", async () => {
    const result = await importCsvFile(
      contextFor(user(grants(["sales", "update"]))),
      { ...stockImport, table: "part" }
    );
    expect(result.error).toMatchObject({ category: "forbidden" });
  });

  it("refuses a file whose required fields are not mapped", async () => {
    // The mapping form posts an unmapped field as an empty choice.
    const result = await importCsvFile(
      contextFor(user(grants(["parts", "update"]))),
      {
        ...stockImport,
        table: "part",
        columnMappings: { id: "", readableId: "Part Number", name: "Name" }
      }
    );
    expect(result.error?.category).toBe("validation");
    expect(result.error?.message).toContain("ID is required");
  });
});

describe("creating a Jira issue for an action task", () => {
  const task = {
    actionId: "task-1",
    projectKey: "ENG",
    issueTypeId: "10001",
    title: "Replace the bracket"
  };

  it("needs parts, not quality, for a change notice's task", async () => {
    const result = await createJiraIssue(
      contextFor(user(grants(["quality", "update"]))),
      { ...task, entityType: "changeOrderActionTask" }
    );
    expect(result.error).toMatchObject({ category: "forbidden" });
  });

  it("needs quality, not parts, for an issue's task", async () => {
    const result = await createJiraIssue(
      contextFor(user(grants(["parts", "update"]))),
      { ...task, entityType: "nonConformanceActionTask" }
    );
    expect(result.error).toMatchObject({ category: "forbidden" });
  });
});

describe("creating a workflow", () => {
  it("is refused when the company's plan has no workflows", async () => {
    // companyHasFeature is the plan lookup; the caller's client is all it
    // receives, so the context needs one it can be handed.
    const ctx = createServiceContext({
      actor: user(grants(["workflows", "create"])),
      company: { id: "company-1", groupId: "group-1" },
      caller: {} as never,
      system: () => untouched as never,
      pg: () => untouched as never,
      kv: () => untouched as never
    });
    const result = await createWorkflow(ctx, { name: "Notify on release" });
    expect(result.error).toMatchObject({ category: "entitlement" });
  });
});
