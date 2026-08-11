import { Badge } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { Fragment, useState } from "react";
import { humanizeField } from "../Builder/nodes/meta";
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
  | { kind: "list"; of: unknown; items: unknown[] }
  | { kind: "pairs"; entries: unknown[] };

function isRuntimeValue(v: unknown): v is RuntimeValue {
  if (v === null || typeof v !== "object") return false;
  const obj = v as Record<string, unknown>;
  return (
    obj.kind === "primitive" ||
    obj.kind === "entity" ||
    obj.kind === "list" ||
    obj.kind === "pairs"
  );
}

function ListValue({
  items,
  depth,
  recordNames
}: {
  items: unknown[];
  depth: number;
  recordNames: Record<string, string>;
}) {
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
              <RuntimeValueView
                value={item}
                depth={depth + 1}
                recordNames={recordNames}
              />
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}

/** A step's inputs/outputs are a map of named values, not one value. */
export function ValueMap({
  value,
  recordNames = {},
  labelFor
}: {
  value: unknown;
  recordNames?: Record<string, string>;
  labelFor?: (key: string) => string;
}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return <RuntimeValueView value={value} recordNames={recordNames} />;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) {
    return (
      <span className="text-muted-foreground italic text-xs">
        <Trans>Nothing</Trans>
      </span>
    );
  }
  // A fixed label column, so every value starts on the same line down the page.
  return (
    <dl className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-x-3 gap-y-1.5 items-baseline">
      {entries.map(([key, val]) => (
        <Fragment key={key}>
          <dt className="text-xs text-muted-foreground text-left break-words">
            {labelFor ? labelFor(key) : humanizeField(key)}
          </dt>
          <dd className="min-w-0">
            <RuntimeValueView value={val} recordNames={recordNames} />
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

export function RuntimeValueView({
  value,
  depth = 0,
  recordNames = {}
}: {
  value: unknown;
  depth?: number;
  recordNames?: Record<string, string>;
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
      <EntityRecordLink
        table={value.of}
        id={value.id}
        className="text-xs"
        name={recordNames[`${value.of}:${value.id}`]}
        row={value.row}
      />
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
    return (
      <ListValue items={value.items} depth={depth} recordNames={recordNames} />
    );
  }

  if (value.kind === "pairs") {
    if (!value.entries || value.entries.length === 0) {
      return (
        <span className="text-muted-foreground italic text-xs">
          <Trans>Nothing</Trans>
        </span>
      );
    }
    return (
      <dl className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-x-3 gap-y-1.5 items-baseline">
        {value.entries.map((entry, i) => {
          const row = (entry ?? {}) as { name?: unknown; value?: unknown };
          return (
            <Fragment key={`pair-${i}`}>
              <dt className="text-xs text-muted-foreground text-left break-words">
                {String(row.name ?? "")}
              </dt>
              <dd className="min-w-0">
                <RuntimeValueView
                  value={row.value}
                  depth={depth + 1}
                  recordNames={recordNames}
                />
              </dd>
            </Fragment>
          );
        })}
      </dl>
    );
  }
}
