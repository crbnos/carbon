// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type {
  FieldValues,
  LinkSync,
  SnapshotValue,
  SyncedField
} from "./types";

const same = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? null) === (b ?? null);

/**
 * The fields whose Carbon value differs from the snapshot's `carbon` value.
 * With no snapshot (a first sync, or a link made before snapshots), every
 * field counts as changed.
 */
export function changedOutbound(
  fields: SyncedField[],
  carbon: FieldValues,
  sync: LinkSync | null
): SyncedField[] {
  if (!sync) return [...fields];
  return fields.filter((f) => !same(carbon[f], sync.values[f]?.carbon));
}

/** The fields whose issue value differs from the snapshot's `remote` value. */
export function changedInbound(
  fields: SyncedField[],
  remote: FieldValues,
  sync: LinkSync | null
): SyncedField[] {
  if (!sync) return [...fields];
  return fields.filter((f) => !same(remote[f], sync.values[f]?.remote));
}

/**
 * Merge field updates into a snapshot. Fields not in `updates` keep their
 * values. `refused` replaces the old refusal when it is given; `null` clears it.
 */
export function nextSync(
  sync: LinkSync | null,
  updates: Partial<Record<SyncedField, SnapshotValue>>,
  refused?: LinkSync["refused"]
): LinkSync {
  return {
    values: { ...(sync?.values ?? {}), ...updates },
    refused: refused === undefined ? (sync?.refused ?? null) : refused
  };
}
