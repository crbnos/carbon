import {
  cn,
  HStack,
  Popover,
  PopoverContent,
  PopoverTrigger,
  VStack
} from "@carbon/react";
import type { IconType } from "react-icons";
import {
  LuInfo,
  LuPackageCheck,
  LuPackageMinus,
  LuPackageOpen,
  LuPackageX,
  LuPause
} from "react-icons/lu";
import { ACTIVITY_KIND_META, type ActivityKind } from "./activityIcons";

type Entry = {
  label: string;
  color: string;
  shape: "circle" | "diamond";
  icon: IconType;
};

const ENTITY_ENTRIES: Entry[] = [
  {
    label: "Available",
    color: "hsl(142 71% 45%)",
    shape: "circle",
    icon: LuPackageCheck
  },
  {
    label: "Consumed",
    color: "hsl(217 91% 60%)",
    shape: "circle",
    icon: LuPackageMinus
  },
  {
    label: "Reserved",
    color: "hsl(220 9% 46%)",
    shape: "circle",
    icon: LuPackageOpen
  },
  {
    label: "On Hold",
    color: "hsl(25 95% 53%)",
    shape: "circle",
    icon: LuPause
  },
  {
    label: "Rejected",
    color: "hsl(0 84% 60%)",
    shape: "circle",
    icon: LuPackageX
  }
];

const ACTIVITY_ENTRIES: Entry[] = (
  Object.keys(ACTIVITY_KIND_META) as ActivityKind[]
).map((kind) => {
  const meta = ACTIVITY_KIND_META[kind];
  return {
    label: meta.label,
    color: meta.color,
    shape: "diamond",
    icon: meta.icon
  };
});

export function GraphLegend() {
  return (
    <div className="absolute bottom-3 left-3 z-20">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Show legend"
            className={cn(
              "h-8 w-8 rounded-md flex items-center justify-center transition-colors",
              "border border-border bg-card/90 backdrop-blur shadow-sm",
              "text-muted-foreground hover:text-foreground hover:bg-accent/60",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            )}
          >
            <LuInfo className="w-4 h-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          className="w-[420px] p-0 border-border"
        >
          <HStack spacing={0} className="items-stretch divide-x divide-border">
            <Section title="Entities" entries={ENTITY_ENTRIES} />
            <Section title="Activities" entries={ACTIVITY_ENTRIES} />
          </HStack>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function Section({ title, entries }: { title: string; entries: Entry[] }) {
  return (
    <VStack spacing={2} className="p-4 flex-1 min-w-0">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
        {title}
      </span>
      {entries.map((entry) => (
        <Row key={entry.label} entry={entry} />
      ))}
    </VStack>
  );
}

function Row({ entry }: { entry: Entry }) {
  const Icon = entry.icon;
  return (
    <HStack spacing={3} className="items-center">
      <div className="relative w-6 h-6 flex items-center justify-center shrink-0">
        <div
          className={cn(
            "absolute inset-0",
            entry.shape === "circle" ? "rounded-full" : "rounded"
          )}
          style={{
            background: entry.color,
            transform: entry.shape === "diamond" ? "rotate(45deg)" : undefined
          }}
        />
        <Icon className="relative w-3.5 h-3.5 text-white" />
      </div>
      <span className="text-[13px] text-foreground truncate">
        {entry.label}
      </span>
    </HStack>
  );
}
