// The hub's write contract. One typed union for every persisted mutation, plus a
// pure mapper to the FormData fields the `/x/get-started/state` action validates
// (see `stateActionValidator` in ../../models). Framework-agnostic: no React
// Router here. The ERP layout builds a single `dispatch` from `useFetcher` +
// `toFormFields`, so payload shaping (intent strings, JSON encoding) lives in ONE
// place instead of being copy-pasted into every route file.
//
// To add a mutation: add a variant here, a `case` in `toFormFields`, a matching
// branch in the server action, and (optionally) a wrapper in `useHubActions`.

import type {
  HubContacts,
  HubExclusions,
  HubStatus,
  StateKind,
  Tier
} from "../../types";

export type HubMutation =
  | { intent: "setCheck"; itemKey: string; kind: StateKind; value: string }
  | { intent: "setField"; fieldKey: string; value: string }
  | { intent: "addRow"; collection: string; payload: Record<string, unknown> }
  | { intent: "updateRow"; rowId: string; payload: Record<string, unknown> }
  | { intent: "deleteRow"; rowId: string }
  | { intent: "setExclusions"; exclusions: HubExclusions }
  | { intent: "setTier"; tier: Tier }
  | { intent: "setStatus"; status: HubStatus }
  | { intent: "setContacts"; contacts: HubContacts };

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
    case "setField":
      return { intent: m.intent, fieldKey: m.fieldKey, value: m.value };
    case "addRow":
      return {
        intent: m.intent,
        collection: m.collection,
        payload: JSON.stringify(m.payload)
      };
    case "updateRow":
      return {
        intent: m.intent,
        rowId: m.rowId,
        payload: JSON.stringify(m.payload)
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
  }
}
