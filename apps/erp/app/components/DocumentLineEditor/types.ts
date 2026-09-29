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
   * The two legacy columns. The EDITOR does not write them — the Ramp sync
   * does, and posting unions them with `dimensions`. They ride along
   * read-only so a round-trip through the editor cannot drop what the sync
   * imported.
   */
  costCenterId: string | null;
  projectId: string | null;
};
