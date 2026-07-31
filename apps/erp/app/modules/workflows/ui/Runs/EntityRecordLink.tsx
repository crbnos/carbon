import { getTableLabel } from "@carbon/database/audit.config";
import { Hyperlink } from "~/components";
import { getEntityPath } from "~/utils/entity";

export function EntityRecordLink({
  table,
  id,
  className
}: {
  table: string;
  id: string;
  className?: string;
}) {
  const label = getTableLabel(table);
  const href = getEntityPath(id);
  if (href) {
    return (
      <Hyperlink to={href} className={className}>
        {label} {id}
      </Hyperlink>
    );
  }
  return (
    <span className={className}>
      {label} {id}
    </span>
  );
}
