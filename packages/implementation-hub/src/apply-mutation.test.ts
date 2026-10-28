// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyHubMutation,
  parseItemKeys,
  parseJsonObject,
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
