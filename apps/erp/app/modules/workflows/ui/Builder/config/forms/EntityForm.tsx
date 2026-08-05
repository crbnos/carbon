import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  cn,
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@carbon/react";
import type { ValueOrRef } from "@carbon/workflows";
import { WORKFLOW_OPERATION_CATALOG } from "@carbon/workflows";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import { LuCheck, LuChevronsUpDown, LuListOrdered } from "react-icons/lu";
import {
  catalog,
  describeValueType,
  entityLabelKey,
  operationInputLabelKey,
  useWorkflowLabel,
  workflowFieldHelp
} from "../../catalog";
import { useBuilderStore } from "../../context";
import { ValueField } from "../../fields/ValueField";
import { issueForField, partIssuesForField } from "../../issues";
import { useEntityBatchInput } from "../../useDefinition";
import { FormStack, Section } from "../layout";
import type { NodeFormProps } from "./index";

// ── OperationPicker ───────────────────────────────────────────────────────────

type OperationPickerProps = {
  selected: string;
  onSelect: (id: string) => void;
  label: (key: string, fallback?: string) => string;
};

function OperationPicker({ selected, onSelect, label }: OperationPickerProps) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);

  // Group by entity, preserving insertion order
  const groups = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const [id, op] of Object.entries(WORKFLOW_OPERATION_CATALOG)) {
      if (!map.has(op.entity)) map.set(op.entity, []);
      map.get(op.entity)!.push(id);
    }
    return Array.from(map.entries()).sort(([a], [b]) =>
      label(entityLabelKey(a), a).localeCompare(label(entityLabelKey(b), b))
    );
  }, [label]);

  const displayLabel = selected ? label(selected) : t`Select an operation…`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between rounded-md border bg-background px-3 py-2 text-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            className={cn("truncate", !selected && "text-muted-foreground")}
          >
            {displayLabel}
          </span>
          <LuChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[340px] p-0"
        onWheel={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        <Command>
          <CommandInput placeholder={t`Search operations…`} />
          <CommandList className="max-h-64 overflow-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent">
            <CommandEmpty>
              <Trans>No operations found.</Trans>
            </CommandEmpty>
            {groups.map(([entity, ids]) => (
              <CommandGroup
                key={entity}
                heading={label(entityLabelKey(entity), entity)}
              >
                {ids.map((id) => (
                  <CommandItem
                    key={id}
                    value={`${id} ${label(id)}`}
                    onSelect={() => {
                      onSelect(id);
                      setOpen(false);
                    }}
                  >
                    <LuCheck
                      className={cn(
                        "mr-2 h-4 w-4 shrink-0",
                        selected === id ? "opacity-100" : "opacity-0"
                      )}
                    />
                    {label(id)}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ── EntityForm ────────────────────────────────────────────────────────────────

export function EntityForm({ node, issues }: NodeFormProps<"entity">) {
  const updateNodeData = useBuilderStore((s) => s.updateNodeData);
  const label = useWorkflowLabel();

  const { operation: operationId, inputs } = node.data;

  const opDef = operationId ? catalog.getOperation(operationId) : undefined;
  const batchInput = useEntityBatchInput(node.id, operationId, inputs);

  // Inputs ordered required-first, then optional (preserving catalog order within each)
  const orderedInputNames = useMemo(() => {
    if (!opDef) return [];
    const required: string[] = [];
    const optional: string[] = [];
    for (const [name, inputDef] of Object.entries(opDef.inputs)) {
      if (inputDef.required) required.push(name);
      else optional.push(name);
    }
    return [...required, ...optional];
  }, [opDef]);

  // Output type description
  const outputDesc = opDef ? describeValueType(opDef.output) : null;

  function handleOperationSelect(id: string) {
    // Clear inputs when operation changes
    updateNodeData(node.id, { operation: id, inputs: {} });
  }

  function handleInputChange(name: string, value: ValueOrRef | undefined) {
    const next = { ...inputs };
    if (value === undefined) {
      delete next[name];
    } else {
      next[name] = value;
    }
    updateNodeData(node.id, { inputs: next });
  }

  return (
    <FormStack spacing={4}>
      {/* Operation picker */}
      <div className="space-y-1">
        <Section>
          <Trans>Operation</Trans>
        </Section>
        <OperationPicker
          selected={operationId}
          onSelect={handleOperationSelect}
          label={label}
        />
      </div>

      {opDef && orderedInputNames.length > 0 && (
        <div className="space-y-3">
          <Section>
            <Trans>Inputs</Trans>
          </Section>
          {orderedInputNames.map((name) => {
            const inputDef = opDef.inputs[name];
            if (!inputDef) return null;
            const inputLabel = label(
              operationInputLabelKey(operationId, name),
              name
            );
            const inputHelp = workflowFieldHelp(
              operationInputLabelKey(operationId, name)
            );
            return (
              <ValueField
                key={name}
                label={inputLabel}
                helpTermId={inputHelp}
                type={inputDef.type}
                required={inputDef.required}
                choices={inputDef.choices}
                value={inputs[name]}
                onChange={(v) => handleInputChange(name, v)}
                context={{ nodeId: node.id, inLoop: false }}
                issue={issueForField(issues, name, `inputs.${name}`)}
                partIssues={partIssuesForField(issues, name, `inputs.${name}`)}
              />
            );
          })}
        </div>
      )}

      {/* Batch mode note — shown when a list is wired into a single-value input */}
      {batchInput && opDef && (
        <div className="flex items-start gap-2 rounded-md border bg-muted/50 p-3 text-sm">
          <LuListOrdered className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-muted-foreground">
            <Trans>
              A list is wired into{" "}
              {label(
                operationInputLabelKey(operationId, batchInput),
                batchInput
              )}
              , so this step runs once for each item and returns a list of
              results.
            </Trans>
          </p>
        </div>
      )}

      {/* Output type hint */}
      {outputDesc && (
        <p className="text-xs text-muted-foreground">
          <Trans>Returns:</Trans>{" "}
          <span className="font-medium text-foreground">{outputDesc}</span>
        </p>
      )}
    </FormStack>
  );
}
