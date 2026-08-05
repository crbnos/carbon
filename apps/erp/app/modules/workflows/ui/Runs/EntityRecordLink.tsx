import {
  fkDisplayRegistry,
  getTableLabel
} from "@carbon/database/audit.config";
import { Hyperlink } from "~/components";
import { getEntityPath } from "~/utils/entity";

/** An id tells a person nothing. Prefer the record's own name, then an inline row
 * snapshot, and fall back to the id only when neither exists. */
export function EntityRecordLink({
  table,
  id,
  className,
  name,
  row
}: {
  table: string;
  id: string;
  className?: string;
  name?: string;
  row?: Record<string, unknown>;
}) {
  const label = getTableLabel(table);
  // Use the entity's own display columns (same source as the server name resolver) so the
  // inline row fallback reads "SO-0042" not "so_K..." for a sales order, "Jane" not a UUID
  // for a user, etc. Falls back to readableId/name for tables not in the registry.
  const displayCols = (
    fkDisplayRegistry as Record<string, readonly string[] | undefined>
  )[table];
  const inline = displayCols
    ? displayCols
        .map((col) => row?.[col])
        .filter((v) => v !== null && v !== undefined && v !== "")
        .join(" ") || undefined
    : ((row?.readableId ?? row?.name) as string | undefined);
  const display =
    name ??
    (typeof inline === "string" && inline !== "" ? inline : undefined) ??
    id;
  const href = getEntityPath(id);
  const text = `${label} ${display}`;

  if (href) {
    return (
      <Hyperlink to={href} className={className} title={id}>
        {text}
      </Hyperlink>
    );
  }
  return (
    <span className={className} title={id}>
      {text}
    </span>
  );
}
