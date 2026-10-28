// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The hub's single write path. The ERP's /x/get-started/state action and the
// MCP hub tools both call `applyHubMutation`, so a person in the app and an
// agent over MCP write under exactly the same rules. RLS stays the backstop:
// it lets any employee of the company write, and these rules narrow that.

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applyHandover } from "./apply-handover";
import { checkKey, rowItemKey } from "./logic/keys";
import {
  buildPageCatalogue,
  catalogueByItem,
  checkMemberPage
} from "./logic/page";
import { answerQuestionPayload } from "./logic/question";
import type { StateAction } from "./models";
import {
  deleteFieldValue,
  deleteImplementationAssignment,
  deleteImplementationMember,
  deleteImplementationRow,
  getImplementationAssignment,
  getImplementationRows,
  insertImplementationRow,
  setCheckStatesVerified,
  updateImplementationHub,
  updateImplementationRow,
  upsertCheckState,
  upsertCheckStates,
  upsertFieldValue,
  upsertImplementationAssignment,
  upsertImplementationMember
} from "./server";
import type { ImplementationRowData, Source, StateKind } from "./types";

type Client = SupabaseClient<Database>;

export interface HubActor {
  companyId: string;
  userId: string;
  // Carbon staff (an internal email). Staff tailor the hub; customers work it.
  isInternal: boolean;
  // What a tick is recorded as: Carbon staff, the customer, or an agent over
  // MCP. An agent acting for a staff member still records `mcp`.
  source: Extract<Source, "customer" | "staff" | "mcp">;
}

export interface HubMutationError {
  message: string;
  // True when the rules refused the actor, false when the write failed.
  forbidden: boolean;
}

export interface HubMutationResult {
  error: HubMutationError | null;
  // The ticks this mutation wrote, so the caller can emit telemetry.
  toggled: { itemKey: string; kind: StateKind; value: string }[];
  // The person whose page a setMemberPage wrote.
  memberId?: string;
}

// The only collection a customer may add rows to: their own objectives. Every
// other collection is tailoring, which is Carbon staff work.
const CUSTOMER_COLLECTIONS = new Set(["objective"]);
// Collections a customer may read but never change, not even a status toggle.
const STAFF_ONLY_COLLECTIONS = new Set(["customization"]);

// The assignment key of a custom row lives with the other keys, so the UI
// builds the same string. Re-exported for server callers.
export { rowItemKey };

// What the database says about the custom row a mutation touches. Only read
// for a customer: staff may change any row.
export interface RowFacts {
  collection: string | null;
  // The actor is the row's assignee (for an objective: its owner).
  ownedByActor: boolean;
}

// The custom row a mutation touches, when its rules depend on that row.
export function rowTouchedBy(action: StateAction): string | null {
  switch (action.intent) {
    case "updateRow":
    case "answerQuestion":
    case "deleteRow":
      return action.rowId;
    case "setAssignee":
      return action.itemKey.startsWith("row:")
        ? action.itemKey.slice("row:".length)
        : null;
    default:
      return null;
  }
}

// Pure: may this actor run this mutation? Returns the refusal message, or null
// when the mutation is allowed. RLS already limits every write to employees of
// the company; these rules narrow what a customer (not Carbon staff) may do.
export function refusalFor(
  actor: Pick<HubActor, "isInternal">,
  action: StateAction,
  row: RowFacts = { collection: null, ownedByActor: false }
): string | null {
  if (actor.isInternal) return null;

  switch (action.intent) {
    case "setCheck":
    case "setChecks":
    case "setStatus":
      return null;
    case "setField":
    case "clearField":
      // All fill-in fields are Carbon-owned. When customer-owned fields are
      // added, gate per the field's ownership instead of isInternal.
      return "Only Carbon staff can edit this field";
    case "addRow":
      return CUSTOMER_COLLECTIONS.has(action.collection)
        ? null
        : "Only Carbon staff can add rows";
    case "updateRow":
    case "answerQuestion":
    case "setAssignee":
      if (STAFF_ONLY_COLLECTIONS.has(row.collection ?? "")) {
        return "Only Carbon staff can change this row";
      }
      if (row.collection === "objective" && !row.ownedByActor) {
        return "You can only change your own objectives";
      }
      return null;
    case "deleteRow":
      return row.collection === "objective" && row.ownedByActor
        ? null
        : "Only Carbon staff can delete rows";
    case "setExclusions":
    case "setTier":
    case "setContacts":
      return "Only Carbon staff can change this setting";
    case "verifyGate":
    case "unverifyGate":
      return "Only Carbon staff can verify a gate";
    case "applyHandover":
      return "Only Carbon staff can apply the sales handover";
    case "setMemberPage":
    case "deleteMemberPage":
      return "Only Carbon staff can set up a person's hub page";
  }
}

// Pure: what a new row is recorded as. Staff may record that it came from the
// handover or an interview; everyone else's rows are recorded as their own.
export function rowSource(
  actor: Pick<HubActor, "isInternal" | "source">,
  requested: Source | undefined
): Source {
  return actor.isInternal && requested ? requested : actor.source;
}

// Pure: parse a JSON-encoded list of item keys; null when it is not one.
export function parseItemKeys(json: string): string[] | null {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) && value.every((key) => typeof key === "string")
      ? value
      : null;
  } catch {
    return null;
  }
}

// Pure: the change an answerQuestion action carries, or null when it carries
// neither a typed answer nor a JSON list of choices.
export function questionChange(action: {
  answer?: string;
  selected?: string;
}): { answer: string } | { selected: string[] } | null {
  if (action.selected !== undefined) {
    const selected = parseItemKeys(action.selected);
    return selected ? { selected } : null;
  }
  return action.answer !== undefined ? { answer: action.answer } : null;
}

// Pure: parse a JSON-encoded object; null when it is not one.
export function parseJsonObject(json: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(json);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const ok = (toggled: HubMutationResult["toggled"] = []): HubMutationResult => ({
  error: null,
  toggled
});

const forbidden = (message: string): HubMutationResult => ({
  error: { message, forbidden: true },
  toggled: []
});

const failed = (error: { message: string } | null): HubMutationResult => ({
  error: { message: error?.message ?? "Failed to update", forbidden: false },
  toggled: []
});

// The facts `refusalFor` needs about the row a customer's mutation touches.
async function readRowFacts(
  client: Client,
  actor: HubActor,
  rowId: string
): Promise<RowFacts> {
  const [row, assignment] = await Promise.all([
    client
      .from("implementationRow")
      .select("collection")
      .eq("companyId", actor.companyId)
      .eq("id", rowId)
      .maybeSingle(),
    getImplementationAssignment(client, {
      companyId: actor.companyId,
      itemKey: rowItemKey(rowId)
    })
  ]);
  return {
    collection: row.data?.collection ?? null,
    ownedByActor: assignment.data?.assigneeId === actor.userId
  };
}

export async function applyHubMutation(
  client: Client,
  actor: HubActor,
  action: StateAction
): Promise<HubMutationResult> {
  const { companyId, userId, isInternal } = actor;

  const rowId = rowTouchedBy(action);
  const row =
    rowId && !isInternal ? await readRowFacts(client, actor, rowId) : undefined;
  const refusal = refusalFor(actor, action, row);
  if (refusal) return forbidden(refusal);

  switch (action.intent) {
    case "setCheck": {
      const result = await upsertCheckState(client, {
        companyId,
        itemKey: action.itemKey,
        kind: action.kind,
        value: action.value,
        userId,
        source: actor.source
      });
      if (result.error) return failed(result.error);
      return ok([
        { itemKey: action.itemKey, kind: action.kind, value: action.value }
      ]);
    }

    case "setChecks": {
      const itemKeys = parseItemKeys(action.itemKeys);
      if (!itemKeys) return failed({ message: "Invalid item keys" });
      const result = await upsertCheckStates(client, {
        companyId,
        itemKeys,
        kind: action.kind,
        value: action.value,
        userId,
        source: actor.source
      });
      if (result.error) return failed(result.error);
      return ok(
        Array.from(new Set(itemKeys)).map((itemKey) => ({
          itemKey,
          kind: action.kind,
          value: action.value
        }))
      );
    }

    case "setField": {
      const result = await upsertFieldValue(client, {
        companyId,
        fieldKey: action.fieldKey,
        value: action.value,
        userId
      });
      return result.error ? failed(result.error) : ok();
    }

    case "clearField": {
      const result = await deleteFieldValue(client, {
        companyId,
        fieldKey: action.fieldKey
      });
      if (result.error) return failed(result.error);
      if (result.data.length > 0) return ok();
      // Nothing deleted: either nothing was set, or RLS kept the row.
      const left = await client
        .from("implementationFieldValue")
        .select("id")
        .eq("companyId", companyId)
        .eq("fieldKey", action.fieldKey)
        .maybeSingle();
      if (left.error) return failed(left.error);
      return left.data
        ? forbidden("Clearing a field needs the Settings delete permission")
        : ok();
    }

    case "addRow": {
      const payload = parseJsonObject(action.payload);
      if (!payload) return failed({ message: "Invalid row" });
      const result = await insertImplementationRow(client, {
        companyId,
        collection: action.collection,
        payload,
        userId,
        source: rowSource(actor, action.source),
        sourceRef: action.sourceRef
      });
      if (result.error) return failed(result.error);
      // A customer's objective is theirs. A staff objective belongs to the
      // company until someone is assigned to it.
      if (action.collection === "objective" && !isInternal) {
        const assigned = await upsertImplementationAssignment(client, {
          companyId,
          itemKey: rowItemKey(result.data.id),
          assigneeId: userId,
          userId
        });
        if (assigned.error) return failed(assigned.error);
      }
      return ok();
    }

    case "updateRow": {
      const payload = parseJsonObject(action.payload);
      if (!payload) return failed({ message: "Invalid row" });
      const result = await updateImplementationRow(client, {
        id: action.rowId,
        companyId,
        payload,
        userId
      });
      return result.error ? failed(result.error) : ok();
    }

    case "answerQuestion": {
      const change = questionChange(action);
      if (!change) return failed({ message: "Invalid answer" });
      const stored = await client
        .from("implementationRow")
        .select("collection, payload")
        .eq("companyId", companyId)
        .eq("id", action.rowId)
        .maybeSingle();
      if (stored.error) return failed(stored.error);
      if (stored.data?.collection !== "question") {
        return failed({ message: "Question not found" });
      }
      const answer = answerQuestionPayload(
        (stored.data.payload ?? {}) as Record<string, unknown>,
        change
      );
      const updated = await updateImplementationRow(client, {
        id: action.rowId,
        companyId,
        payload: answer.payload,
        userId
      });
      if (updated.error) return failed(updated.error);
      // The tick follows the answer, so the question reads answered in every
      // view. The answer is saved first: if the tick fails, answering again
      // sets it.
      const itemKey = checkKey("question", action.rowId);
      const value = answer.answered ? "1" : "0";
      const ticked = await upsertCheckState(client, {
        companyId,
        itemKey,
        kind: "check",
        value,
        userId,
        source: actor.source
      });
      if (ticked.error) return failed(ticked.error);
      return ok([{ itemKey, kind: "check", value }]);
    }

    case "deleteRow": {
      const result = await deleteImplementationRow(client, {
        id: action.rowId,
        companyId
      });
      if (result.error) return failed(result.error);
      // The row's assignment goes with it.
      const unassigned = await deleteImplementationAssignment(client, {
        companyId,
        itemKey: rowItemKey(action.rowId)
      });
      return unassigned.error ? failed(unassigned.error) : ok();
    }

    case "setStatus": {
      // Finishing (or reopening) the hub is the customer's own action on their
      // own hub, open to any company member.
      const result = await updateImplementationHub(client, companyId, {
        status: action.status,
        userId
      });
      return result.error ? failed(result.error) : ok();
    }

    case "setExclusions":
    case "setTier":
    case "setContacts": {
      let patch: Parameters<typeof updateImplementationHub>[2];
      if (action.intent === "setTier") {
        patch = { tier: action.tier, userId };
      } else {
        const value = parseJsonObject(
          action.intent === "setExclusions"
            ? action.exclusions
            : action.contacts
        );
        if (!value) return failed({ message: "Invalid setting" });
        patch =
          action.intent === "setExclusions"
            ? { exclusions: value as never, userId }
            : { contacts: value as never, userId };
      }
      const result = await updateImplementationHub(client, companyId, patch);
      return result.error ? failed(result.error) : ok();
    }

    case "verifyGate":
    case "unverifyGate": {
      const itemKeys = parseItemKeys(action.itemKeys);
      if (!itemKeys) return failed({ message: "Invalid item keys" });
      const verified = action.intent === "verifyGate";
      if (verified) {
        // A gate passed through its tasks has no tick of its own yet. Record
        // it as passed, so the verification has a row to sit on.
        const gate = await client
          .from("implementationCheckState")
          .select("value")
          .eq("companyId", companyId)
          .eq("itemKey", action.gateKey)
          .maybeSingle();
        if (gate.error) return failed(gate.error);
        if (!gate.data) {
          const passed = await upsertCheckState(client, {
            companyId,
            itemKey: action.gateKey,
            kind: "gate",
            value: "done",
            userId,
            source: actor.source
          });
          if (passed.error) return failed(passed.error);
        }
      }
      const result = await setCheckStatesVerified(client, {
        companyId,
        itemKeys: [action.gateKey, ...itemKeys],
        userId,
        verified
      });
      return result.error ? failed(result.error) : ok();
    }

    case "setAssignee": {
      if (!action.assigneeId) {
        const result = await deleteImplementationAssignment(client, {
          companyId,
          itemKey: action.itemKey
        });
        return result.error ? failed(result.error) : ok();
      }

      // The assignee must be a person in this company, not any user id.
      const employee = await client
        .from("employee")
        .select("id")
        .eq("companyId", companyId)
        .eq("id", action.assigneeId)
        .maybeSingle();
      if (employee.error) return failed(employee.error);
      if (!employee.data) {
        return failed({ message: "The assignee is not part of this company" });
      }

      const result = await upsertImplementationAssignment(client, {
        companyId,
        itemKey: action.itemKey,
        assigneeId: action.assigneeId,
        userId
      });
      return result.error ? failed(result.error) : ok();
    }

    case "applyHandover": {
      const result = await applyHandover(client, { companyId, userId });
      return result.error ? failed(result.error) : ok();
    }

    case "setMemberPage": {
      // The catalogue includes the company's own rows, so a page can place an
      // objective or a custom setup item by its row id.
      const rows = await getImplementationRows(client, companyId);
      if (rows.error) return failed(rows.error);
      const items = catalogueByItem(
        buildPageCatalogue(rows.data as unknown as ImplementationRowData[])
      );
      const { page, problems } = checkMemberPage(action.page, items);
      if (!page) return failed({ message: problems.join("\n") });

      // The page belongs to an employee of this company, found by email,
      // whatever their status: an invited person's page waits for their
      // first sign-in, an inactive person's for a new invite.
      const person = await client
        .from("employees")
        .select("id")
        .eq("companyId", companyId)
        .eq("email", page.user)
        .maybeSingle();
      if (person.error) return failed(person.error);
      if (!person.data?.id) {
        return failed({
          message: `user: ${page.user} is not an employee of this company`
        });
      }

      const result = await upsertImplementationMember(client, {
        companyId,
        memberId: person.data.id,
        page,
        userId
      });
      if (result.error) return failed(result.error);
      return { error: null, toggled: [], memberId: person.data.id };
    }

    case "deleteMemberPage": {
      const result = await deleteImplementationMember(client, {
        companyId,
        memberId: action.userId
      });
      return result.error ? failed(result.error) : ok();
    }
  }
}
