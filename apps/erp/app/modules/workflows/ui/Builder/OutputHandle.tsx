import { Popover, PopoverAnchor, PopoverContent } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Handle, Position } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkflowLabel } from "./catalog";
import { useBuilderStore } from "./context";
import { handleClass, PortLabel } from "./handles";
import { createHoverIntent } from "./hoverIntent";
import { describeVariable, nodeNameLabel } from "./labelKeys";
import { fieldsOf, groupOutputs, MAX_FIELDS } from "./outputPreview";
import type { BuilderPort } from "./ports";
import { selectHasEdgeFrom } from "./selectors";
import { type HandlePreview, useHandlePreviewGetter } from "./useDefinition";

const HOVER_DELAY_MS = 500;

/** How long the panel survives after the pointer leaves — long enough to cross the
 * gap between the handle and the panel, short enough not to linger. */
const CLOSE_DELAY_MS = 220;

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

  const groups = groupOutputs(variables);

  return (
    // `pointer-events-auto` re-enables interaction the panel disables wholesale, so
    // a long list can be scrolled; `onWheel` keeps that scroll off the canvas, which
    // would otherwise zoom underneath it.
    <div
      className="pointer-events-auto max-h-80 overflow-y-auto overscroll-contain p-1"
      onWheel={(event) => event.stopPropagation()}
    >
      {groups.map((group, index) => (
        <div
          key={group.nodeName}
          className={
            index > 0 ? "mt-1 border-t px-2 py-1.5 pt-2" : "px-2 py-1.5"
          }
        >
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
              {(() => {
                const fields = fieldsOf(row.type);
                if (fields.length === 0) return null;
                const shownFields = fields.slice(0, MAX_FIELDS);
                const more = fields.length - shownFields.length;
                return (
                  <div className="truncate font-mono text-[10px] leading-snug text-muted-foreground/80">
                    {shownFields.join(", ")}
                    {more > 0 ? `, +${more}` : ""}
                  </div>
                );
              })()}
            </div>
          ))}
        </div>
      ))}
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
  const [preview, setPreview] = useState<HandlePreview | null>(null);
  const getPreview = useHandlePreviewGetter(nodeId, port.id);

  // The timing lives in `hoverIntent` so it can be tested against a hand-driven
  // clock — the panel is offset from its handle, and getting the gap between them
  // wrong is what made it unreachable.
  const previewRef = useRef(getPreview);
  previewRef.current = getPreview;

  const intent = useMemo(
    () =>
      createHoverIntent({
        openDelayMs: HOVER_DELAY_MS,
        closeDelayMs: CLOSE_DELAY_MS,
        onOpen: () => setPreview(previewRef.current()),
        onClose: () => setPreview(null),
        setTimer: (fn, ms) => setTimeout(fn, ms) as unknown as number,
        clearTimer: (id) => clearTimeout(id)
      }),
    []
  );

  const open = useCallback(() => intent.enter(), [intent]);
  const close = useCallback(() => intent.leave(), [intent]);
  const closeNow = useCallback(() => intent.dismiss(), [intent]);

  useEffect(() => () => intent.dismiss(), [intent]);

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
        // Starting a connection drag: the panel would otherwise hang over the
        // canvas the author is dragging across.
        onMouseDown={closeNow}
      />
      {showLabel && (
        <PortLabel label={port.label} tone={port.tone} lifted={isConnected} />
      )}
      <PopoverContent
        side="right"
        align="center"
        sideOffset={8}
        // The panel holds the hover open while the pointer is inside it, and
        // cancels the pending close on the way in — that grace period is what makes
        // the gap between handle and panel crossable at all.
        onMouseEnter={open}
        onMouseLeave={close}
        className="w-72 p-0"
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
