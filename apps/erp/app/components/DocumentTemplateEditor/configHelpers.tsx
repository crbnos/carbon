import { Switch } from "@carbon/react";

/** A label + small switch row, shared across the block config panels. */
export function ToggleRow({
  label,
  checked,
  onChange
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm">{label}</span>
      <Switch
        variant="small"
        checked={checked}
        onCheckedChange={(value) => onChange(Boolean(value))}
      />
    </div>
  );
}
