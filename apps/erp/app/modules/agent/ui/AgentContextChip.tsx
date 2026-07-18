import { LuMapPin, LuX } from "react-icons/lu";

export function AgentContextChip({
  label,
  onRemove
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full border bg-muted/50 pl-2 pr-1 py-0.5 text-xs text-muted-foreground">
      <LuMapPin className="size-3" />
      <span className="truncate max-w-[240px]">{label}</span>
      <button
        type="button"
        aria-label="Remove context"
        className="rounded-full p-0.5 hover:bg-muted"
        onClick={onRemove}
      >
        <LuX className="size-3" />
      </button>
    </div>
  );
}
