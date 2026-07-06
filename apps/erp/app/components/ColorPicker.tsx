import { cn, Popover, PopoverContent, PopoverTrigger } from "@carbon/react";
import { HexColorInput, HexColorPicker } from "react-colorful";

/** Preset swatches shown under the picker, Mantine ColorInput style. */
const SWATCHES = [
  "#1f2937",
  "#111827",
  "#374151",
  "#0f172a",
  "#000000",
  "#ffffff",
  "#1e3a8a",
  "#1d4ed8",
  "#2563eb",
  "#0891b2",
  "#059669",
  "#16a34a",
  "#ca8a04",
  "#ea580c",
  "#dc2626",
  "#db2777",
  "#7c3aed",
  "#475569"
];

export function ColorPicker({
  value,
  onChange
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-9 w-full items-center gap-2 rounded-md border border-input bg-background px-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <span
            className="size-5 shrink-0 rounded ring-1 ring-inset ring-black/10"
            style={{ backgroundColor: value }}
          />
          <span className="font-mono text-xs uppercase text-foreground">
            {value}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[232px] p-3">
        <div className="flex flex-col gap-3">
          <HexColorPicker
            color={value}
            onChange={onChange}
            style={{ width: "100%", height: 150 }}
          />

          <div className="flex items-center gap-2">
            <span
              className="size-5 shrink-0 rounded ring-1 ring-inset ring-black/10"
              style={{ backgroundColor: value }}
            />
            <HexColorInput
              prefixed
              color={value}
              onChange={onChange}
              className="h-8 w-full rounded-md border border-input bg-background px-2 font-mono text-xs uppercase outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </div>

          <div className="grid grid-cols-9 gap-1.5">
            {SWATCHES.map((swatch) => (
              <button
                key={swatch}
                type="button"
                aria-label={swatch}
                onClick={() => onChange(swatch)}
                className={cn(
                  "size-5 rounded ring-1 ring-inset ring-black/10 transition-transform hover:scale-110",
                  value.toLowerCase() === swatch && "ring-2 ring-primary"
                )}
                style={{ backgroundColor: swatch }}
              />
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
