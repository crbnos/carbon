import type { ComponentType } from "react";
import type { fieldMappings } from "~/modules/shared";
import { ChartOfAccountsReview } from "./ChartOfAccountsReview";

export type ReviewStepProps = {
  table: keyof typeof fieldMappings;
  columnMappings: Record<string, string>;
  enumMappings: Record<string, Record<string, string>>;
};

// Per-table review steps. A table listed here gets one extra wizard page after
// the enum steps, rendered inside the import form so any hidden inputs it
// renders (e.g. `options`) travel with the final submit.
export const importReviewSteps: Partial<
  Record<keyof typeof fieldMappings, ComponentType<ReviewStepProps>>
> = {
  account: ChartOfAccountsReview
};
