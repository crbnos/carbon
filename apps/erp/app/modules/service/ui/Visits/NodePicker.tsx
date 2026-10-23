// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import { LuCheck } from "react-icons/lu";
import { DateTime } from "~/components";
import { ElementTypeIcon } from "~/modules/projects/ui/Elements/ElementTypeIcon";
import { inTreeOrder } from "../../service.models";
import type { ServiceWorkNode } from "../../types";

/**
 * The work tree as an indented list to choose from. The chosen node takes
 * the next time, part and expense. Each node with a linked serial or item
 * shows when any order last serviced it. Rows are 44 px for a finger.
 */
export default function NodePicker({
  nodes,
  lastServiceDates,
  selectedId,
  onSelect
}: {
  nodes: ServiceWorkNode[];
  lastServiceDates: Record<string, string | null>;
  selectedId: string | null;
  onSelect: (node: ServiceWorkNode) => void;
}) {
  const { t } = useLingui();
  const rows = useMemo(() => inTreeOrder(nodes), [nodes]);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        <Trans>This service order has no work yet.</Trans>
      </p>
    );
  }

  return (
    <ul
      className="flex flex-col rounded-lg border border-border divide-y divide-border"
      aria-label={t`Work`}
    >
      {rows.map(({ node, depth }) => {
        const isSelected = node.id === selectedId;
        const linked = node.trackedEntityId || node.itemId;
        const lastService = lastServiceDates[node.id];
        return (
          <li key={node.id}>
            <button
              type="button"
              aria-pressed={isSelected}
              onClick={() => onSelect(node)}
              className={cn(
                "flex min-h-11 w-full items-center gap-2 py-2 pr-3 text-left text-sm first:rounded-t-lg last:rounded-b-lg",
                isSelected ? "bg-accent" : "hover:bg-accent/30"
              )}
              style={{ paddingLeft: `${12 + depth * 16}px` }}
            >
              <ElementTypeIcon type={node.type} />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 whitespace-nowrap font-mono text-xs text-muted-foreground">
                    {node.readableId}
                  </span>
                  <span className="truncate font-medium">{node.name}</span>
                </span>
                {linked && (
                  <span className="truncate text-xs text-muted-foreground">
                    {node.trackedEntity?.readableId ??
                      node.item?.readableIdWithRevision}
                    {" · "}
                    {lastService ? (
                      <Trans>
                        Last service{" "}
                        <DateTime value={lastService} variant="date" />
                      </Trans>
                    ) : (
                      <Trans>Never serviced</Trans>
                    )}
                  </span>
                )}
              </div>
              {isSelected && <LuCheck className="size-4 shrink-0" />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
