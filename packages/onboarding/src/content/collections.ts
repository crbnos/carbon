// Registry of the custom-row surfaces — the per-customer "Added for this
// customer" lists Carbon staff can extend on top of the template. One entry here
// gives a surface its add-button label, empty-state copy, and the default
// payload for a new row. The server persists these as `implementationRow` keyed
// by `collection`; the matching server branch already accepts any collection
// string, so adding a surface is: add an entry here + render it with
// <CustomRowSection collection="…"> + a render-prop row body.

import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

export interface CollectionDef {
  collection: string;
  addLabel: MessageDescriptor;
  emptyText: MessageDescriptor;
  // Binary status-toggle labels for surfaces whose rows flip a single flag
  // (validated / configured / in-scope). Checkbox surfaces (golive) leave this
  // unset.
  flag?: { active: MessageDescriptor; inactive: MessageDescriptor };
  // Whether customers may CREATE rows in this collection themselves (the
  // Decisions Log, their crew). Staff-tailoring surfaces leave this off —
  // adding template rows stays a Carbon-staff action. The /state server action
  // enforces this; it is not just UX.
  customerAdd?: boolean;
  // Default cells for a freshly added row. A function so each call is a fresh
  // object (no shared-reference surprises). These seed values are persisted to
  // the DB as user-editable row DATA, so they stay plain strings — NOT translated.
  newPayload: () => Record<string, unknown>;
}

export const COLLECTIONS = {
  data: {
    collection: "data",
    addLabel: msg`Add a row`,
    emptyText: msg`No extra data sets yet. Add anything specific to this customer.`,
    flag: { active: msg`Validated`, inactive: msg`Not yet` },
    newPayload: () => ({ object: "New data set", today: "" })
  },
  setup: {
    collection: "setup",
    addLabel: msg`Add a row`,
    emptyText: msg`No extra setup items yet. Add anything specific to this customer.`,
    flag: { active: msg`Configured`, inactive: msg`Not yet` },
    newPayload: () => ({ object: "New setup item", today: "" })
  },
  requirement: {
    collection: "requirement",
    addLabel: msg`Add a requirement`,
    emptyText: msg`No extra requirements yet. Add anything specific to this customer.`,
    flag: { active: msg`In scope`, inactive: msg`Out` },
    newPayload: () => ({ requirement: "New requirement" })
  },
  golive: {
    collection: "golive",
    addLabel: msg`Add a step`,
    emptyText: msg`No extra cutover steps yet. Add anything specific to this customer.`,
    newPayload: () => ({ label: "New cutover step" })
  },
  // The Decisions Log — the five decisions that cause expensive rework when
  // they're made silently and wrong. Customers record their own decisions.
  decisions: {
    collection: "decisions",
    addLabel: msg`Record a decision`,
    emptyText: msg`No decisions recorded yet.`,
    customerAdd: true,
    newPayload: () => ({ key: "", value: "", decidedBy: "", decidedAt: "" })
  },
  // Your Crew — the owner plus one champion per area (Phase 5). Customers
  // build their own lineup.
  crew: {
    collection: "crew",
    addLabel: msg`Add a champion`,
    emptyText: msg`No champions named yet. One per area — one person can wear several hats.`,
    customerAdd: true,
    newPayload: () => ({ area: "", name: "", email: "", status: "invited" })
  },
  // Fix-it tasks born from the Live page's relapse question ("something
  // happened outside Carbon" → a task with a play, not a shrug).
  fixit: {
    collection: "fixit",
    addLabel: msg`Add a fix`,
    emptyText: msg`Nothing to fix — everything's happening in Carbon.`,
    flag: { active: msg`Fixed`, inactive: msg`Open` },
    customerAdd: true,
    newPayload: () => ({ label: "" })
  }
} satisfies Record<string, CollectionDef>;

export type CollectionKey = keyof typeof COLLECTIONS;
