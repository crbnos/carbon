import { cn, HStack, VStack } from "@carbon/react";
import { useState } from "react";
import type { IconType } from "react-icons";
import {
  LuChevronDown,
  LuChevronRight,
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
  const [open, setOpen] = useState(true);

  return (
    <div className="absolute bottom-3 left-3 z-20 rounded-md border border-border bg-card/90 backdrop-blur shadow-sm text-xs overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 w-full px-2 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground"
      >
        {open ? (
          <LuChevronDown className="w-3 h-3" />
        ) : (
          <LuChevronRight className="w-3 h-3" />
        )}
        Legend
      </button>
      {open && (
        <VStack spacing={3} className="px-3 pb-3 pt-1">
          <Section title="Entities" entries={ENTITY_ENTRIES} />
          <Section title="Activities" entries={ACTIVITY_ENTRIES} />
        </VStack>
      )}
    </div>
  );
}

function Section({ title, entries }: { title: string; entries: Entry[] }) {
  return (
    <VStack spacing={1}>
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
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
    <HStack spacing={2} className="items-center">
      <div className="relative w-4 h-4 flex items-center justify-center">
        <div
          className={cn(
            "absolute inset-0",
            entry.shape === "circle" ? "rounded-full" : "rounded-sm"
          )}
          style={{
            background: entry.color,
            transform: entry.shape === "diamond" ? "rotate(45deg)" : undefined
          }}
        />
        <Icon className="relative w-2.5 h-2.5 text-white" />
      </div>
      <span className="text-foreground">{entry.label}</span>
    </HStack>
  );
}
