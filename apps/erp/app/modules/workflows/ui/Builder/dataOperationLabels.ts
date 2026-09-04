import type { DataOperation } from "@carbon/workflows";
import { useLingui } from "@lingui/react/macro";

/**
 * How each data operation reads in the builder.
 *
 * The operation TABLE (`DATA_OPERATIONS`) stays the single source of truth for what
 * an operation does; only its wording lives here. It cannot live beside the table
 * because `@carbon/workflows` is imported by the job runner and by unit tests that
 * do not transform Lingui macros.
 */
export function useDataOperationLabel(): (operation: DataOperation) => string {
  const { t } = useLingui();

  return (operation) => {
    switch (operation) {
      case "filter":
        return t`Keep matching items`;
      case "count":
        return t`Count items`;
      case "first":
        return t`Take the first item`;
      case "last":
        return t`Take the last item`;
      case "pluck":
        return t`Take one field from every item`;
      case "join":
        return t`Join into text`;
    }
  };
}
