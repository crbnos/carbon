import { Badge } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useState } from "react";
import { EntityRecordLink } from "./EntityRecordLink";

const MAX_DEPTH = 5;

function isCompactionMarker(value: unknown): boolean {
  if (typeof value === "string") {
    return value.endsWith("more characters") || value.endsWith("more items");
  }
  if (Array.isArray(value)) {
    const last = value[value.length - 1];
    return (
      typeof last === "string" &&
      (last.endsWith("more items") || last.endsWith("more characters"))
    );
  }
  if (value !== null && typeof value === "object") {
    return "…" in (value as Record<string, unknown>);
  }
  return false;
}

type RuntimeValue =
  | { kind: "primitive"; of: string; value: string | number | boolean | null }
  | { kind: "entity"; of: string; id: string; row?: Record<string, unknown> }
  | { kind: "list"; of: unknown; items: unknown[] };

function isRuntimeValue(v: unknown): v is RuntimeValue {
  if (v === null || typeof v !== "object") return false;
  const obj = v as Record<string, unknown>;
  return (
    obj.kind === "primitive" || obj.kind === "entity" || obj.kind === "list"
  );
}

function ListValue({ items, depth }: { items: unknown[]; depth: number }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <span>
      <button
        type="button"
        className="text-xs text-muted-foreground underline underline-offset-2 cursor-pointer"
        onClick={() => setExpanded((p) => !p)}
      >
        {items.length} {items.length === 1 ? "item" : "items"}
      </button>
      {expanded && (
        <ul className="mt-1 ml-3 list-disc space-y-0.5">
          {items.map((item, i) => (
            <li key={`item-${i}`}>
              <RuntimeValueView value={item} depth={depth + 1} />
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}

export function RuntimeValueView({
  value,
  depth = 0
}: {
  value: unknown;
  depth?: number;
}) {
  if (depth >= MAX_DEPTH)
    return <span className="text-muted-foreground">…</span>;

  // Compaction markers render as muted Badge
  if (isCompactionMarker(value)) {
    const label =
      typeof value === "string"
        ? value
        : Array.isArray(value)
          ? String(value[value.length - 1])
          : `… ${Object.values(value as object).find((v) => typeof v === "string" && v.includes("more"))}`;
    return (
      <Badge variant="outline" className="text-muted-foreground font-normal">
        {label}
      </Badge>
    );
  }

  if (!isRuntimeValue(value)) {
    // Raw fallback: pre block for objects/arrays, plain text for primitives
    if (value === null || value === undefined) {
      return (
        <span className="text-muted-foreground italic text-xs">
          <Trans>Nothing</Trans>
        </span>
      );
    }
    if (typeof value === "object") {
      return (
        <pre className="overflow-auto rounded bg-muted px-2 py-1 text-xs font-mono whitespace-pre-wrap max-h-48">
          {JSON.stringify(value, null, 2)}
        </pre>
      );
    }
    return <span className="text-xs">{String(value)}</span>;
  }

  if (value.kind === "primitive") {
    if (value.value === null) {
      return (
        <span className="text-muted-foreground italic text-xs">
          <Trans>Nothing</Trans>
        </span>
      );
    }
    return <span className="text-xs">{String(value.value)}</span>;
  }

  if (value.kind === "entity") {
    return (
      <EntityRecordLink table={value.of} id={value.id} className="text-xs" />
    );
  }

  if (value.kind === "list") {
    if (!value.items || value.items.length === 0) {
      return (
        <span className="text-muted-foreground italic text-xs">
          <Trans>Empty list</Trans>
        </span>
      );
    }
    return <ListValue items={value.items} depth={depth} />;
  }

  // Shouldn't reach here, but fallback
  return (
    <pre className="overflow-auto rounded bg-muted px-2 py-1 text-xs font-mono whitespace-pre-wrap max-h-48">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
