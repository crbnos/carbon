import { Button, cn } from "@carbon/react";

type NavigationEditBarProps = {
  isSaving: boolean;
  isDirty: boolean;
  onSave: () => void;
  onCancel: () => void;
};

export function NavigationEditBar({
  isSaving,
  isDirty,
  onSave,
  onCancel
}: NavigationEditBarProps) {
  return (
    <div
      className={cn(
        "flex gap-1 px-2",
        "opacity-0 group-data-[state=expanded]:opacity-100",
        "transition-opacity"
      )}
    >
      <Button
        size="sm"
        variant="ghost"
        onClick={onCancel}
        disabled={isSaving}
        className="flex-1 h-8 text-xs"
      >
        Cancel
      </Button>
      <Button
        size="sm"
        variant="primary"
        onClick={onSave}
        disabled={!isDirty || isSaving}
        className="flex-1 h-8 text-xs"
      >
        {isSaving ? "Saving..." : "Save"}
      </Button>
    </div>
  );
}
