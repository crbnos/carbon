import { cn, ToggleGroup, ToggleGroupItem } from "@carbon/react";
import { Trans } from "@lingui/react/macro";

type Props = {
  value: "and" | "or";
  onChange: (v: "and" | "or") => void;
};

export function CombinatorToggle({ value, onChange }: Props) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(v) => {
        if (v === "and" || v === "or") onChange(v);
      }}
      className={cn("nodrag nopan gap-0 rounded-md border text-[10px]")}
    >
      <ToggleGroupItem
        value="and"
        className="h-5 rounded-l-md rounded-r-none border-r px-1.5 text-[10px] data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
      >
        <Trans>AND</Trans>
      </ToggleGroupItem>
      <ToggleGroupItem
        value="or"
        className="h-5 rounded-l-none rounded-r-md px-1.5 text-[10px] data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
      >
        <Trans>OR</Trans>
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
