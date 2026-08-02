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
  VStack
} from "@carbon/react";

import type { Clause, VariableRef } from "@carbon/workflows";
import { availableVariables } from "@carbon/workflows";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import { LuChevronDown, LuPlus } from "react-icons/lu";
import { catalog, describeValueType } from "../../catalog";
import { useBuilderStore } from "../../context";
import { fromReactFlow } from "../../graph";
import ClauseRow, { CLAUSE_GRID_CLASS } from "../ClauseRow";
import { CombinatorToggle } from "../CombinatorToggle";
import type { NodeFormProps } from "./index";

const SECTION =
  "text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

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

export function FilterForm({ node }: NodeFormProps) {
  const updateNodeData = useBuilderStore((s) => s.updateNodeData);
  const nodes = useBuilderStore((s) => s.nodes);
  const edges = useBuilderStore((s) => s.edges);
  const { t } = useLingui();

  const data = node.data as {
    source?: VariableRef;
    combinator: "and" | "or";
    clauses: Clause[];
  };

  const source = data.source;
  const combinator = data.combinator ?? "and";
  const clauses = (data.clauses ?? []) as Clause[];

  const [sourceOpen, setSourceOpen] = useState(false);

  // Only list-type variables are valid sources
  const listVars = useMemo(() => {
    const definition = fromReactFlow(nodes, edges);
    const vars = availableVariables(definition, node.id, catalog);
    return vars.filter((v) => v.type.kind === "list");
  }, [nodes, edges, node.id]);

  const sourceVar = source
    ? listVars.find(
        (v) => v.nodeId === source.nodeId && v.output === source.output
      )
    : undefined;

  // Resolve item entity name for the heading
  const itemType =
    sourceVar?.type.kind === "list" ? sourceVar.type.of : undefined;
  const entityName = itemType?.kind === "entity" ? itemType.of : undefined;

  const handleSourceSelect = (nodeId: string, output: string) => {
    updateNodeData(node.id, {
      source: { kind: "ref", nodeId, output, path: [] }
    });
    setSourceOpen(false);
  };

  const handleClearSource = () => {
    updateNodeData(node.id, { source: undefined, clauses: [] });
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
    <VStack spacing={4}>
      {/* Source list picker */}
      <div className="space-y-1">
        <div className={SECTION}>
          <Trans>Source list</Trans>
        </div>

        <Popover open={sourceOpen} onOpenChange={setSourceOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
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
              <CommandInput placeholder={t`Search list variables…`} />
              <CommandList className="max-h-64 overflow-y-auto">
                <CommandEmpty>
                  <Trans>No list variables available upstream.</Trans>
                </CommandEmpty>
                <CommandGroup>
                  {listVars.map((v) => (
                    <CommandItem
                      key={`${v.nodeId}:${v.output}`}
                      value={`${v.nodeName} ${v.output} ${describeValueType(v.type)}`}
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
          >
            <Trans>Clear</Trans>
          </button>
        )}
      </div>

      {/* Clause section — only shown once a source is chosen */}
      {source && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className={SECTION}>
              {entityName
                ? t`Keep only the ${entityName} where…`
                : t`Keep only items where…`}
            </div>

            {/* Combinator toggle */}
            <CombinatorToggle
              value={combinator}
              onChange={(v) => updateNodeData(node.id, { combinator: v })}
            />
          </div>

          {clauses.length > 0 && (
            <div className={CLAUSE_GRID_CLASS}>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground pl-3">
                <Trans>Input</Trans>
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                <Trans>Operator</Trans>
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                <Trans>Value</Trans>
              </span>
            </div>
          )}
          {clauses.map((clause, i) => (
            <div key={i}>
              <ClauseRow
                clause={clause}
                index={i}
                canRemove={clauses.length > 1}
                onChange={handleClauseChange}
                onRemove={handleClauseRemove}
                context={context}
              />
              {i < clauses.length - 1 && (
                <div className="flex justify-center py-1">
                  <CombinatorToggle
                    value={combinator}
                    onChange={(v) => updateNodeData(node.id, { combinator: v })}
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
          >
            <Trans>Add rule</Trans>
          </Button>
        </div>
      )}
    </VStack>
  );
}
