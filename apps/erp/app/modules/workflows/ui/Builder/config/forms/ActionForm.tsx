import {
  Checkbox,
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
import type { ValueOrRef, ValueType } from "@carbon/workflows";
import {
  WORKFLOW_ACTION_CATALOG,
  WORKFLOW_ENTITY_REGISTRY
} from "@carbon/workflows";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import { LuCheck, LuChevronsUpDown, LuListOrdered } from "react-icons/lu";
import {
  actionInputLabelKey,
  catalog,
  entityLabelKey,
  useWorkflowLabel
} from "../../catalog";
import { useBuilderStore } from "../../context";
import { TemplateField } from "../../fields/TemplateField";
import { ValueField } from "../../fields/ValueField";
import { useAvailableVariables } from "../../useDefinition";
import { FormStack, Section } from "../layout";
import type { NodeFormProps } from "./index";

// ── helpers ───────────────────────────────────────────────────────────────────

/** Returns 1 if all required entity inputs for this action are available upstream; 0 if not. */
function actionRank(id: string, upstream: Set<string>): number {
  const action = WORKFLOW_ACTION_CATALOG[id];
  if (!action) return 0;
  for (const input of Object.values(action.inputs)) {
    if (input.required && input.type.kind === "entity") {
      if (!upstream.has(input.type.of)) return 0;
    }
  }
  return 1;
}

// ── ActionPicker ──────────────────────────────────────────────────────────────

type ActionPickerProps = {
  selected: string;
  onSelect: (id: string) => void;
  upstreamEntities: Set<string>;
  label: (key: string) => string;
};

function ActionPicker({
  selected,
  onSelect,
  upstreamEntities,
  label
}: ActionPickerProps) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);

  const sortedIds = useMemo(
    () =>
      Object.keys(WORKFLOW_ACTION_CATALOG).sort((a, b) => {
        const ra = actionRank(a, upstreamEntities);
        const rb = actionRank(b, upstreamEntities);
        if (ra !== rb) return rb - ra;
        return a.localeCompare(b);
      }),
    [upstreamEntities]
  );

  const displayLabel = selected ? label(selected) : t`Select an action…`;

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
          <CommandInput placeholder={t`Search actions…`} />
          <CommandList className="max-h-64 overflow-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent">
            <CommandEmpty>
              <Trans>No actions found.</Trans>
            </CommandEmpty>
            <CommandGroup>
              {sortedIds.map((id) => {
                const ranked = actionRank(id, upstreamEntities) > 0;
                return (
                  <CommandItem
                    key={id}
                    value={`${id} ${label(id)}`}
                    onSelect={() => {
                      onSelect(id);
                      setOpen(false);
                    }}
                    className={cn(!ranked && "opacity-60")}
                  >
                    <LuCheck
                      className={cn(
                        "mr-2 h-4 w-4 shrink-0",
                        selected === id ? "opacity-100" : "opacity-0"
                      )}
                    />
                    {label(id)}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ── NotifyAboutField ──────────────────────────────────────────────────────────

type NotifyAboutFieldProps = {
  nodeId: string;
  inputs: Record<string, ValueOrRef>;
  onInputChange: (name: string, value: ValueOrRef | undefined) => void;
  inLoop: boolean;
};

/** The only hand-written field: notify names its subject in two loose strings because
 * the value model has no "any record" type. Not a pattern. */
function NotifyAboutField({
  nodeId,
  inputs,
  onInputChange,
  inLoop
}: NotifyAboutFieldProps) {
  const { t } = useLingui();
  const label = useWorkflowLabel();
  const entityNames = useMemo(
    () => Object.keys(WORKFLOW_ENTITY_REGISTRY).sort(),
    []
  );

  const aboutType =
    inputs.aboutType?.kind === "literal"
      ? String(inputs.aboutType.value)
      : undefined;
  const aboutId = inputs.aboutId;

  function handleTypeChange(v: string) {
    const next: ValueOrRef | undefined = v
      ? {
          kind: "literal",
          type: { kind: "primitive", of: "string" },
          value: v
        }
      : undefined;
    onInputChange("aboutType", next);
    if (aboutType !== v) onInputChange("aboutId", undefined);
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <label className="text-sm font-medium text-foreground">
        <Trans>About</Trans>
      </label>
      <Select value={aboutType ?? ""} onValueChange={handleTypeChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={t`Pick a record type…`} />
        </SelectTrigger>
        <SelectContent>
          {entityNames.map((name) => (
            <SelectItem key={name} value={name}>
              {label(entityLabelKey(name), name)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {aboutType && (
        <ValueField
          label={t`Record`}
          type={{ kind: "primitive", of: "string" }}
          value={aboutId}
          onChange={(v) => onInputChange("aboutId", v)}
          context={{ nodeId, inLoop }}
        />
      )}
    </div>
  );
}

// ── ActionForm ────────────────────────────────────────────────────────────────

export function ActionForm({ node, issues }: NodeFormProps<"action">) {
  const updateNodeData = useBuilderStore((s) => s.updateNodeData);
  const label = useWorkflowLabel();

  const { action: actionId, inputs, batch: isBatch } = node.data;

  const actionDef = actionId ? catalog.getAction(actionId) : undefined;
  const isBatchable = !!actionDef?.batchable;

  // Upstream entity types for soft-ranking the action list
  const vars = useAvailableVariables(node.id);

  const upstreamEntities = useMemo(() => {
    const types = new Set<string>();
    for (const v of vars) {
      if (v.type.kind === "entity") types.add(v.type.of);
      if (v.type.kind === "list" && v.type.of.kind === "entity")
        types.add(v.type.of.of);
    }
    return types;
  }, [vars]);

  // For each requireOneOf group, track which member is selected
  const requireOneOf = actionDef?.requireOneOf ?? [];
  const [groupSelections, setGroupSelections] = useState<
    Record<number, string>
  >(() => {
    const init: Record<number, string> = {};
    for (let i = 0; i < requireOneOf.length; i++) {
      const group = requireOneOf[i];
      if (!group) continue;
      // Pick whichever group member already has a value; default to first
      const active =
        group.find((name) => inputs[name] !== undefined) ?? group[0];
      init[i] = active ?? "";
    }
    return init;
  });

  // Hidden inputs — members of requireOneOf groups that aren't active
  const hiddenInputs = useMemo(() => {
    const hidden = new Set<string>();
    for (let i = 0; i < requireOneOf.length; i++) {
      const group = requireOneOf[i];
      if (!group) continue;
      const active = groupSelections[i];
      for (const name of group) {
        if (name !== active) hidden.add(name);
      }
    }
    return hidden;
  }, [requireOneOf, groupSelections]);

  // The about inputs are handled by NotifyAboutField, skip them in the normal loop
  const isNotify = actionId === "notify";
  const skipInputs = new Set(isNotify ? ["aboutId", "aboutType"] : []);

  // Detect list-type mismatches for batch suggestion
  const listMismatches = useMemo((): string[] => {
    if (!actionDef || isBatch) return [];
    const varMap = new Map(
      vars.map((v) => [`${v.nodeId}:${v.output}`, v.type as ValueType])
    );
    const mismatched: string[] = [];
    for (const [name, inputDef] of Object.entries(actionDef.inputs)) {
      const val = inputs[name];
      if (!val || val.kind !== "ref") continue;
      const varType = varMap.get(`${val.nodeId}:${val.output}`);
      if (!varType) continue;
      if (varType.kind === "list" && inputDef.type.kind !== "list") {
        mismatched.push(name);
      }
    }
    return mismatched;
  }, [actionDef, isBatch, vars, inputs]);

  // ── event handlers ──────────────────────────────────────────────────────────

  function handleActionSelect(id: string) {
    updateNodeData(node.id, { action: id, inputs: {}, batch: false });
    // Reset group selections for the new action
    const newDef = catalog.getAction(id);
    const newGroups = newDef?.requireOneOf ?? [];
    const init: Record<number, string> = {};
    for (let i = 0; i < newGroups.length; i++) {
      const group = newGroups[i];
      init[i] = group?.[0] ?? "";
    }
    setGroupSelections(init);
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

  function handleGroupSwitch(groupIdx: number, name: string) {
    const group = requireOneOf[groupIdx];
    if (!group) return;
    // Clear all members of this group, then set active
    const next = { ...inputs };
    for (const m of group) delete next[m];
    updateNodeData(node.id, { inputs: next });
    setGroupSelections((prev) => ({ ...prev, [groupIdx]: name }));
  }

  // ── render inputs ───────────────────────────────────────────────────────────

  function renderInput(name: string) {
    const inputDef = actionDef?.inputs[name];
    if (!inputDef) return null;
    const inputLabel = label(actionInputLabelKey(actionId, name), name);
    const fieldContext = { nodeId: node.id, inLoop: isBatch };
    const fieldIssue = issues?.find(
      (i) => i.field === name || i.field === `inputs.${name}`
    )?.message;

    if (inputDef.template) {
      return (
        <TemplateField
          key={name}
          label={inputLabel}
          type={inputDef.type}
          required={inputDef.required}
          value={inputs[name]}
          onChange={(v) => handleInputChange(name, v)}
          context={fieldContext}
        />
      );
    }

    return (
      <ValueField
        key={name}
        label={inputLabel}
        type={inputDef.type}
        required={inputDef.required}
        choices={inputDef.choices}
        value={inputs[name]}
        onChange={(v) => handleInputChange(name, v)}
        context={fieldContext}
        issue={fieldIssue}
      />
    );
  }

  // Sort inputs: required first, then optional (preserving catalog order within each)
  const visibleInputNames = useMemo(() => {
    if (!actionDef) return [];
    const required: string[] = [];
    const optional: string[] = [];
    for (const [name, inputDef] of Object.entries(actionDef.inputs)) {
      if (hiddenInputs.has(name) || skipInputs.has(name)) continue;
      if (inputDef.required) required.push(name);
      else optional.push(name);
    }
    return [...required, ...optional];
  }, [actionDef, hiddenInputs, skipInputs]);

  // ── render ──────────────────────────────────────────────────────────────────

  return (
    <FormStack spacing={4}>
      {/* Action selector */}
      <div className="space-y-1">
        <Section>
          <Trans>Action</Trans>
        </Section>
        <ActionPicker
          selected={actionId}
          onSelect={handleActionSelect}
          upstreamEntities={upstreamEntities}
          label={label}
        />
      </div>

      {actionDef && (
        <>
          {/* requireOneOf group selectors */}
          {requireOneOf.map((group, i) => (
            <div key={i} className="space-y-1">
              <Section>
                <Trans>Notify</Trans>
              </Section>
              <div className="flex overflow-hidden rounded-md border">
                {group.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className={cn(
                      "flex-1 px-3 py-2 text-sm transition-colors",
                      groupSelections[i] === name
                        ? "bg-primary text-primary-foreground"
                        : "bg-background text-foreground hover:bg-muted",
                      group.indexOf(name) > 0 && "border-l"
                    )}
                    onClick={() => handleGroupSwitch(i, name)}
                  >
                    {label(actionInputLabelKey(actionId, name), name)}
                  </button>
                ))}
              </div>
              {/* Render the active group member's input */}
              {renderInput(groupSelections[i] ?? "")}
            </div>
          ))}

          {/* Inputs */}
          {visibleInputNames.length > 0 && (
            <div className="space-y-3">
              <Section>
                <Trans>Inputs</Trans>
              </Section>
              {visibleInputNames.map(renderInput)}
            </div>
          )}

          {/* Notify about — only for the notify action */}
          {isNotify && (
            <div className="space-y-1">
              <Section>
                <Trans>Context</Trans>
              </Section>
              {/* The only hand-written field: notify names its subject in two loose strings
                  because the value model has no "any record" type. Not a pattern. */}
              <NotifyAboutField
                nodeId={node.id}
                inputs={inputs}
                onInputChange={handleInputChange}
                inLoop={isBatch}
              />
            </div>
          )}

          {/* Batch toggle — only shown for batchable actions */}
          {isBatchable && (
            <label className="nodrag nopan flex cursor-pointer items-center gap-2">
              <Checkbox
                checked={isBatch}
                onCheckedChange={(checked) =>
                  updateNodeData(node.id, { batch: checked === true })
                }
              />
              <span className="text-sm">
                <Trans>Run once per item in the list</Trans>
              </span>
            </label>
          )}

          {/* Batch: list-mismatch suggestion */}
          {!isBatch && listMismatches.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950">
              <LuListOrdered className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="flex flex-col gap-1">
                <p className="text-amber-800 dark:text-amber-200">
                  <Trans>A list is wired into this action.</Trans>
                </p>
                <button
                  type="button"
                  className="self-start text-xs font-medium text-amber-700 underline underline-offset-2 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100"
                  onClick={() => updateNodeData(node.id, { batch: true })}
                >
                  <Trans>Run once per item</Trans>
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </FormStack>
  );
}
