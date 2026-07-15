import type { TermId } from "@carbon/glossary";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  cn,
  HStack,
  LabelWithHelp,
  VStack
} from "@carbon/react";
import { getItemReadableId } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { LuChevronRight } from "react-icons/lu";
import { useItems } from "~/stores";
import type {
  ChangeOrderItemDiff,
  MethodDiffEntry,
  MethodDiffStatus,
  OperationDiffEntry
} from "../../changeOrder.models";
import { DiffBadge } from "./diff-ui";

// -----------------------------------------------------------------------------
// Read-only Change Order diff viewer (authoring-time). Renders the CO-owned draft
// method vs the base Active method it was copied from as a git-style, tree-shaped
// redline: BOM and BOP as SEPARATE sections plus an Attributes section. Each entry
// is a top-level TREE NODE (a BOM component / a BOP operation) whose children are
// its properties — the FULL property list on an add (all green), the old values on
// a remove (all red), or the changed old→new pairs on a modify. Colors follow the
// audit-log red→green style. Unchanged rows are filtered out; an unchanged
// operation is shown (uncolored) only when its children changed.
//
// This is NOT the release merge UI (ChangeOrderReleaseMerge / ...ConflictResolver,
// which have radio-button choices) — it is purely read-only, no forms, no state.
// -----------------------------------------------------------------------------

type Row = Record<string, unknown>;
type Items = ReturnType<typeof useItems>[0];

// Humanized labels shared with the merge resolver's FIELD_LABELS, extended with
// the item-attribute columns the attribute diff surfaces. The declared order here
// also drives property ordering in the full-property (add/remove) lists.
const FIELD_LABELS: Record<string, string> = {
  quantity: "Quantity",
  unitOfMeasureCode: "Unit",
  order: "Sequence",
  description: "Description",
  processId: "Process",
  workCenterId: "Work center",
  procedureId: "Procedure",
  operationSupplierProcessId: "Supplier process",
  operationLeadTime: "Lead time",
  operationUnitCost: "Unit cost",
  operationMinimumCost: "Minimum cost",
  setupTime: "Setup time",
  laborTime: "Labor time",
  machineTime: "Machine time",
  methodType: "Method",
  workInstruction: "Work instructions",
  name: "Name",
  itemTrackingType: "Tracking",
  replenishmentSystem: "Replenishment",
  sourcingType: "Sourcing",
  requiresInspection: "Requires inspection",
  defaultMethodType: "Default method",
  itemPostingGroupId: "Item group",
  mpn: "MPN",
  thumbnailPath: "Thumbnail",
  key: "Parameter",
  toolId: "Tool"
};

// Sort index for a field in the full-property list — known fields keep the order
// declared in FIELD_LABELS, unknown fields sort alphabetically after them.
const FIELD_ORDER: Record<string, number> = Object.fromEntries(
  Object.keys(FIELD_LABELS).map((k, i) => [k, i])
);

// Audit / linkage / tenancy columns never worth showing as a property. Mirrors the
// diff engine's IGNORED_FIELDS plus a few display-only noise columns.
const NOISE_FIELDS = new Set<string>([
  "id",
  "companyId",
  "changeOrderId",
  "affectedItemId",
  "sourceMaterialId",
  "sourceOperationId",
  "sourceId",
  "stagedOperationId",
  "makeMethodId",
  "operationId",
  // Internal linkage id with no user-facing name — never show its raw UUID.
  "assemblyInstructionId",
  "itemType",
  "itemReadableId",
  "toolReadableId",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy",
  "customFields",
  "externalId"
]);

const EMPTY_SKIP = new Set<string>();

function humanizeField(field: string): string {
  return (
    FIELD_LABELS[field] ??
    field.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())
  );
}

function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  // JSON columns (workInstruction, etc.) — don't dump raw structure.
  if (field === "workInstruction" || typeof value === "object") return "Set";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

// Every meaningful, non-empty business field of a row, minus the noise set and any
// fields already used as the node label — ordered by FIELD_ORDER.
function meaningfulFields(row: Row, skip: Set<string>): string[] {
  return Object.keys(row)
    .filter(
      (f) =>
        !NOISE_FIELDS.has(f) &&
        !skip.has(f) &&
        row[f] !== null &&
        row[f] !== undefined &&
        row[f] !== ""
    )
    .sort((a, b) => {
      const ia = FIELD_ORDER[a] ?? Number.MAX_SAFE_INTEGER;
      const ib = FIELD_ORDER[b] ?? Number.MAX_SAFE_INTEGER;
      return ia !== ib ? ia - ib : a.localeCompare(b);
    });
}

// The audit-log red/green pill (mirrors AuditLogDrawer's ChangePill).
function Pill({
  variant,
  children,
  title
}: {
  variant: "old" | "new";
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-block max-w-[14rem] truncate rounded px-2 py-0.5 align-bottom text-xs",
        variant === "old"
          ? "bg-red-500/10 text-red-500"
          : "bg-green-500/10 text-green-500"
      )}
    >
      {children}
    </span>
  );
}

// A tree-child region: indented under its parent node with a hierarchy guide line.
function TreeChildren({ children }: { children: ReactNode }) {
  return (
    <div className="w-full border-l border-border/60 pl-3 ml-1">
      <VStack spacing={1} className="w-full">
        {children}
      </VStack>
    </div>
  );
}

// One "label: [old] → [new]" line for a modified field.
function FieldRow({
  field,
  before,
  after
}: {
  field: string;
  before: unknown;
  after: unknown;
}) {
  const beforeText = formatValue(field, before);
  const afterText = formatValue(field, after);
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs">
      <span className="min-w-[6rem] shrink-0 text-muted-foreground">
        {humanizeField(field)}
      </span>
      <Pill variant="old" title={beforeText}>
        {beforeText}
      </Pill>
      <span className="shrink-0 text-muted-foreground">→</span>
      <Pill variant="new" title={afterText}>
        {afterText}
      </Pill>
    </div>
  );
}

// One "label: [value]" line for an added (green) or removed (red) property.
function ValueRow({
  field,
  value,
  variant
}: {
  field: string;
  value: unknown;
  variant: "old" | "new";
}) {
  const text = formatValue(field, value);
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs">
      <span className="min-w-[6rem] shrink-0 text-muted-foreground">
        {humanizeField(field)}
      </span>
      <Pill variant={variant} title={text}>
        {text}
      </Pill>
    </div>
  );
}

// The full property list for an added (all new, green) or removed (all old, red)
// node — "either they are all new, or they are modified" per the diff spec.
function AllPropertyRows({
  row,
  variant,
  skip = EMPTY_SKIP
}: {
  row: Row | null;
  variant: "old" | "new";
  skip?: Set<string>;
}): ReactNode {
  if (!row) return null;
  const fields = meaningfulFields(row, skip);
  if (fields.length === 0) return null;
  return fields.map((f) => (
    <ValueRow key={f} field={f} value={row[f]} variant={variant} />
  ));
}

// The status color for a node title: green (added) / red + strikethrough
// (removed); no color for modified or an unchanged-with-changed-children op.
function statusColor(status: MethodDiffStatus): string | null {
  return status === "added"
    ? "bg-green-500/10 text-green-500"
    : status === "removed"
      ? "bg-red-500/10 text-red-500 line-through"
      : null;
}

// A collapsible tree node: a title line (colored by status, with the Added /
// Modified / Removed badge) over its body, which lives in a collapsible region so
// the user can fold away parts of a large diff. `collapsible` is false for a leaf
// node with no body — then it renders a plain title line (aligned with a chevron
// spacer) and no toggle. Defaults to open so nothing is hidden by default.
function TreeNode({
  label,
  status,
  collapsible,
  children
}: {
  label: ReactNode;
  status: MethodDiffStatus;
  collapsible: boolean;
  children?: ReactNode;
}) {
  const colored = statusColor(status);
  const title = (
    <span
      className={cn(
        "inline-block max-w-full truncate align-bottom text-sm",
        colored && `px-2 py-0.5 rounded ${colored}`
      )}
      title={typeof label === "string" ? label : undefined}
    >
      {label}
    </span>
  );

  if (!collapsible) {
    return (
      <HStack className="justify-between w-full">
        <HStack spacing={1} className="min-w-0">
          <span className="size-3 shrink-0" aria-hidden />
          {title}
        </HStack>
        <DiffBadge status={status} />
      </HStack>
    );
  }

  return (
    <Collapsible defaultOpen className="w-full">
      <HStack className="justify-between w-full">
        <CollapsibleTrigger className="group flex min-w-0 items-center gap-1 text-left">
          <LuChevronRight className="size-3 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
          {title}
        </CollapsibleTrigger>
        <DiffBadge status={status} />
      </HStack>
      <CollapsibleContent>
        <TreeChildren>{children}</TreeChildren>
      </CollapsibleContent>
    </Collapsible>
  );
}

// Fields used as a node's label — skipped from its property list to avoid echoing
// the header text back as a property row.
const MATERIAL_LABEL_FIELDS = new Set(["itemId"]);
const OPERATION_LABEL_FIELDS = new Set(["description"]);

function modifiedFieldRows(entry: MethodDiffEntry<Row>): ReactNode {
  if (!entry.changedFields) return null;
  return Object.entries(entry.changedFields).map(
    ([field, { before, after }]) => (
      <FieldRow key={field} field={field} before={before} after={after} />
    )
  );
}

// The body of a top-level node (or child node): the changed old→new pairs when
// modified, the full new property list when added, the full old list when removed.
function EntryBody({
  entry,
  skip
}: {
  entry: MethodDiffEntry<Row>;
  skip: Set<string>;
}): ReactNode {
  if (entry.status === "modified") return modifiedFieldRows(entry);
  if (entry.status === "added")
    return (
      <AllPropertyRows row={entry.after as Row} variant="new" skip={skip} />
    );
  if (entry.status === "removed")
    return (
      <AllPropertyRows row={entry.before as Row} variant="old" skip={skip} />
    );
  return null;
}

// Whether an entry has any renderable body (changed fields, or a non-empty
// property list after the noise/label filter) — drives whether the node is
// collapsible or renders as a bare leaf.
function entryHasBody(entry: MethodDiffEntry<Row>, skip: Set<string>): boolean {
  if (entry.status === "modified")
    return Object.keys(entry.changedFields ?? {}).length > 0;
  if (entry.status === "added")
    return meaningfulFields((entry.after as Row) ?? {}, skip).length > 0;
  if (entry.status === "removed")
    return meaningfulFields((entry.before as Row) ?? {}, skip).length > 0;
  return false;
}

function MaterialEntry({
  entry,
  items
}: {
  entry: MethodDiffEntry<Row>;
  items: Items;
}) {
  const row = (entry.after ?? entry.before) as Row | null;
  const itemId = (row?.itemId as string | undefined) ?? "";
  // Prefer the server-resolved readable id (store-independent), then the store
  // lookup, then the raw id as a last resort.
  const label =
    (row?.itemReadableId as string | undefined) ||
    getItemReadableId(items, itemId) ||
    itemId ||
    "Material";
  return (
    <TreeNode
      label={label}
      status={entry.status}
      collapsible={entryHasBody(entry, MATERIAL_LABEL_FIELDS)}
    >
      <EntryBody entry={entry} skip={MATERIAL_LABEL_FIELDS} />
    </TreeNode>
  );
}

// The three operation-child buckets, each with a label extractor for its rows and
// the label fields to skip from that row's property list.
const CHILD_BUCKETS: {
  key: "steps" | "parameters" | "tools";
  title: ReactNode;
  labelOf: (row: Row | null) => string;
  skip: Set<string>;
}[] = [
  {
    key: "steps",
    title: <Trans>Steps</Trans>,
    labelOf: (r) => (r?.name as string) || (r?.description as string) || "Step",
    skip: new Set(["name", "description"])
  },
  {
    key: "parameters",
    title: <Trans>Parameters</Trans>,
    labelOf: (r) => (r?.key as string) || "Parameter",
    skip: new Set(["key"])
  },
  {
    key: "tools",
    title: <Trans>Tools</Trans>,
    // Prefer the server-resolved tool readable id over the raw toolId UUID.
    labelOf: (r) =>
      (r?.toolReadableId as string) || (r?.toolId as string) || "Tool",
    skip: new Set(["toolId", "toolReadableId"])
  }
];

function operationHasChildChanges(entry: OperationDiffEntry): boolean {
  const c = entry.children;
  if (!c) return false;
  return [c.steps, c.parameters, c.tools].some((arr) =>
    arr.some((r) => r.status !== "unchanged")
  );
}

function OperationEntry({ entry }: { entry: OperationDiffEntry }) {
  const row = (entry.after ?? entry.before) as Row | null;
  // processId is resolved to the process name server-side; use it as a human
  // fallback label so an operation without a description isn't shown as a number.
  const label =
    (row?.description as string) ||
    (row?.processId as string) ||
    `Operation ${row?.order ?? ""}`.trim();
  const children = entry.children;
  const buckets = children
    ? CHILD_BUCKETS.map((bucket) => ({
        bucket,
        changed: children[bucket.key].filter((c) => c.status !== "unchanged")
      })).filter((b) => b.changed.length > 0)
    : [];
  const collapsible =
    entryHasBody(entry, OPERATION_LABEL_FIELDS) || buckets.length > 0;
  return (
    <TreeNode label={label} status={entry.status} collapsible={collapsible}>
      <EntryBody entry={entry} skip={OPERATION_LABEL_FIELDS} />
      {buckets.map(({ bucket, changed }) => (
        <div key={bucket.key} className="w-full">
          <div className="text-[0.65rem] font-medium uppercase text-muted-foreground pb-0.5">
            {bucket.title}
          </div>
          <TreeChildren>
            {changed.map((child, i) => (
              <TreeNode
                key={`${bucket.key}-${i}`}
                label={bucket.labelOf(
                  (child.after ?? child.before) as Row | null
                )}
                status={child.status}
                collapsible={entryHasBody(child, bucket.skip)}
              >
                <EntryBody entry={child} skip={bucket.skip} />
              </TreeNode>
            ))}
          </TreeChildren>
        </div>
      ))}
    </TreeNode>
  );
}

function Section({
  title,
  termId,
  children
}: {
  title: ReactNode;
  termId?: TermId;
  children: ReactNode;
}) {
  return (
    <VStack spacing={2} className="w-full">
      <LabelWithHelp termId={termId} variant="inline">
        <span className="text-xs font-medium text-muted-foreground">
          {title}
        </span>
      </LabelWithHelp>
      {children}
    </VStack>
  );
}

export default function ChangeOrderDiffViewer({
  diff
}: {
  diff?: ChangeOrderItemDiff;
}) {
  const [items] = useItems();

  const materials = (diff?.materials ?? []).filter(
    (m) => m.status !== "unchanged"
  );
  const operations = (diff?.operations ?? []).filter(
    (o) => o.status !== "unchanged" || operationHasChildChanges(o)
  );
  const attributes = (diff?.attributes ?? []).filter(
    (a) => a.status !== "unchanged"
  );

  const isEmpty =
    materials.length === 0 &&
    operations.length === 0 &&
    attributes.length === 0;

  return (
    <div className="w-full rounded-lg border border-border p-3">
      <div className="pb-2">
        <LabelWithHelp termId="change-order" variant="inline">
          <span className="text-xs font-medium uppercase text-muted-foreground">
            <Trans>Changes</Trans>
          </span>
        </LabelWithHelp>
      </div>
      {isEmpty ? (
        <span className="text-sm text-muted-foreground italic">
          <Trans>No changes yet.</Trans>
        </span>
      ) : (
        <VStack spacing={8} className="w-full">
          {materials.length > 0 && (
            <Section title={<Trans>Bill of Materials</Trans>} termId="bom">
              {materials.map((m, i) => (
                <MaterialEntry key={`mat-${i}`} entry={m} items={items} />
              ))}
            </Section>
          )}
          {operations.length > 0 && (
            <Section title={<Trans>Bill of Process</Trans>} termId="routing">
              {operations.map((o, i) => (
                <OperationEntry key={`op-${i}`} entry={o} />
              ))}
            </Section>
          )}
          {attributes.length > 0 && (
            <Section title={<Trans>Properties</Trans>}>
              {attributes.map((a, i) => (
                <VStack key={`attr-${i}`} spacing={1} className="w-full">
                  {modifiedFieldRows(a)}
                </VStack>
              ))}
            </Section>
          )}
        </VStack>
      )}
    </div>
  );
}
