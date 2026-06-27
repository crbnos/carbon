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
  // (validated / configured / in-scope). Multi-status surfaces (board) and
  // checkbox surfaces (golive) leave this unset.
  flag?: { active: MessageDescriptor; inactive: MessageDescriptor };
  // Default cells for a freshly added row. A function so each call is a fresh
  // object (no shared-reference surprises). These seed values are persisted to
  // the DB as user-editable row DATA, so they stay plain strings — NOT translated.
  newPayload: () => Record<string, unknown>;
}

export const COLLECTIONS = {
  board: {
    collection: "board",
    addLabel: msg`Add a task`,
    emptyText: msg`No custom tasks yet. Add deal-specific work here.`,
    newPayload: () => ({ label: "New task", owner: "shared", status: "todo" })
  },
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
  }
} satisfies Record<string, CollectionDef>;

export type CollectionKey = keyof typeof COLLECTIONS;
