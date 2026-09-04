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
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@carbon/react";
import type { ValueOrRef, ValueType, WorkflowCatalog } from "@carbon/workflows";
import {
  isMultiSelect,
  MAX_LIST_ITEMS,
  WORKFLOW_ACTION_CATALOG,
  WORKFLOW_ENTITY_REGISTRY
} from "@carbon/workflows";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import { LuCheck, LuChevronsUpDown, LuListOrdered } from "react-icons/lu";
import {
  actionInputLabelKey,
  entityLabelKey,
  useWorkflowCatalog,
  useWorkflowLabel,
  workflowFieldHelp
} from "../../catalog";
import { useBuilderStore } from "../../context";
import { lockedChoices, useChoiceOptions } from "../../fields/choiceOptions";
import { MultiChoiceField } from "../../fields/MultiChoiceField";
import { PairsField } from "../../fields/PairsField";
import { TemplateField } from "../../fields/TemplateField";
import { ValueField } from "../../fields/ValueField";
import {
  issueForField,
  partIssuesForField,
  rowIssuesForField
} from "../../issues";
import { useActionBatchPlan, useAvailableVariables } from "../../useDefinition";
import { FormStack, Section } from "../layout";
import type { NodeFormProps } from "./index";

/** Module-level, not an inline literal: it reaches the variable menu as `accepts`,
 * which memoises on identity. */
const STRING_TYPE: ValueType = { kind: "primitive", of: "string" };

// ── helpers ───────────────────────────────────────────────────────────────────

type Gate = { input: string; equals: readonly string[] } | undefined;

/** Whether a gated input applies right now. Literals only: a gate whose target holds a
 * variable cannot be read here, so it opens rather than hide work the user has done. */
function isGateOpen(gate: Gate, inputs: Record<string, ValueOrRef>): boolean {
  if (gate === undefined) return true;
  const target = inputs[gate.input];
  if (target?.kind !== "literal") return true;
  if (typeof target.value !== "string") return true;
  return gate.equals.includes(target.value);
}

function seededInputs(
  actionId: string,
  catalog: WorkflowCatalog
): Record<string, ValueOrRef> {
  const seeded: Record<string, ValueOrRef> = {};
  const def = catalog.getAction(actionId);
  for (const [name, input] of Object.entries(def?.inputs ?? {})) {
    if (input.defaultValue === undefined) continue;
    seeded[name] = {
      kind: "literal",
      type: input.type,
      value: input.defaultValue
    };
  }
  return seeded;
}

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
  isReadOnly?: boolean;
};

function ActionPicker({
  selected,
  onSelect,
  upstreamEntities,
  label,
  isReadOnly
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
          disabled={isReadOnly}
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
          <CommandInput
            placeholder={t`Search actions…`}
            disabled={isReadOnly}
          />
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
                    disabled={isReadOnly}
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
  isReadOnly?: boolean;
};

/** The only hand-written field: notify names its subject in two loose strings because
 * the value model has no "any record" type. Not a pattern. */
function NotifyAboutField({
  nodeId,
  inputs,
  onInputChange,
  inLoop,
  isReadOnly
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
      <Select
        value={aboutType ?? ""}
        onValueChange={handleTypeChange}
        disabled={isReadOnly}
      >
        <SelectTrigger className="w-full" disabled={isReadOnly}>
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
          type={STRING_TYPE}
          value={aboutId}
          onChange={(v) => onInputChange("aboutId", v)}
          context={{ nodeId, inLoop }}
          isReadOnly={isReadOnly}
        />
      )}
    </div>
  );
}

// ── ActionForm ────────────────────────────────────────────────────────────────

export function ActionForm({
  node,
  issues,
  isReadOnly
}: NodeFormProps<"action">) {
  const updateNodeData = useBuilderStore((s) => s.updateNodeData);
  const label = useWorkflowLabel();
  const catalog = useWorkflowCatalog();
  const choiceOptions = useChoiceOptions();

  const { action: actionId, inputs } = node.data;

  const actionDef = actionId ? catalog.getAction(actionId) : undefined;

  // A custom-field input has no translated key — fall back to the customer's own name.
  const inputLabel = (name: string) =>
    label(
      actionInputLabelKey(actionId, name),
      catalog.getInputLabel(actionId, name) ?? name
    );

  const batch = useActionBatchPlan(node.id, actionId, inputs);
  const isBatch = batch.kind === "repeats";

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

  // Each group's own block renders its active member, so the ordinary Inputs list skips them all.
  const groupOwnedInputs = useMemo(
    () => new Set((actionDef?.requireOneOf ?? []).flat()),
    [actionDef]
  );

  // The about inputs are handled by NotifyAboutField, skip them in the normal loop
  const isNotify = actionId === "notify";
  const skipInputs = new Set(isNotify ? ["aboutId", "aboutType"] : []);

  // ── event handlers ──────────────────────────────────────────────────────────

  function handleActionSelect(id: string) {
    updateNodeData(node.id, { action: id, inputs: seededInputs(id, catalog) });
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
    // A value whose gate just closed would still publish, so it goes with the gate.
    for (const [other, def] of Object.entries(actionDef?.inputs ?? {})) {
      if (def.showWhen?.input !== name) continue;
      if (!isGateOpen(def.showWhen, next)) delete next[other];
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
    // Also guarded in the list below; a requireOneOf member reaches here without it.
    if (!isGateOpen(inputDef.showWhen, inputs)) return null;
    const fieldLabel = inputLabel(name);
    const inputHelp = workflowFieldHelp(actionInputLabelKey(actionId, name));
    const fieldContext = {
      nodeId: node.id,
      inLoop: isBatch,
      batching: isBatch
    };
    const fieldIssue = issueForField(issues, name, `inputs.${name}`);
    const fieldParts = partIssuesForField(issues, name, `inputs.${name}`);

    if (inputDef.pairs) {
      return (
        <PairsField
          key={name}
          label={fieldLabel}
          helpTermId={inputHelp}
          type={inputDef.type}
          required={inputDef.required}
          value={inputs[name]}
          onChange={(v) => handleInputChange(name, v)}
          context={fieldContext}
          issue={fieldIssue}
          partIssues={rowIssuesForField(issues, name, `inputs.${name}`)}
          isReadOnly={isReadOnly}
        />
      );
    }

    if (isMultiSelect(inputDef)) {
      return (
        <MultiChoiceField
          key={name}
          label={fieldLabel}
          helpTermId={inputHelp}
          type={inputDef.type}
          required={inputDef.required}
          options={choiceOptions(inputDef.choices)}
          locked={lockedChoices(inputDef.choices)}
          value={inputs[name]}
          onChange={(v) => handleInputChange(name, v)}
          issue={fieldIssue}
          isReadOnly={isReadOnly}
        />
      );
    }

    if (inputDef.template) {
      return (
        <TemplateField
          key={name}
          label={fieldLabel}
          helpTermId={inputHelp}
          type={inputDef.type}
          required={inputDef.required}
          value={inputs[name]}
          onChange={(v) => handleInputChange(name, v)}
          context={fieldContext}
          issue={fieldIssue}
          partIssues={fieldParts}
          isReadOnly={isReadOnly}
        />
      );
    }

    return (
      <ValueField
        key={name}
        label={fieldLabel}
        helpTermId={inputHelp}
        type={inputDef.type}
        required={inputDef.required}
        choices={inputDef.choices}
        value={inputs[name]}
        onChange={(v) => handleInputChange(name, v)}
        context={fieldContext}
        issue={fieldIssue}
        partIssues={fieldParts}
        isReadOnly={isReadOnly}
      />
    );
  }

  /** Rendered directly under the action picker rather than with the rest: a multi-select
   * qualifies the action itself (how a notification is delivered), so it belongs beside
   * the action, not below the recipient and the message. */
  const modeInputNames = useMemo(() => {
    if (!actionDef) return [];
    return Object.entries(actionDef.inputs)
      .filter(([name, inputDef]) => {
        if (groupOwnedInputs.has(name) || skipInputs.has(name)) return false;
        return isMultiSelect(inputDef);
      })
      .map(([name]) => name);
  }, [actionDef, groupOwnedInputs, skipInputs]);

  // Sort inputs: required first, then optional (preserving catalog order within each)
  const visibleInputNames = useMemo(() => {
    if (!actionDef) return [];
    const required: string[] = [];
    const optional: string[] = [];
    for (const [name, inputDef] of Object.entries(actionDef.inputs)) {
      if (groupOwnedInputs.has(name) || skipInputs.has(name)) continue;
      if (modeInputNames.includes(name)) continue;
      if (!isGateOpen(inputDef.showWhen, inputs)) continue;
      if (inputDef.required) required.push(name);
      else optional.push(name);
    }
    return [...required, ...optional];
  }, [actionDef, groupOwnedInputs, skipInputs, modeInputNames, inputs]);

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
          isReadOnly={isReadOnly}
        />
      </div>

      {actionDef && (
        <>
          {modeInputNames.length > 0 && (
            <div className="space-y-3">
              {modeInputNames.map((name) => renderInput(name))}
            </div>
          )}

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
                    disabled={isReadOnly}
                    className={cn(
                      "flex-1 px-3 py-2 text-sm transition-colors",
                      groupSelections[i] === name
                        ? "bg-primary text-primary-foreground"
                        : "bg-background text-foreground hover:bg-muted",
                      group.indexOf(name) > 0 && "border-l"
                    )}
                    onClick={() => handleGroupSwitch(i, name)}
                  >
                    {inputLabel(name)}
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
                isReadOnly={isReadOnly}
              />
            </div>
          )}

          {/* Repeating is not a setting — it is what wiring a list into a
              single-value input means. So this reports, it does not ask. */}
          {batch.kind === "repeats" && (
            <div className="flex items-start gap-2 rounded-md border bg-muted/50 p-3 text-sm">
              <LuListOrdered className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <p className="text-muted-foreground">
                <Trans>
                  A list is wired into {inputLabel(batch.input)}, so this step
                  runs once for each item in it — up to {MAX_LIST_ITEMS}.
                </Trans>
              </p>
            </div>
          )}

          {batch.kind === "ambiguous" && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
              <LuListOrdered className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <p className="text-destructive">
                <Trans>
                  Lists are wired into both {inputLabel(batch.first)} and{" "}
                  {inputLabel(batch.second)}, so this step cannot tell which one
                  to repeat over. Leave a list on only one of them.
                </Trans>
              </p>
            </div>
          )}
        </>
      )}
    </FormStack>
  );
}
