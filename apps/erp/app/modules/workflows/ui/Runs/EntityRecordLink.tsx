import { getTableLabel } from "@carbon/database/audit.config";
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
  const inline = row?.readableId ?? row?.name;
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
