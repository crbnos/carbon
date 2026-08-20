import type { TermId } from "@carbon/glossary";
import type { WorkflowCatalog } from "@carbon/workflows";
import {
  buildCatalogOverlay,
  CUSTOM_FIELD_PREFIX,
  createWorkflowCatalog,
  parseCustomFieldEventId
} from "@carbon/workflows";
import { WORKFLOW_FIELD_HELP } from "@carbon/workflows/help";
import { WORKFLOW_LABELS } from "@carbon/workflows/labels";
import { useLingui } from "@lingui/react";
import { useLingui as useLinguiMacro } from "@lingui/react/macro";
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

/** Names a trigger event. A custom field has no shipped label, so the sentence is built
 * here from the customer's own field name — one resolver, so the picker, the node card
 * and the run list can never name the same trigger three ways. */
export function useWorkflowEventLabel(): (
  id: string,
  fallback?: string
) => string {
  const label = useWorkflowLabel();
  const catalog = useWorkflowCatalog();
  const { t } = useLinguiMacro();

  return (id: string, fallback?: string) => {
    const custom = parseCustomFieldEventId(id);
    if (custom === undefined) return label(id, fallback);
    const name =
      catalog.getPropertyLabel(custom.entity, custom.property) ??
      custom.property.slice(CUSTOM_FIELD_PREFIX.length);
    return t`When ${name} changes`;
  };
}

/** Custom-field property path -> the customer's own field name. A field id is unique, so
 * one map names a path segment without resolving what type it hangs off. */
export function useCustomFieldLabels(): Record<string, string> {
  const schemas = useCustomFieldsSchema();
  return useMemo(() => {
    const labels: Record<string, string> = {};
    for (const fields of Object.values(schemas)) {
      for (const field of fields ?? []) {
        labels[`${CUSTOM_FIELD_PREFIX}${field.id}`] = field.name;
      }
    }
    return labels;
  }, [schemas]);
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
