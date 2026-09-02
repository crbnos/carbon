import { describe, expect, it } from "vitest";
import type { CatalogIntegration, WorkflowCatalog } from "./catalog";
import { createFixtureCatalog } from "./catalog";
import { fieldNotices } from "./notices";
import { t } from "./types";

const STEP: CatalogIntegration = {
  id: "integration.gmail.send",
  inputs: {
    connectionId: { type: t.string, required: true },
    subject: { type: t.string, required: true },
    text: { type: t.string, required: false, links: { format: "slack" } },
    body: {
      type: t.string,
      required: false,
      links: { format: "html", when: { input: "body_type", equals: ["html"] } }
    }
  },
  advancedInputs: {
    body_type: { type: t.string, required: false, defaultValue: "plain_text" }
  },
  outputs: {},
  batchable: false,
  permission: { module: "workflows", action: "update" },
  piece: { name: "gmail", action: "send" }
};

const catalog: WorkflowCatalog = {
  ...createFixtureCatalog(),
  getIntegration: (id) => (id === STEP.id ? STEP : undefined)
};

const recordTemplate = {
  kind: "template",
  parts: [
    { kind: "text", text: "See " },
    { kind: "ref", nodeId: "trigger", output: "purchaseOrder", path: [] }
  ]
};

const definition = (inputs: Record<string, unknown>, type = "integration") => ({
  nodes: [
    {
      id: "trigger",
      name: "trigger",
      type: "trigger",
      position: { x: 0, y: 0 },
      data: { events: ["purchaseOrder.status.changed"] }
    },
    type === "integration"
      ? {
          id: "step",
          name: "integration_0",
          type: "integration",
          position: { x: 0, y: 0 },
          data: { piece: "gmail", action: "send", inputs }
        }
      : {
          id: "step",
          name: "action_0",
          type: "action",
          position: { x: 0, y: 0 },
          data: { action: "createIssue", inputs }
        }
  ],
  edges: [
    {
      id: "e1",
      source: "trigger",
      sourceHandle: "out",
      target: "step",
      targetHandle: "in"
    }
  ]
});

describe("fieldNotices", () => {
  it("says nothing when no record is in the field", () => {
    expect(
      fieldNotices(
        definition({
          subject: {
            kind: "template",
            parts: [{ kind: "text", text: "plain words" }]
          }
        }),
        catalog
      )
    ).toEqual([]);
  });

  it("flags a record in a field with no link support", () => {
    expect(
      fieldNotices(definition({ subject: recordTemplate }), catalog)
    ).toEqual([
      { code: "LINKS_UNSUPPORTED", nodeId: "step", field: "inputs.subject" }
    ]);
  });

  it("names the fix while the gate sibling holds its default", () => {
    expect(fieldNotices(definition({ body: recordTemplate }), catalog)).toEqual(
      [
        {
          code: "LINKS_CONDITIONAL",
          nodeId: "step",
          field: "inputs.body",
          params: { input: "body_type", equals: "html" }
        }
      ]
    );
  });

  it("says nothing once the gate sibling is set right", () => {
    expect(
      fieldNotices(
        definition({
          body: recordTemplate,
          body_type: { kind: "literal", type: t.string, value: "html" }
        }),
        catalog
      )
    ).toEqual([]);
  });

  it("says nothing for an always-linked field", () => {
    expect(fieldNotices(definition({ text: recordTemplate }), catalog)).toEqual(
      []
    );
  });

  it("ignores non-integration nodes entirely", () => {
    expect(
      fieldNotices(definition({ title: recordTemplate }, "action"), catalog)
    ).toEqual([]);
  });
});
