// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Badge,
  Button,
  cn,
  HStack,
  IconButton,
  LabelWithHelp,
  Subheading,
  VStack
} from "@carbon/react";
import type { AssemblyGraphIndex } from "@carbon/viewer";
import { groupComponentNodeIds } from "@carbon/viewer";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useState } from "react";
import { LuEyeOff } from "react-icons/lu";
import { ComponentColorSwatch } from "./AssemblyStepBom";

/** Parts are hidden from the Components panel eye; here they can only be shown again. */
export default function AssemblyStepHiddenComponents({
  hiddenNodeIds,
  graphIndex,
  isDisabled,
  onSetHiddenComponents
}: {
  hiddenNodeIds: string[];
  graphIndex: AssemblyGraphIndex | null;
  isDisabled: boolean;
  onSetHiddenComponents: (nodeIds: string[]) => void;
}) {
  const { t } = useLingui();
  // "Show all" saves at once but stays undoable for SHOW_ALL_UNDO_MS, so a stray
  // click can't silently throw away a step's tuned hidden list.
  const [undoNodeIds, setUndoNodeIds] = useState<string[] | null>(null);
  useEffect(() => {
    if (!undoNodeIds) return;
    const timer = setTimeout(() => setUndoNodeIds(null), SHOW_ALL_UNDO_MS);
    return () => clearTimeout(timer);
  }, [undoNodeIds]);
  const isUndoPending = undoNodeIds !== null;
  const listedNodeIds = undoNodeIds ?? hiddenNodeIds;

  const groups = useMemo(
    () => (graphIndex ? groupComponentNodeIds(listedNodeIds, graphIndex) : []),
    [listedNodeIds, graphIndex]
  );
  const onShow = (nodeIds: string[]) => {
    const show = new Set(nodeIds);
    onSetHiddenComponents(hiddenNodeIds.filter((nodeId) => !show.has(nodeId)));
  };

  const onShowAll = () => {
    setUndoNodeIds(hiddenNodeIds);
    onSetHiddenComponents([]);
  };

  // Restore the shown parts, keeping anything hidden elsewhere in the meantime.
  const onHideAgain = () => {
    if (!undoNodeIds) return;
    onSetHiddenComponents([...new Set([...hiddenNodeIds, ...undoNodeIds])]);
    setUndoNodeIds(null);
  };

  return (
    <VStack spacing={2} className="w-full">
      <HStack className="w-full justify-between">
        <Subheading as="h4" variant="heavy">
          <LabelWithHelp
            termId="assembly-step-hidden-components"
            variant="inline"
          >
            <Trans>Hidden on this step</Trans>
          </LabelWithHelp>
        </Subheading>
        {groups.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            <Trans>None</Trans>
          </span>
        ) : (
          !isDisabled &&
          (isUndoPending ? (
            <HideAgainButton onClick={onHideAgain} />
          ) : (
            <Button variant="secondary" size="sm" onClick={onShowAll}>
              <Trans>Show All</Trans>
            </Button>
          ))
        )}
      </HStack>
      {groups.length === 0 ? null : (
        <ul className="max-h-64 w-full divide-y divide-border overflow-y-auto rounded-lg border border-border scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent">
          {groups.map((group) => (
            <li
              key={group.key}
              className={cn(
                "flex w-full items-center gap-2 px-2 py-1.5 text-sm",
                isUndoPending && "opacity-50"
              )}
            >
              <ComponentColorSwatch color={group.color} />
              <span
                className="min-w-0 flex-1 truncate text-muted-foreground"
                title={group.name}
              >
                {group.name}
              </span>
              {group.count > 1 && (
                <Badge variant="secondary" className="tabular-nums">
                  ×{group.count}
                </Badge>
              )}
              {!isDisabled && !isUndoPending && (
                <IconButton
                  aria-label={t`Show ${group.name}`}
                  icon={<LuEyeOff />}
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => onShow(group.nodeIds)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </VStack>
  );
}

const SHOW_ALL_UNDO_MS = 4000;

function HideAgainButton({ onClick }: { onClick: () => void }) {
  const [isDraining, setIsDraining] = useState(false);
  useEffect(() => {
    // Start full, then drain on the next frame so the width transition runs.
    const frame = requestAnimationFrame(() => setIsDraining(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <Button
      variant="secondary"
      size="sm"
      className="relative overflow-hidden"
      onClick={onClick}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 bg-primary/15"
        style={{
          width: isDraining ? "0%" : "100%",
          transition: `width ${SHOW_ALL_UNDO_MS}ms linear`
        }}
      />
      <span className="relative">
        <Trans>Hide Again</Trans>
      </span>
    </Button>
  );
}
