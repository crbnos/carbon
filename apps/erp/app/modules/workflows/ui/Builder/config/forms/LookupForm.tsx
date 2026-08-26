import { Combobox, cn } from "@carbon/react";
import type { Operator } from "@carbon/utils";
import type { Clause, LookupMatch } from "@carbon/workflows";
import { REGISTRY_ENTRIES } from "@carbon/workflows";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useMemo } from "react";
import { LuPlus } from "react-icons/lu";
import {
  describeValueType,
  entityLabelKey,
  useWorkflowLabel
} from "../../catalog";
import { useBuilderStore } from "../../context";
import ClauseRow from "../ClauseRow";
import { FormStack, Section } from "../layout";
import type { NodeFormProps } from "./index";

/** `value` is already optional on the shared match. Derived, never re-declared. */
type WorkingMatch = LookupMatch;

function matchToClause(m: WorkingMatch): Clause {
  return {
    left: {
      kind: "literal",
      type: { kind: "primitive", of: "string" },
      value: m.field
    },
    operator: m.operator,
    right: m.value
  };
}

function clauseToMatch(c: Clause): WorkingMatch {
  return {
    field:
      c.left?.kind === "literal" && typeof c.left.value === "string"
        ? c.left.value
        : "",
    operator: c.operator,
    value: c.right
  };
}

export function LookupForm({
  node,
  issues,
  isReadOnly
}: NodeFormProps<"lookup">) {
  const updateNodeData = useBuilderStore((s) => s.updateNodeData);
  const label = useWorkflowLabel();
  const { t } = useLingui();

  const { entity, returns } = node.data;
  const match: WorkingMatch[] = node.data.match;

  // Entities that have a permission (all registry entries do)
  const entityOptions = useMemo(
    () =>
      Object.entries(REGISTRY_ENTRIES)
        .map(([name]) => ({
          label: label(entityLabelKey(name), name),
          value: name
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [label]
  );

  // Output type hint
  const entityLabel = entity
    ? label(entityLabelKey(entity), entity)
    : undefined;
  const outputDesc = entityLabel
    ? returns === "one"
      ? describeValueType({ kind: "entity", of: entity }, entityLabel)
      : describeValueType(
          { kind: "list", of: { kind: "entity", of: entity } },
          entityLabel
        )
    : null;

  function handleEntityChange(name: string) {
    // Switching entity invalidates all match rows
    updateNodeData(node.id, { entity: name, match: [] });
  }

  function handleReturnsChange(r: "one" | "list") {
    updateNodeData(node.id, { returns: r });
  }

  const handleMatchChange = useCallback(
    (idx: number, patch: Partial<Clause>) => {
      const current = match[idx];
      if (!current) return;
      const updated = clauseToMatch({ ...matchToClause(current), ...patch });
      const next = match.map((m, i) => (i === idx ? updated : m));
      updateNodeData(node.id, { match: next });
    },
    [match, node.id, updateNodeData]
  );

  const handleMatchRemove = useCallback(
    (idx: number) => {
      updateNodeData(node.id, { match: match.filter((_, i) => i !== idx) });
    },
    [match, node.id, updateNodeData]
  );

  function handleAddMatch() {
    updateNodeData(node.id, {
      match: [
        ...match,
        { field: "", operator: "eq" as Operator, value: undefined }
      ]
    });
  }

  return (
    <FormStack spacing={4}>
      {/* Entity picker */}
      <div className="space-y-1">
        <Section>
          <Trans>Record type</Trans>
        </Section>
        <Combobox
          size="md"
          value={entity}
          options={entityOptions}
          onChange={handleEntityChange}
          placeholder={t`Pick a record type…`}
          isReadOnly={isReadOnly}
        />
      </div>

      {entity && (
        <>
          {/* Returns toggle */}
          <div className="space-y-1">
            <Section>
              <Trans>How many</Trans>
            </Section>
            <div className="flex overflow-hidden rounded-md border">
              <button
                type="button"
                className={cn(
                  "flex-1 px-3 py-2 text-sm transition-colors",
                  returns === "one"
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-foreground hover:bg-muted"
                )}
                onClick={() => handleReturnsChange("one")}
                disabled={isReadOnly}
              >
                <Trans>Just one</Trans>
              </button>
              <button
                type="button"
                disabled={isReadOnly}
                className={cn(
                  "flex-1 border-l px-3 py-2 text-sm transition-colors",
                  returns === "list"
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-foreground hover:bg-muted"
                )}
                onClick={() => handleReturnsChange("list")}
              >
                <Trans>Every match</Trans>
              </button>
            </div>
          </div>

          {/* Match rows */}
          <div className="space-y-2">
            <Section>
              <Trans>Match</Trans>
            </Section>
            {match.map((m, idx) => (
              <ClauseRow
                key={idx}
                clause={matchToClause(m)}
                index={idx}
                canRemove={true}
                onChange={handleMatchChange}
                onRemove={handleMatchRemove}
                context={{ nodeId: node.id, inLoop: false }}
                leftMode="column"
                entity={entity}
                fieldPath={`match.${idx}`}
                issues={issues}
                isReadOnly={isReadOnly}
              />
            ))}
            <button
              type="button"
              disabled={isReadOnly}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
              onClick={handleAddMatch}
            >
              <LuPlus className="h-3.5 w-3.5" />
              <Trans>Add match</Trans>
            </button>
          </div>

          {/* Output type hint */}
          {outputDesc && (
            <p className="text-xs text-muted-foreground">
              <Trans>Returns:</Trans>{" "}
              <span className="font-medium text-foreground">{outputDesc}</span>
            </p>
          )}
        </>
      )}
    </FormStack>
  );
}
