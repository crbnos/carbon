// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyHubMutation,
  parseItemKeys,
  parseJsonObject,
  parsePlacement,
  parsePriorityWrites,
  priorityFieldValues,
  questionChange,
  refusalFor,
  rowSource,
  rowTouchedBy
} from "./apply-mutation";
import type { StateAction } from "./models";

const customer = { isInternal: false, source: "customer" as const };
const staff = { isInternal: true, source: "staff" as const };
const agent = { isInternal: false, source: "mcp" as const };

const objective = (ownedByActor: boolean) => ({
  collection: "objective",
  ownedByActor
});

describe("refusalFor", () => {
  it("lets a customer tick and finish their hub", () => {
    const actions: StateAction[] = [
      {
        intent: "setCheck",
        itemKey: "task:kickoff",
        kind: "task",
        value: "done"
      },
      { intent: "setChecks", itemKeys: "[]", kind: "scopeFlag", value: "1" },
      { intent: "setStatus", status: "complete" }
    ];
    for (const action of actions) {
      expect(refusalFor(customer, action), action.intent).toBeNull();
    }
  });

  it("keeps tailoring for Carbon staff", () => {
    const actions: StateAction[] = [
      { intent: "setField", fieldKey: "scope.goal", value: "x" },
      { intent: "clearField", fieldKey: "scope.goal" },
      { intent: "addRow", collection: "requirement", payload: "{}" },
      { intent: "addRow", collection: "customization", payload: "{}" },
      { intent: "setTier", tier: "guided" },
      { intent: "setExclusions", exclusions: "{}" },
      { intent: "setContacts", contacts: "{}" },
      { intent: "verifyGate", gateKey: "gate:configure", itemKeys: "[]" },
      { intent: "unverifyGate", gateKey: "gate:configure", itemKeys: "[]" },
      { intent: "applyHandover" },
      { intent: "setMemberPage", page: "{}" },
      { intent: "deleteMemberPage", userId: "user_1" }
    ];
    for (const action of actions) {
      expect(refusalFor(customer, action), action.intent).not.toBeNull();
      expect(refusalFor(staff, action), action.intent).toBeNull();
    }
  });

  it("applies the customer rules to an agent acting for a customer", () => {
    expect(
      refusalFor(agent, { intent: "setTier", tier: "enterprise" })
    ).not.toBeNull();
  });

  it("lets a customer add an objective", () => {
    expect(
      refusalFor(customer, {
        intent: "addRow",
        collection: "objective",
        payload: "{}"
      })
    ).toBeNull();
  });

  it("lets a customer change and delete only their own objectives", () => {
    const update: StateAction = {
      intent: "updateRow",
      rowId: "r",
      payload: "{}"
    };
    const remove: StateAction = { intent: "deleteRow", rowId: "r" };
    const reassign: StateAction = {
      intent: "setAssignee",
      itemKey: "row:r",
      assigneeId: "u2"
    };
    for (const action of [update, remove, reassign]) {
      expect(
        refusalFor(customer, action, objective(true)),
        action.intent
      ).toBeNull();
      expect(
        refusalFor(customer, action, objective(false)),
        action.intent
      ).not.toBeNull();
      expect(
        refusalFor(staff, action, objective(false)),
        action.intent
      ).toBeNull();
    }
  });

  it("lets a customer answer a question in one step, not a customization", () => {
    const answer: StateAction = {
      intent: "answerQuestion",
      rowId: "q",
      selected: '["A"]'
    };
    expect(
      refusalFor(customer, answer, {
        collection: "question",
        ownedByActor: false
      })
    ).toBeNull();
    expect(
      refusalFor(customer, answer, {
        collection: "customization",
        ownedByActor: false
      })
    ).not.toBeNull();
    expect(rowTouchedBy(answer)).toBe("q");
  });

  it("keeps customization rows read-only for a customer", () => {
    const row = { collection: "customization", ownedByActor: true };
    expect(
      refusalFor(
        customer,
        { intent: "updateRow", rowId: "r", payload: "{}" },
        row
      )
    ).not.toBeNull();
    expect(
      refusalFor(
        customer,
        { intent: "setAssignee", itemKey: "row:r", assigneeId: "u" },
        row
      )
    ).not.toBeNull();
  });

  it("lets a customer update a requirement's status but not delete it", () => {
    const row = { collection: "requirement", ownedByActor: false };
    expect(
      refusalFor(
        customer,
        { intent: "updateRow", rowId: "r", payload: "{}" },
        row
      )
    ).toBeNull();
    expect(
      refusalFor(customer, { intent: "deleteRow", rowId: "r" }, row)
    ).not.toBeNull();
  });

  it("lets a customer answer and assign an open question, not add or delete one", () => {
    const row = { collection: "question", ownedByActor: false };
    expect(
      refusalFor(
        customer,
        { intent: "updateRow", rowId: "q", payload: "{}" },
        row
      )
    ).toBeNull();
    expect(
      refusalFor(
        customer,
        { intent: "setAssignee", itemKey: "row:q", assigneeId: "u" },
        row
      )
    ).toBeNull();
    expect(
      refusalFor(customer, {
        intent: "addRow",
        collection: "question",
        payload: "{}"
      })
    ).not.toBeNull();
    expect(
      refusalFor(customer, { intent: "deleteRow", rowId: "q" }, row)
    ).not.toBeNull();
  });

  it("lets anyone assign a template task", () => {
    expect(
      refusalFor(customer, {
        intent: "setAssignee",
        itemKey: "task:kickoff",
        assigneeId: "u"
      })
    ).toBeNull();
  });
});

describe("rowTouchedBy", () => {
  it("names the row a mutation reads facts about", () => {
    expect(
      rowTouchedBy({ intent: "updateRow", rowId: "a", payload: "{}" })
    ).toBe("a");
    expect(rowTouchedBy({ intent: "deleteRow", rowId: "b" })).toBe("b");
    expect(
      rowTouchedBy({ intent: "setAssignee", itemKey: "row:c", assigneeId: "" })
    ).toBe("c");
    expect(
      rowTouchedBy({
        intent: "setAssignee",
        itemKey: "task:kickoff",
        assigneeId: ""
      })
    ).toBeNull();
    expect(
      rowTouchedBy({
        intent: "setCheck",
        itemKey: "row:x",
        kind: "check",
        value: "1"
      })
    ).toBeNull();
  });
});

describe("rowSource", () => {
  it("records a customer's or an agent's row as their own", () => {
    expect(rowSource(customer, "handover")).toBe("customer");
    expect(rowSource(agent, "interview")).toBe("mcp");
  });

  it("lets staff record the handover or an interview as the source", () => {
    expect(rowSource(staff, "handover")).toBe("handover");
    expect(rowSource(staff, undefined)).toBe("staff");
  });
});

describe("JSON parsing", () => {
  it("accepts a list of strings only", () => {
    expect(parseItemKeys('["a","b"]')).toEqual(["a", "b"]);
    expect(parseItemKeys("[1]")).toBeNull();
    expect(parseItemKeys("{}")).toBeNull();
    expect(parseItemKeys("not json")).toBeNull();
  });

  it("accepts an object only", () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonObject("[]")).toBeNull();
    expect(parseJsonObject("null")).toBeNull();
    expect(parseJsonObject("{")).toBeNull();
  });
});

describe("questionChange", () => {
  it("reads choices first, then a typed answer", () => {
    expect(questionChange({ selected: '["A","?"]' })).toEqual({
      selected: ["A", "?"]
    });
    expect(questionChange({ answer: "Yes" })).toEqual({ answer: "Yes" });
    expect(questionChange({ answer: "" })).toEqual({ answer: "" });
  });

  it("refuses a malformed or missing change", () => {
    expect(questionChange({ selected: "[1]" })).toBeNull();
    expect(questionChange({})).toBeNull();
  });
});

describe("priority set writes", () => {
  const answer = {
    fieldKey: "priority.answer.orderStart",
    value: '["quote"]'
  };
  const override = {
    fieldKey: "priority.override.sales.quotes",
    value: '{"category":0}'
  };
  const setPriority = (writes: unknown[]): StateAction => ({
    intent: "setPriority",
    writes: JSON.stringify(writes)
  });

  it("lets anyone answer, an agent included", () => {
    expect(refusalFor(customer, setPriority([answer]))).toBeNull();
    expect(refusalFor(agent, setPriority([answer]))).toBeNull();
  });

  it("refuses an override from anyone but Carbon staff", () => {
    expect(refusalFor(customer, setPriority([answer, override]))).toBe(
      "Only Carbon staff can set a feature by hand"
    );
    expect(refusalFor(agent, setPriority([override]))).toBe(
      "Only Carbon staff can set a feature by hand"
    );
    expect(refusalFor(staff, setPriority([override]))).toBeNull();
  });

  it("parses a list of field writes and refuses anything else", () => {
    expect(parsePriorityWrites(JSON.stringify([answer]))).toEqual([answer]);
    expect(parsePriorityWrites("[]")).toEqual([]);
    expect(parsePriorityWrites('[{"fieldKey":"x"}]')).toBeNull();
    expect(parsePriorityWrites('{"fieldKey":"x","value":""}')).toBeNull();
    expect(parsePriorityWrites("not json")).toBeNull();
    expect(
      parsePriorityWrites(
        JSON.stringify(Array.from({ length: 201 }, () => answer))
      )
    ).toBeNull();
  });

  const at = "2026-10-14T09:00:00.000Z";
  const stored = (
    writes: { fieldKey: string; value: string }[],
    source: "customer" | "staff" | "mcp"
  ) => {
    const result = priorityFieldValues(writes, { userId: "u1", source }, at);
    if ("error" in result) throw new Error(result.error);
    return Object.fromEntries(
      result.values.map(({ fieldKey, value }) => [fieldKey, value])
    );
  };

  it("marks an answer an AI assistant entered over MCP", () => {
    expect(stored([answer], "mcp")).toEqual({
      [answer.fieldKey]: answer.value,
      "priority.via.answer.orderStart": "assistant"
    });
  });

  it("clears the mark when a person answers, or when the answer is cleared", () => {
    expect(stored([answer], "customer")["priority.via.answer.orderStart"]).toBe(
      ""
    );
    expect(stored([answer], "staff")["priority.via.answer.orderStart"]).toBe(
      ""
    );
    expect(
      stored([{ ...answer, value: "" }], "mcp")[
        "priority.via.answer.orderStart"
      ]
    ).toBe("");
  });

  it("marks the tool list, never overrides or the start", () => {
    const values = stored(
      [
        {
          fieldKey: "priority.tools",
          value: '[{"id":"t1","name":"JobBOSS"}]'
        },
        override,
        { fieldKey: "priority.start", value: "defaults" }
      ],
      "mcp"
    );
    expect(values["priority.via.tools"]).toBe("assistant");
    expect(
      Object.keys(values).filter((key) => key.startsWith("priority.via."))
    ).toHaveLength(1);
    expect(JSON.parse(values[override.fieldKey] ?? "")).toEqual({
      category: 0,
      by: "u1",
      at
    });
  });

  it("keeps the last write of a key and refuses an invalid one", () => {
    expect(
      stored([answer, { ...answer, value: '["priceList"]' }], "customer")[
        answer.fieldKey
      ]
    ).toBe('["priceList"]');
    expect(
      priorityFieldValues(
        [{ fieldKey: "priority.via.answer.orderStart", value: "assistant" }],
        { userId: "u1", source: "mcp" },
        at
      )
    ).toEqual({ error: "Not a priority set answer" });
  });
});

// The real boundary is PostgREST: a real client whose fetch records each
// request and answers as PostgREST does. A DELETE with `select` returns the
// deleted rows; a GET returns the rows that match.
let requests: { method: string; url: string }[] = [];
let stored: { id: string }[] = [];
let deletes = true;
const client = createClient("http://postgrest.test", "anon-key", {
  global: {
    fetch: async (input, init) => {
      const method = init?.method ?? "GET";
      requests.push({ method, url: String(input) });
      let body: unknown = stored;
      // RLS that keeps the row (no Settings delete): nothing is deleted.
      if (method === "DELETE" && deletes) {
        body = stored;
        stored = [];
      } else if (method === "DELETE") {
        body = [];
      }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  }
});

describe("clearField", () => {
  const staffActor = {
    companyId: "company_1",
    userId: "user_1",
    isInternal: true,
    source: "mcp" as const
  };
  const clear: StateAction = { intent: "clearField", fieldKey: "scope.goal" };

  beforeEach(() => {
    requests = [];
    stored = [];
    deletes = true;
  });

  it("deletes the stored value for this company and field", async () => {
    stored = [{ id: "fv_1" }];
    const result = await applyHubMutation(client as never, staffActor, clear);
    expect(result.error).toBeNull();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe("DELETE");
    const url = new URL(requests[0]?.url ?? "");
    expect(url.pathname).toBe("/rest/v1/implementationFieldValue");
    expect(url.searchParams.get("companyId")).toBe("eq.company_1");
    expect(url.searchParams.get("fieldKey")).toBe("eq.scope.goal");
  });

  it("succeeds when nothing was set", async () => {
    const result = await applyHubMutation(client as never, staffActor, clear);
    expect(result.error).toBeNull();
  });

  it("is refused when the row is still there after the delete", async () => {
    stored = [{ id: "fv_1" }];
    deletes = false;
    const result = await applyHubMutation(client as never, staffActor, clear);
    expect(result.error).toEqual({
      message: "Clearing a field needs the Settings delete permission",
      forbidden: true
    });
  });

  it("refuses a customer before anything is sent", async () => {
    stored = [{ id: "fv_1" }];
    const result = await applyHubMutation(
      client as never,
      { ...staffActor, isInternal: false },
      clear
    );
    expect(result.error?.forbidden).toBe(true);
    expect(requests).toHaveLength(0);
  });
});

describe("addRow placed on a page", () => {
  const page = {
    version: 1,
    user: "ops@example.com",
    sections: [
      { title: "Before go-live", cards: [{ item: "setup:locations" }] }
    ]
  };
  const place = (target: unknown) => JSON.stringify({ page, target });
  const question: StateAction = {
    intent: "addRow",
    collection: "question",
    payload: JSON.stringify({ question: "Who approves purchase orders?" }),
    place: place({ section: 0 })
  };
  const staffActor = {
    companyId: "company_1",
    userId: "staff_1",
    isInternal: true,
    source: "staff" as const
  };

  // The tables the write reads and writes, kept as rows.
  let tables: Record<string, Record<string, unknown>[]>;
  let sent: number;
  const pageClient = createClient("http://postgrest.test", "anon-key", {
    global: {
      fetch: async (input, init) => {
        sent += 1;
        const url = new URL(String(input));
        const table = url.pathname.replace("/rest/v1/", "");
        const rows = (tables[table] ??= []);
        const method = init?.method ?? "GET";
        let body: unknown = [];
        if (method === "POST") {
          const written = JSON.parse(String(init?.body));
          const row =
            table === "implementationRow"
              ? { id: "row_new", ...written }
              : written;
          rows.push(row);
          body = [row];
        } else {
          const filters = [...url.searchParams].filter(
            ([key]) => !["select", "limit", "order"].includes(key)
          );
          body = rows.filter((row) =>
            filters.every(([key, value]) => `eq.${row[key]}` === value)
          );
        }
        const accept = new Headers(init?.headers).get("Accept") ?? "";
        if (accept.includes("vnd.pgrst.object")) {
          body = (body as unknown[])[0] ?? null;
        }
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
    }
  });

  beforeEach(() => {
    sent = 0;
    tables = {
      employees: [
        { id: "user_ops", email: "ops@example.com", companyId: "company_1" }
      ],
      implementationRow: [],
      implementationMember: []
    };
  });

  it("writes the row and the person's page with the new card", async () => {
    const result = await applyHubMutation(
      pageClient as never,
      staffActor,
      question
    );
    expect(result.error).toBeNull();
    expect(result.memberId).toBe("user_ops");
    expect(tables.implementationRow).toEqual([
      expect.objectContaining({
        id: "row_new",
        collection: "question",
        payload: { question: "Who approves purchase orders?" }
      })
    ]);
    expect(tables.implementationMember).toEqual([
      expect.objectContaining({
        userId: "user_ops",
        page: {
          ...page,
          sections: [
            {
              title: "Before go-live",
              cards: [{ item: "setup:locations" }, { item: "question:row_new" }]
            }
          ]
        }
      })
    ]);
  });

  it("writes no row when the section is not on the page", async () => {
    const result = await applyHubMutation(pageClient as never, staffActor, {
      ...question,
      place: place({ section: 3 })
    } as StateAction);
    expect(result.error?.forbidden).toBe(false);
    expect(tables.implementationRow).toEqual([]);
  });

  it("refuses a customer before anything is sent", async () => {
    const result = await applyHubMutation(
      pageClient as never,
      { ...staffActor, isInternal: false, source: "customer" },
      { ...question, collection: "objective" } as StateAction
    );
    expect(result.error).toEqual({
      message: "Only Carbon staff can set up a person's hub page",
      forbidden: true
    });
    expect(sent).toBe(0);
  });

  it("reads a target section, or a new section by its title", () => {
    expect(parsePlacement(place({ section: 0 }))).toEqual({
      page,
      target: { section: 0 }
    });
    expect(parsePlacement(place({ newSection: "Data" }))).toEqual({
      page,
      target: { newSection: "Data" }
    });
  });

  it.each([
    ["a section past the end", place({ section: 1 })],
    ["an untitled new section", place({ newSection: " " })],
    [
      "a page that is not a page",
      JSON.stringify({ page: {}, target: { section: 0 } })
    ],
    ["text that is not JSON", "{"]
  ])("refuses %s", (_, json) => {
    expect(parsePlacement(json)).toHaveProperty("error");
  });
});
