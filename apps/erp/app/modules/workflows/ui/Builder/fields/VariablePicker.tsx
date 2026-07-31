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
import type {
  ItemRef,
  ValueType,
  VariableRef,
  WorkflowCatalog
} from "@carbon/workflows";
import { availableVariables, typesEqual } from "@carbon/workflows";
import { useState } from "react";
import { LuArrowLeft, LuChevronRight } from "react-icons/lu";
import {
  catalog,
  describeValueType,
  propertyLabelKey,
  useWorkflowLabel
} from "../catalog";
import { useBuilderStore } from "../context";
import { fromReactFlow } from "../graph";

type DrillState = {
  nodeId: string;
  output: string;
  path: string[];
} | null;

type VariablePickerProps = {
  accepts: ValueType;
  acceptsAny?: boolean;
  nodeId: string;
  inLoop: boolean;
  value: VariableRef | ItemRef | undefined;
  onChange: (next: VariableRef | ItemRef) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
};

/** Resolves a property path through entity types using the catalog. */
function walkType(
  type: ValueType,
  path: string[],
  cat: WorkflowCatalog
): ValueType | undefined {
  let current = type;
  for (const segment of path) {
    if (current.kind !== "entity") return undefined;
    const entity = cat.getEntity(current.of);
    if (!entity) return undefined;
    const next = entity.properties[segment];
    if (!next) return undefined;
    current = next;
  }
  return current;
}

export function VariablePicker({
  accepts,
  acceptsAny,
  nodeId,
  inLoop,
  onChange,
  open,
  onOpenChange,
  children
}: VariablePickerProps) {
  const nodes = useBuilderStore((s) => s.nodes);
  const edges = useBuilderStore((s) => s.edges);
  const label = useWorkflowLabel();
  const [drill, setDrill] = useState<DrillState>(null);

  const definition = fromReactFlow(nodes, edges);
  const variables = availableVariables(definition, nodeId, catalog);

  // Group by nodeTitle (preserving insertion order from availableVariables)
  const groups = new Map<string, typeof variables>();
  for (const v of variables) {
    if (!groups.has(v.nodeTitle)) groups.set(v.nodeTitle, []);
    groups.get(v.nodeTitle)!.push(v);
  }

  const isCompatible = (type: ValueType): boolean =>
    acceptsAny ? true : typesEqual(type, accepts);

  function incompatibilityReason(type: ValueType): string | undefined {
    if (isCompatible(type)) return undefined;
    return `This is ${describeValueType(type)}; this field takes ${describeValueType(accepts)}.`;
  }

  function selectRef(nId: string, output: string, path: string[]) {
    onChange({ kind: "ref", nodeId: nId, output, path });
    onOpenChange(false);
    setDrill(null);
  }

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) setDrill(null);
  }

  // ── Drilled view: properties of a specific entity ──────────────────────────

  const drillContent = (() => {
    if (!drill) return null;
    const v = variables.find(
      (vv) => vv.nodeId === drill.nodeId && vv.output === drill.output
    );
    if (!v) return null;

    const currentType = walkType(v.type, drill.path, catalog);
    if (!currentType || currentType.kind !== "entity") return null;

    const entity = catalog.getEntity(currentType.of);
    if (!entity) return null;

    // After one drill, the selected path has length drill.path.length + 1.
    // We allow further drilling only if drill.path.length + 1 < 2 (cap: 2 hops total).
    const canDrillDeeper = drill.path.length === 0;

    const breadcrumb = [v.nodeTitle, v.output, ...drill.path].join(" › ");

    return (
      <>
        <button
          type="button"
          className="flex w-full items-center gap-1.5 border-b border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={() =>
            drill.path.length === 0
              ? setDrill(null)
              : setDrill({ ...drill, path: drill.path.slice(0, -1) })
          }
        >
          <LuArrowLeft className="h-3 w-3 shrink-0" />
          <span className="truncate">{breadcrumb}</span>
        </button>
        <CommandGroup>
          {Object.entries(entity.properties).map(([prop, propType]) => {
            const selectionPath = [...drill.path, prop];
            const compat = isCompatible(propType);
            const reason = incompatibilityReason(propType);
            // Only drill deeper if: prop is entity, not yet compatible, and within cap
            const canDrillProp =
              canDrillDeeper && propType.kind === "entity" && !compat;
            const clickable = compat || canDrillProp;
            const subDesc = reason
              ? reason
              : !v.guaranteed
                ? `${describeValueType(propType)} · may be empty on this path`
                : describeValueType(propType);

            return (
              <CommandItem
                key={prop}
                value={`${drill.nodeId}:${drill.output}:${selectionPath.join(":")}`}
                disabled={!clickable}
                onSelect={() => {
                  if (canDrillProp) {
                    setDrill({ ...drill, path: selectionPath });
                  } else if (compat) {
                    selectRef(drill.nodeId, drill.output, selectionPath);
                  }
                }}
                className="flex items-center gap-2 px-3 py-2"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span
                    className={cn(
                      "truncate text-sm",
                      !clickable && "opacity-50"
                    )}
                  >
                    {label(propertyLabelKey(currentType.of, prop), prop)}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {subDesc}
                  </span>
                </span>
                {canDrillProp && (
                  <LuChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
              </CommandItem>
            );
          })}
        </CommandGroup>
      </>
    );
  })();

  // ── Root variable list ──────────────────────────────────────────────────────

  const rootContent = (
    <>
      {[...groups.entries()].map(([nodeTitle, vars]) => (
        <CommandGroup key={nodeTitle} heading={nodeTitle}>
          {vars.map((v) => {
            const compat = isCompatible(v.type);
            const reason = incompatibilityReason(v.type);
            // Entity that isn't directly compatible is drillable
            const isDrillable = v.type.kind === "entity" && !compat;
            const clickable = compat || isDrillable;
            const subDesc = reason
              ? reason
              : !v.guaranteed
                ? `${describeValueType(v.type)} · may be empty on this path`
                : describeValueType(v.type);

            return (
              <CommandItem
                key={`${v.nodeId}:${v.output}`}
                value={`${v.nodeTitle} ${v.output} ${describeValueType(v.type)}`}
                disabled={!clickable}
                onSelect={() => {
                  if (isDrillable) {
                    setDrill({ nodeId: v.nodeId, output: v.output, path: [] });
                  } else if (compat) {
                    selectRef(v.nodeId, v.output, []);
                  }
                }}
                className="flex items-center gap-2 px-3 py-2"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span
                    className={cn(
                      "truncate text-sm font-medium",
                      !clickable && "opacity-50"
                    )}
                  >
                    {v.output}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {subDesc}
                  </span>
                </span>
                {isDrillable && (
                  <LuChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
              </CommandItem>
            );
          })}
        </CommandGroup>
      ))}

      {/* Pseudo-variables */}
      <CommandGroup heading="Special">
        {inLoop && (
          <CommandItem
            value="the current item"
            onSelect={() => {
              onChange({ kind: "item", path: [] });
              onOpenChange(false);
            }}
            className="flex items-center gap-2 px-3 py-2"
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium">
                The current item
              </span>
              <span className="truncate text-xs text-muted-foreground">
                the item in the current loop
              </span>
            </span>
          </CommandItem>
        )}
        <CommandItem
          value="now"
          disabled
          className="flex items-center gap-2 px-3 py-2"
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium opacity-50">Now</span>
            <span className="truncate text-xs text-muted-foreground">
              Not available yet
            </span>
          </span>
        </CommandItem>
        <CommandItem
          value="the workflows owner"
          disabled
          className="flex items-center gap-2 px-3 py-2"
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium opacity-50">
              {"The workflow's owner"}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              Not available yet
            </span>
          </span>
        </CommandItem>
      </CommandGroup>
    </>
  );

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="start"
        onWheel={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        className="w-[var(--radix-popover-trigger-width)] min-w-[320px] p-0"
      >
        <Command>
          {!drill && (
            <CommandInput placeholder="Search variables…" className="h-10" />
          )}
          <CommandList
            className="max-h-[320px] overflow-y-auto overscroll-contain"
            onWheel={(e) => e.stopPropagation()}
          >
            <CommandEmpty>No variables available.</CommandEmpty>
            {drill ? drillContent : rootContent}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
