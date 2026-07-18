import { Badge, HStack } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";
import type { MethodDiffEntry } from "../../items.models";

// -----------------------------------------------------------------------------
// Shared Change Order diff-UI helpers.
//
// The BOM / BOP / BOP-children editors all render staged rows keyed against a
// per-entry diff (added / modified / removed). These helpers centralize the
// three pieces that were previously copied into each editor: building the
// id → diff-entry map, deriving removed-only entries, and the status badge.
// -----------------------------------------------------------------------------

// A diff entry whose before/after payloads may carry an `id`. The diff engine is
// generic over row shape (Record<string, unknown>); we only read `.id`.
type DiffEntry<Row> = MethodDiffEntry<Row>;

function idOf(payload: unknown): string | undefined {
  return (payload as { id?: string } | null)?.id;
}

// Map each staged row id → its diff entry, keyed by `after.id`. A staged row is
// the diff `after`; a removed line only exists as a `before` (no staged row) and
// is surfaced separately via `removedEntries`.
export function buildDiffMap<Row, T extends DiffEntry<Row>>(
  diff?: T[]
): Map<string, T> {
  const map = new Map<string, T>();
  if (!diff) return map;
  for (const entry of diff) {
    const afterId = idOf(entry.after);
    if (afterId) map.set(afterId, entry);
  }
  return map;
}

// Removed lines have a diff `before` but no matching staged (present) row.
export function removedEntries<Row, T extends DiffEntry<Row>>(
  diff: T[] | undefined,
  presentIds: Set<string>
): T[] {
  return (diff ?? []).filter((entry) => {
    if (entry.status !== "removed") return false;
    const beforeId = idOf(entry.before);
    return beforeId ? !presentIds.has(beforeId) : true;
  });
}

export function DiffBadge({
  status
}: {
  status: MethodDiffEntry<unknown>["status"];
}) {
  if (status === "added") {
    return (
      <Badge variant="green">
        <Trans>Added</Trans>
      </Badge>
    );
  }
  if (status === "modified") {
    return (
      <Badge variant="yellow">
        <Trans>Modified</Trans>
      </Badge>
    );
  }
  if (status === "removed") {
    return (
      <Badge variant="red">
        <Trans>Removed</Trans>
      </Badge>
    );
  }
  return null;
}

// The struck-through "removed" row shell used by the BOP operation editor and
// the BOP children (steps / parameters / tools). The BOM editor renders a
// richer removed row (item id + quantity badge) inline and does not use this.
export function RemovedEntryRow({
  label,
  className = "p-2"
}: {
  label: ReactNode;
  className?: string;
}) {
  return (
    <HStack
      className={`w-full justify-between border border-border rounded-lg opacity-60 ${className}`}
    >
      <span className="text-sm line-through">{label}</span>
      <DiffBadge status="removed" />
    </HStack>
  );
}
