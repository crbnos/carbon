// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { JournalLineDimensionValue } from "~/modules/accounting/ui/JournalEntries/types";

export type ClientDocumentLine = {
  /** Client-only row key. Never sent to the server. */
  key: string;
  /** Persisted line id when the row came from the database; absent for a new row. */
  id?: string;
  accountId: string;
  description: string;
  amount: number | null;
  /**
   * Generic dimension pairs, edited through DimensionSelector. Carries the
   * display names client-side; only {dimensionId, valueId} is submitted.
   */
  dimensions: JournalLineDimensionValue[];
  /**
   * The two legacy columns. The Ramp sync writes them, and posting unions
   * them with `dimensions`. They ride along so a round-trip through the editor
   * cannot drop what the sync imported. With `showChargeNumber`, the editor's
   * charge number picker writes `projectId` (with `projectElementId`).
   */
  costCenterId: string | null;
  projectId: string | null;
  /** The element of the charge number; set only by the charge number picker. */
  projectElementId: string | null;
};
