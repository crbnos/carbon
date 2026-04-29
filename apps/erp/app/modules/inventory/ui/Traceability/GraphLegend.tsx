import {
  cn,
  HStack,
  Popover,
  PopoverContent,
  PopoverTrigger,
  VStack
} from "@carbon/react";
import type { IconType } from "react-icons";
import { LuInfo } from "react-icons/lu";
import {
  ACTIVITY_KIND_META,
  type ActivityKind,
  ENTITY_STATUS_META,
  type EntityStatus
} from "./metadata";

type Entry = {
  label: string;
  color: string;
  shape: "circle" | "diamond";
  icon: IconType;
};

const ENTITY_DISPLAY_ORDER: EntityStatus[] = [
  "Available",
  "Consumed",
  "Reserved",
  "On Hold",
  "Rejected"
];

const ENTITY_ENTRIES: Entry[] = ENTITY_DISPLAY_ORDER.map((status) => {
  const meta = ENTITY_STATUS_META[status];
  return {
    label: meta.label,
    color: meta.color,
    shape: "circle",
    icon: meta.icon
  };
});

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
          <div className="border-t border-border p-4">
            <span className="block text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
              Lines
            </span>
            <VStack spacing={2}>
              <LineRow
                label="Normal flow"
                color="hsl(0 0% 55%)"
                width={1.2}
                opacity={0.6}
              />
              <LineRow
                label="Selection path"
                color="hsl(0 0% 92%)"
                width={2.5}
                opacity={1}
              />
              <LineRow
                label="Reject branch"
                color="hsl(0 72% 55%)"
                width={1.5}
                opacity={0.9}
              />
              <LineRow
                label="Cycle back-edge"
                color="hsl(0 0% 55%)"
                width={1.2}
                opacity={0.3}
                dashed
              />
            </VStack>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function Section({ title, entries }: { title: string; entries: Entry[] }) {
  return (
    <VStack spacing={3} className="p-4 flex-1 min-w-0">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
        {title}
      </span>
      {entries.map((entry) => (
        <Row key={entry.label} entry={entry} />
      ))}
    </VStack>
  );
}

function LineRow({
  label,
  color,
  width,
  opacity,
  dashed = false
}: {
  label: string;
  color: string;
  width: number;
  opacity: number;
  dashed?: boolean;
}) {
  return (
    <HStack spacing={3} className="items-center">
      <svg width={36} height={6} className="shrink-0">
        <line
          x1={0}
          y1={3}
          x2={36}
          y2={3}
          stroke={color}
          strokeWidth={width}
          strokeOpacity={opacity}
          strokeDasharray={dashed ? "5 3" : undefined}
        />
      </svg>
      <span className="text-[13px] text-foreground truncate">{label}</span>
    </HStack>
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
