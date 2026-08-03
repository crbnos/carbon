import { createWorkflowCatalog } from "@carbon/workflows";
import { WORKFLOW_LABELS } from "@carbon/workflows/labels";
import { useLingui } from "@lingui/react";

/** One instance for the whole builder; the catalog is immutable committed data. */
export const catalog = createWorkflowCatalog();

/** Translates a catalog label key; falls back to the key's last segment when absent. */
export function useWorkflowLabel(): (key: string, fallback?: string) => string {
  const { i18n } = useLingui();
  return (key: string, fallback?: string) => {
    const descriptor = WORKFLOW_LABELS[key as keyof typeof WORKFLOW_LABELS];
    if (descriptor === undefined) {
      return fallback ?? key.split(".").pop() ?? key;
    }
    return i18n._(descriptor);
  };
}

export {
  actionInputLabelKey,
  describeValueType,
  describeVariable,
  entityLabelKey,
  operationInputLabelKey,
  propertyLabelKey
} from "./labelKeys";
