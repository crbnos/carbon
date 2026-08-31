import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  cn,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@carbon/react";

import type { Clause, DataOperation, ValueType } from "@carbon/workflows";
import { DATA_OPERATIONS, operationOf } from "@carbon/workflows";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import { LuChevronDown, LuPlus } from "react-icons/lu";
import { describeValueType, useWorkflowCatalog } from "../../catalog";
import { useBuilderStore } from "../../context";
import { useDataOperationLabel } from "../../dataOperationLabels";
import { useAvailableVariables } from "../../useDefinition";
import ClauseRow from "../ClauseRow";
import { CombinatorToggle } from "../CombinatorToggle";
import { FormStack, Section } from "../layout";
import type { NodeFormProps } from "./index";

const newClause = (): Clause => ({
  left: {
    kind: "literal",
    type: { kind: "primitive", of: "string" },
    value: ""
  },
  operator: "eq",
  right: {
    kind: "literal",
    type: { kind: "primitive", of: "string" },
    value: ""
  }
});

export function FilterForm({
  node,
  issues,
  isReadOnly
}: NodeFormProps<"filter">) {
  const updateNodeData = useBuilderStore((s) => s.updateNodeData);
  const catalog = useWorkflowCatalog();
  const { t } = useLingui();

  const { source, combinator, clauses, field, flatten } = node.data;
  // `operationOf` is the SAME fallback the node kind uses, so the form and the
  // validator can never disagree about which operation a raw node is running.
  const operationLabel = useDataOperationLabel();
  const operation = operationOf(node.data.operation);
  const spec = DATA_OPERATIONS[operation];

  const [sourceOpen, setSourceOpen] = useState(false);

  // Every operation works through a list; what the list HOLDS may now be an object.
  const vars = useAvailableVariables(node.id);
  const listVars = useMemo(
    () => vars.filter((v) => v.type.kind === "list"),
    [vars]
  );

  const sourceVar = source
    ? listVars.find(
        (v) => v.nodeId === source.nodeId && v.output === source.output
      )
    : undefined;

  // Resolve item entity name for the heading
  const itemType =
    sourceVar?.type.kind === "list" ? sourceVar.type.of : undefined;
  const entityName = itemType?.kind === "entity" ? itemType.of : undefined;

  // A new source means new items: a clause and a field were both written against
  // the OLD element type, so keeping them leaves the node red over a choice the
  // author never made, pointing at a field the picker no longer offers.
  const handleSourceSelect = (nodeId: string, output: string) => {
    updateNodeData(node.id, {
      source: { kind: "ref", nodeId, output, path: [] },
      clauses: [],
      field: undefined,
      flatten: false
    });
    setSourceOpen(false);
  };

  const handleClearSource = () => {
    updateNodeData(node.id, {
      source: undefined,
      clauses: [],
      field: undefined
    });
  };

  // Switching operation drops what only made sense for the old one: a clause means
  // nothing to `count`, and a field means nothing outside `pluck`.
  const handleOperationChange = (next: string) => {
    const chosen = next as DataOperation;
    if (chosen === operation) return;
    updateNodeData(node.id, {
      operation: chosen,
      ...(DATA_OPERATIONS[chosen].usesClauses ? {} : { clauses: [] }),
      ...(DATA_OPERATIONS[chosen].usesField
        ? {}
        : { field: undefined, flatten: false })
    });
  };

  // Which fields a `pluck` may take, read off the element type the source holds.
  const fieldChoices = useMemo(() => {
    // A list of Carbon records can be plucked too — its fields come from the
    // catalog rather than the type. Offering only object fields left `pluck` over
    // a lookup's results validating but with nothing to choose.
    if (itemType?.kind === "entity") {
      const entity = catalog.getEntity(itemType.of);
      return Object.entries(entity?.properties ?? {}).map(([name, type]) => ({
        path: name,
        type
      }));
    }
    if (itemType?.kind !== "record") return [];
    const found: { path: string; type: ValueType }[] = [];
    const walk = (fields: Record<string, ValueType>, prefix: string[]) => {
      for (const [name, type] of Object.entries(fields)) {
        const path = [...prefix, name];
        found.push({ path: path.join("."), type });
        // One hop of nesting is enough to reach `organizer.email`; deeper paths
        // are reachable by chaining a second data node.
        if (type.kind === "record" && prefix.length === 0) {
          walk(type.fields, path);
        }
      }
    };
    walk(itemType.fields, []);
    return found;
  }, [itemType, catalog]);

  const handleFieldChange = (next: string) => {
    const chosen = fieldChoices.find((option) => option.path === next);
    updateNodeData(node.id, {
      field: next,
      // A list-valued field can ONLY be taken flat: `list<list<T>>` cannot exist,
      // so the choice is made here rather than offered as a toggle that can be wrong.
      flatten: chosen?.type.kind === "list"
    });
  };

  function handleClauseChange(index: number, patch: Partial<Clause>) {
    updateNodeData(node.id, {
      clauses: clauses.map((c, i) => (i === index ? { ...c, ...patch } : c))
    });
  }

  function handleClauseRemove(index: number) {
    updateNodeData(node.id, {
      clauses: clauses.filter((_, i) => i !== index)
    });
  }

  const handleAddClause = () => {
    updateNodeData(node.id, { clauses: [...clauses, newClause()] });
  };

  const context = { nodeId: node.id, inLoop: true };

  return (
    <FormStack spacing={4}>
      <div className="space-y-1">
        <Section>
          <Trans>Operation</Trans>
        </Section>
        {/* Built from DATA_OPERATIONS, never a second list: the same table drives
            the stored enum, the output type and the runtime. */}
        <Select
          value={operation}
          onValueChange={handleOperationChange}
          disabled={isReadOnly}
        >
          <SelectTrigger className="w-full" disabled={isReadOnly}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.keys(DATA_OPERATIONS).map((name) => (
              <SelectItem key={name} value={name}>
                {operationLabel(name as DataOperation)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Source list picker */}
      <div className="space-y-1">
        <Section>
          <Trans>Source list</Trans>
        </Section>

        <Popover open={sourceOpen} onOpenChange={setSourceOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={isReadOnly}
              className="flex w-full items-center justify-between rounded-md border bg-background px-3 py-2 text-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                className={cn("truncate", !source && "text-muted-foreground")}
              >
                {sourceVar
                  ? `${sourceVar.nodeName} › ${sourceVar.output}`
                  : t`Pick a list variable…`}
              </span>
              <LuChevronDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-[var(--radix-popover-trigger-width)] min-w-[260px] p-0"
            onWheel={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
          >
            <Command>
              <CommandInput
                placeholder={t`Search list variables…`}
                disabled={isReadOnly}
              />
              <CommandList className="max-h-64 overflow-y-auto">
                <CommandEmpty>
                  <Trans>No list variables available upstream.</Trans>
                </CommandEmpty>
                <CommandGroup>
                  {listVars.map((v) => (
                    <CommandItem
                      key={`${v.nodeId}:${v.output}`}
                      value={`${v.nodeName} ${v.output} ${describeValueType(v.type)}`}
                      disabled={isReadOnly}
                      onSelect={() => handleSourceSelect(v.nodeId, v.output)}
                      className="flex flex-col items-start gap-0.5 px-3 py-2"
                    >
                      <span className="text-sm font-medium">{v.output}</span>
                      <span className="text-xs text-muted-foreground">
                        {v.nodeName} · {describeValueType(v.type)}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {source && (
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
            onClick={handleClearSource}
            disabled={isReadOnly}
          >
            <Trans>Clear</Trans>
          </button>
        )}
      </div>

      {/* Which field to take — `pluck` only. */}
      {source && spec.usesField && (
        <div className="space-y-1">
          <Section>
            <Trans>Field</Trans>
          </Section>
          {fieldChoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              <Trans>The items in that list have no fields to take.</Trans>
            </p>
          ) : (
            <Select
              value={field ?? ""}
              onValueChange={handleFieldChange}
              disabled={isReadOnly}
            >
              <SelectTrigger className="w-full" disabled={isReadOnly}>
                <SelectValue placeholder={t`Pick a field…`} />
              </SelectTrigger>
              <SelectContent>
                {fieldChoices.map((option) => (
                  <SelectItem key={option.path} value={option.path}>
                    {option.path}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {flatten && (
            <p className="text-xs text-muted-foreground">
              <Trans>
                That field holds several values, so they are combined into one
                list.
              </Trans>
            </p>
          )}
        </div>
      )}

      {/* Clause section — filtering only; another operation stores no clauses */}
      {source && spec.usesClauses && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Section>
              {entityName
                ? t`Keep only the ${entityName} where…`
                : t`Keep only items where…`}
            </Section>

            {/* Combinator toggle */}
            <CombinatorToggle
              value={combinator}
              onChange={(v) => updateNodeData(node.id, { combinator: v })}
              isReadOnly={isReadOnly}
            />
          </div>

          {clauses.map((clause, i) => (
            <div key={i}>
              <ClauseRow
                clause={clause}
                index={i}
                canRemove={clauses.length > 1}
                onChange={handleClauseChange}
                onRemove={handleClauseRemove}
                context={context}
                fieldPath={`clauses.${i}`}
                issues={issues}
                isReadOnly={isReadOnly}
              />
              {i < clauses.length - 1 && (
                <div className="flex justify-center py-1">
                  <CombinatorToggle
                    value={combinator}
                    onChange={(v) => updateNodeData(node.id, { combinator: v })}
                    isReadOnly={isReadOnly}
                  />
                </div>
              )}
            </div>
          ))}

          <Button
            type="button"
            variant="secondary"
            size="sm"
            leftIcon={<LuPlus />}
            onClick={handleAddClause}
            isDisabled={isReadOnly}
          >
            <Trans>Add rule</Trans>
          </Button>
        </div>
      )}
    </FormStack>
  );
}
