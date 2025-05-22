import { Badge } from "@carbon/react";

export function ItemWithRevision({
  item,
}: {
  item?: {
    readableId?: string | null;
    revision?: string | null;
  } | null;
}) {
  if (!item) return null;
  const { readableId, revision } = item;
  if (!readableId) return null;
  return (
    <div className="flex items-center gap-1">
      <span>{readableId}</span>
      {revision && revision !== "0" && (
        <Badge variant="outline" className="font-mono">
          Rev {revision}
        </Badge>
      )}
    </div>
  );
}
