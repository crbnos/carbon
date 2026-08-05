import { Popover, PopoverAnchor, PopoverContent } from "@carbon/react";
import type { AvailableVariable } from "@carbon/workflows";
import { Trans, useLingui } from "@lingui/react/macro";
import { Handle, Position } from "@xyflow/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkflowLabel } from "./catalog";
import { useBuilderStore } from "./context";
import { handleClass, PortLabel } from "./handles";
import { describeVariable, nodeNameLabel } from "./labelKeys";
import type { BuilderPort } from "./ports";
import { selectHasEdgeFrom } from "./selectors";
import { type HandlePreview, useHandlePreviewGetter } from "./useDefinition";

const HOVER_DELAY_MS = 1000;

// Each row is two lines now, so half as many still fill the card it hangs off.
const MAX_ROWS = 8;

function OutputList({
  variables,
  routesOnly,
  labelFor
}: HandlePreview & { labelFor: (key: string, fallback?: string) => string }) {
  if (variables.length === 0) {
    return (
      <p className="p-3 text-xs text-muted-foreground">
        {routesOnly ? (
          <Trans>This path only decides what runs next</Trans>
        ) : (
          <Trans>
            Nothing yet. A step only offers values once it is configured.
          </Trans>
        )}
      </p>
    );
  }

  const shown = variables.slice(0, MAX_ROWS);
  const hidden = variables.length - shown.length;

  // Already ordered by `availableVariables`, so grouping keeps that order.
  const groups: { nodeName: string; rows: AvailableVariable[] }[] = [];
  for (const variable of shown) {
    const last = groups[groups.length - 1];
    if (last?.nodeName === variable.nodeName) last.rows.push(variable);
    else groups.push({ nodeName: variable.nodeName, rows: [variable] });
  }

  return (
    <div className="max-h-72 overflow-y-auto p-1">
      {groups.map((group) => (
        <div key={group.nodeName} className="px-2 py-1.5">
          <div className="text-[10px] font-semibold text-muted-foreground">
            {nodeNameLabel(group.nodeName)}
          </div>
          {group.rows.map((row) => (
            <div key={row.output} className="pt-0.5">
              {/* Mono, because this is the name the customer types into a field. */}
              <div className="truncate font-mono text-xs text-foreground">
                {row.output}
              </div>
              {/* Wraps rather than truncates: "may be empty on this path" is the
                  half a customer most needs and would be the half cut off. */}
              <div className="text-[10px] leading-snug text-muted-foreground">
                {describeVariable(row.type, row.guaranteed, labelFor)}
              </div>
            </div>
          ))}
        </div>
      ))}
      {hidden > 0 && (
        <div className="px-2 py-1 text-[10px] text-muted-foreground">
          <Trans>and {hidden} more</Trans>
        </div>
      )}
    </div>
  );
}

/**
 * A source handle that previews what a step wired to it could read. The list is
 * built on hover, not on render — it changes with every edit to the graph.
 */
export function OutputHandle({
  nodeId,
  port,
  showLabel = true
}: {
  nodeId: string;
  port: BuilderPort;
  showLabel?: boolean;
}) {
  const { t } = useLingui();
  const labelFor = useWorkflowLabel();
  const isConnected = useBuilderStore(selectHasEdgeFrom(nodeId, port.id));
  const anchor = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [preview, setPreview] = useState<HandlePreview | null>(null);
  const getPreview = useHandlePreviewGetter(nodeId, port.id);

  const close = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setPreview(null);
  }, []);

  useEffect(() => close, [close]);

  const open = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setPreview(getPreview()), HOVER_DELAY_MS);
  }, [getPreview]);

  return (
    <Popover open={preview !== null}>
      <PopoverAnchor virtualRef={anchor} />
      <Handle
        ref={anchor}
        type="source"
        position={Position.Right}
        id={port.id}
        aria-label={port.label}
        className={handleClass(port.tone)}
        onMouseEnter={open}
        onMouseLeave={close}
      />
      {showLabel && (
        <PortLabel label={port.label} tone={port.tone} lifted={isConnected} />
      )}
      <PopoverContent
        side="right"
        align="center"
        sideOffset={8}
        // Never interactive: taking the pointer would count as leaving the handle,
        // and the panel would close the instant you tried to reach it.
        className="pointer-events-none w-72 p-0"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="border-b px-3 py-2 text-[11px] font-semibold text-foreground">
          {t`Available after ${port.label}`}
        </div>
        <OutputList
          variables={preview?.variables ?? []}
          routesOnly={preview?.routesOnly ?? false}
          labelFor={labelFor}
        />
      </PopoverContent>
    </Popover>
  );
}
