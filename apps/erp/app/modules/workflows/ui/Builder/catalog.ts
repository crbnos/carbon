import type { TermId } from "@carbon/glossary";
import type { WorkflowCatalog } from "@carbon/workflows";
import { buildCatalogOverlay, createWorkflowCatalog } from "@carbon/workflows";
import { WORKFLOW_FIELD_HELP } from "@carbon/workflows/help";
import { WORKFLOW_LABELS } from "@carbon/workflows/labels";
import { useLingui } from "@lingui/react";
import { useMemo } from "react";
import { useCustomFieldsSchema } from "~/hooks/useCustomFieldsSchema";

/** The company's catalog: shipped entries plus this company's custom fields.
 * There is deliberately no module singleton — a call site that forgets the hook is a
 * compile error, not a picker that quietly lists no custom fields. */
export function useWorkflowCatalog(): WorkflowCatalog {
  const schemas = useCustomFieldsSchema();
  return useMemo(() => {
    const defs = Object.entries(schemas).flatMap(([table, fields]) =>
      (fields ?? []).map((field) => ({
        table,
        id: field.id,
        name: field.name,
        dataTypeId: field.dataTypeId,
        listOptions: field.listOptions,
        active: field.active
      }))
    );
    return createWorkflowCatalog(buildCatalogOverlay(defs));
  }, [schemas]);
}

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

/** Glossary term for a catalog input key, or undefined when the field has no help. */
export function workflowFieldHelp(key: string): TermId | undefined {
  return WORKFLOW_FIELD_HELP[key];
}

export {
  actionInputLabelKey,
  describeValueType,
  entityLabelKey,
  operationInputLabelKey,
  propertyLabelKey
} from "./labelKeys";
