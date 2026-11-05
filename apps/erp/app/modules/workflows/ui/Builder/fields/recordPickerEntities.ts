// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/** The entities `RECORD_PICKERS` has a selector for. Apart from the pickers so
 * pure field logic can ask without importing React components or Lingui. */
export const RECORD_PICKER_ENTITIES = [
  "customer",
  "supplier",
  "item",
  "location",
  "nonConformanceType",
  "user",
  "group"
] as const;

export type RecordPickerEntity = (typeof RECORD_PICKER_ENTITIES)[number];

export const hasRecordPicker = (entity: string): entity is RecordPickerEntity =>
  (RECORD_PICKER_ENTITIES as readonly string[]).includes(entity);
