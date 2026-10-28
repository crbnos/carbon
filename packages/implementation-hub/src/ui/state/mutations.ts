// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The hub's write contract. One typed union for every persisted mutation, plus a
// pure mapper to the FormData fields the `/x/get-started/state` action validates
// (see `stateActionValidator` in ../../models). Framework-agnostic: no React
// Router here. The ERP layout builds a single `dispatch` from `useFetcher` +
// `toFormFields`, so payload shaping (intent strings, JSON encoding) lives in ONE
// place instead of being copy-pasted into every route file.
//
// To add a mutation: add a variant here, a `case` in `toFormFields`, a matching
// branch in the server action, and (optionally) a wrapper in `useHubActions`.

import type { PageTarget } from "../../logic/page-edit";
import type { MemberPage } from "../../models";
import type {
  HubContacts,
  HubExclusions,
  HubStatus,
  Source,
  StateKind,
  Tier
} from "../../types";

export type HubMutation =
  | { intent: "setCheck"; itemKey: string; kind: StateKind; value: string }
  | { intent: "setChecks"; itemKeys: string[]; kind: StateKind; value: string }
  | { intent: "setField"; fieldKey: string; value: string }
  | {
      intent: "addRow";
      collection: string;
      payload: Record<string, unknown>;
      source?: Source;
      sourceRef?: string;
      // Carbon staff: the row also goes on this page, in one write.
      place?: { page: MemberPage; target: PageTarget };
    }
  | { intent: "updateRow"; rowId: string; payload: Record<string, unknown> }
  | {
      intent: "answerQuestion";
      rowId: string;
      change: { answer: string } | { selected: string[] };
    }
  | { intent: "deleteRow"; rowId: string }
  | { intent: "setExclusions"; exclusions: HubExclusions }
  | { intent: "setTier"; tier: Tier }
  | { intent: "setStatus"; status: HubStatus }
  | { intent: "setContacts"; contacts: HubContacts }
  | { intent: "verifyGate"; gateKey: string; itemKeys: string[] }
  | { intent: "unverifyGate"; gateKey: string; itemKeys: string[] }
  | { intent: "setAssignee"; itemKey: string; assigneeId: string | null }
  | { intent: "applyHandover" }
  // A person's page file, as text. The server parses and checks it.
  | { intent: "setMemberPage"; page: string }
  | { intent: "deleteMemberPage"; userId: string }
  // Priority set answers and overrides, as field values (logic/priority-set).
  | { intent: "setPriority"; writes: { fieldKey: string; value: string }[] };

// Shape a mutation into flat string fields for FormData submission. JSON-encodes
// the structured payloads exactly as the server validator expects to parse them.
export function toFormFields(m: HubMutation): Record<string, string> {
  switch (m.intent) {
    case "setCheck":
      return {
        intent: m.intent,
        itemKey: m.itemKey,
        kind: m.kind,
        value: m.value
      };
    case "setChecks":
      return {
        intent: m.intent,
        itemKeys: JSON.stringify(m.itemKeys),
        kind: m.kind,
        value: m.value
      };
    case "setField":
      return { intent: m.intent, fieldKey: m.fieldKey, value: m.value };
    case "addRow":
      return {
        intent: m.intent,
        collection: m.collection,
        payload: JSON.stringify(m.payload),
        ...(m.source ? { source: m.source } : {}),
        ...(m.sourceRef ? { sourceRef: m.sourceRef } : {}),
        ...(m.place ? { place: JSON.stringify(m.place) } : {})
      };
    case "updateRow":
      return {
        intent: m.intent,
        rowId: m.rowId,
        payload: JSON.stringify(m.payload)
      };
    case "answerQuestion":
      return {
        intent: m.intent,
        rowId: m.rowId,
        ...("answer" in m.change
          ? { answer: m.change.answer }
          : { selected: JSON.stringify(m.change.selected) })
      };
    case "deleteRow":
      return { intent: m.intent, rowId: m.rowId };
    case "setExclusions":
      return { intent: m.intent, exclusions: JSON.stringify(m.exclusions) };
    case "setTier":
      return { intent: m.intent, tier: m.tier };
    case "setStatus":
      return { intent: m.intent, status: m.status };
    case "setContacts":
      return { intent: m.intent, contacts: JSON.stringify(m.contacts) };
    case "verifyGate":
    case "unverifyGate":
      return {
        intent: m.intent,
        gateKey: m.gateKey,
        itemKeys: JSON.stringify(m.itemKeys)
      };
    case "setAssignee":
      return {
        intent: m.intent,
        itemKey: m.itemKey,
        assigneeId: m.assigneeId ?? ""
      };
    case "applyHandover":
      return { intent: m.intent };
    case "setMemberPage":
      return { intent: m.intent, page: m.page };
    case "deleteMemberPage":
      return { intent: m.intent, userId: m.userId };
    case "setPriority":
      return { intent: m.intent, writes: JSON.stringify(m.writes) };
  }
}
