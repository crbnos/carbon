import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  cn,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  ToggleGroup,
  ToggleGroupItem
} from "@carbon/react";
import { getTimezones } from "@carbon/utils";
import type { Origin, Schedule } from "@carbon/workflows";
import { WORKFLOW_ENTITY_REGISTRY, WORKFLOW_EVENTS } from "@carbon/workflows";
import { getLocalTimeZone } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import { LuCheck, LuChevronsUpDown } from "react-icons/lu";
import { entityLabelKey, useWorkflowLabel } from "../../catalog";
import { useBuilderStore } from "../../context";
import { FormStack, Section } from "../layout";
import type { NodeFormProps } from "./index";

const WEEKDAY_ABBR = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

const TZ_OPTIONS = getTimezones().flatMap((group) =>
  group.options.map((option) => option.value)
);

function offsetMinutes(tz: string, at: Date): number | null {
  try {
    return (
      (new Date(at.toLocaleString("en-US", { timeZone: tz })).getTime() -
        new Date(at.toLocaleString("en-US", { timeZone: "UTC" })).getTime()) /
      60000
    );
  } catch {
    return null;
  }
}

/** The picker offers 35 zones, and the browser's own zone is often an alias of one
 * of them (`Asia/Calcutta` for `Asia/Kolkata`) — an unlisted value shows as blank,
 * so fall back to whichever listed zone is on the same offset right now. */
function resolveTimezone(tz?: string): string {
  const wanted = tz || getLocalTimeZone();
  if (TZ_OPTIONS.includes(wanted)) return wanted;
  const now = new Date();
  const target = offsetMinutes(wanted, now);
  const match =
    target === null
      ? undefined
      : TZ_OPTIONS.find((option) => offsetMinutes(option, now) === target);
  return match ?? TZ_OPTIONS[0]!;
}

function defaultSchedule(): Schedule {
  return {
    freq: "Daily",
    hour: 9,
    minute: 0,
    tz: resolveTimezone()
  };
}

// ─── Grouped event picker ────────────────────────────────────────────────────

type EntityGroup = { entity: string; ids: string[] };

type EventPickerProps = {
  selected: string;
  onSelect: (id: string) => void;
  entityGroups: EntityGroup[];
  momentIds: string[];
  label: (key: string) => string;
};

function EventPicker({
  selected,
  onSelect,
  entityGroups,
  momentIds,
  label
}: EventPickerProps) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);

  const summary = selected ? label(selected) : t`Select an event…`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between rounded-md border bg-background px-3 py-2 text-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            className={cn("truncate", !selected && "text-muted-foreground")}
          >
            {summary}
          </span>
          <LuChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[340px] p-0"
        onWheel={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        <Command>
          <CommandInput placeholder={t`Search events…`} />
          <CommandList className="max-h-64 overflow-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent">
            <CommandEmpty>
              <Trans>No events found.</Trans>
            </CommandEmpty>
            {entityGroups.map(({ entity, ids }) => (
              <CommandGroup
                key={entity}
                heading={label(entityLabelKey(entity))}
              >
                {ids.map((id) => (
                  <CommandItem
                    key={id}
                    // Search runs on `value`, so the visible label has to be in it —
                    // the id alone is never what someone types, and never translated.
                    value={`${id} ${label(id)}`}
                    onSelect={() => {
                      onSelect(id);
                      setOpen(false);
                    }}
                  >
                    <LuCheck
                      className={cn(
                        "mr-2 h-4 w-4 shrink-0",
                        selected === id ? "opacity-100" : "opacity-0"
                      )}
                    />
                    {label(id)}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
            {momentIds.length > 0 && (
              <CommandGroup heading={t`Business moments`}>
                {momentIds.map((id) => (
                  <CommandItem
                    key={id}
                    value={`${id} ${label(id)}`}
                    onSelect={() => {
                      onSelect(id);
                      setOpen(false);
                    }}
                  >
                    <LuCheck
                      className={cn(
                        "mr-2 h-4 w-4 shrink-0",
                        selected === id ? "opacity-100" : "opacity-0"
                      )}
                    />
                    {label(id)}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ─── Schedule editor ─────────────────────────────────────────────────────────

type ScheduleEditorProps = {
  schedule: Schedule;
  onChange: (patch: Partial<Schedule>) => void;
};

function ScheduleEditor({ schedule, onChange }: ScheduleEditorProps) {
  const { t } = useLingui();

  const tz = resolveTimezone(schedule.tz);

  return (
    <FormStack spacing={3}>
      {/* Frequency */}
      <div className="space-y-1">
        <Section>
          <Trans>Frequency</Trans>
        </Section>
        <Select
          value={schedule.freq}
          onValueChange={(v) => onChange({ freq: v as Schedule["freq"] })}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Daily">
              <Trans>Daily</Trans>
            </SelectItem>
            <SelectItem value="Weekly">
              <Trans>Weekly</Trans>
            </SelectItem>
            <SelectItem value="Monthly">
              <Trans>Monthly</Trans>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Weekdays (Weekly only) */}
      {schedule.freq === "Weekly" && (
        <div className="space-y-1">
          <Section>
            <Trans>On days</Trans>
          </Section>
          <div className="flex gap-1">
            {WEEKDAY_ABBR.map((day, i) => {
              const active = schedule.weekdays?.includes(i) ?? false;
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={active}
                  aria-label={day}
                  className={cn(
                    "h-8 w-8 rounded-md text-xs font-medium transition-colors",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/70"
                  )}
                  onClick={() => {
                    const current = schedule.weekdays ?? [];
                    onChange({
                      weekdays: active
                        ? current.filter((d) => d !== i)
                        : [...current, i].sort((a, b) => a - b)
                    });
                  }}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Day of month (Monthly only) */}
      {schedule.freq === "Monthly" && (
        <div className="space-y-1">
          <Section>
            <Trans>On day</Trans>
          </Section>
          <Select
            value={String(schedule.day ?? 1)}
            onValueChange={(v) =>
              onChange({ day: v === "last" ? "last" : Number(v) })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 31 }, (_, i) => (
                <SelectItem key={i + 1} value={String(i + 1)}>
                  {t`Day ${i + 1}`}
                </SelectItem>
              ))}
              <SelectItem value="last">
                <Trans>Last day</Trans>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Time */}
      <div className="space-y-1">
        <Section>
          <Trans>Time of day</Trans>
        </Section>
        <div className="flex items-center gap-2">
          <Select
            value={String(schedule.hour)}
            onValueChange={(v) => onChange({ hour: Number(v) })}
          >
            <SelectTrigger className="flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 24 }, (_, i) => (
                <SelectItem key={i} value={String(i)}>
                  {pad(i)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-muted-foreground">:</span>
          <Select
            value={String(schedule.minute)}
            onValueChange={(v) => onChange({ minute: Number(v) })}
          >
            <SelectTrigger className="flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {pad(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Timezone */}
      <div className="space-y-1">
        <Section>
          <Trans>Timezone</Trans>
        </Section>
        <Select value={tz} onValueChange={(v) => onChange({ tz: v })}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {getTimezones().map(({ label, options }) => (
              <SelectGroup key={label}>
                <SelectLabel>{label}</SelectLabel>
                {options.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>
    </FormStack>
  );
}

// ─── TriggerForm ─────────────────────────────────────────────────────────────

export function TriggerForm({ node }: NodeFormProps<"trigger">) {
  const updateNodeData = useBuilderStore((s) => s.updateNodeData);
  const label = useWorkflowLabel();

  const { events, origin, schedule } = node.data;
  const isScheduleMode = !!schedule;

  // Build entity groups once
  const registryEntities = useMemo(
    () => new Set(Object.keys(WORKFLOW_ENTITY_REGISTRY)),
    []
  );

  const { entityGroups, momentIds } = useMemo(() => {
    const groupMap: Record<string, string[]> = {};
    const moments: string[] = [];

    for (const id of Object.keys(WORKFLOW_EVENTS)) {
      const prefix = id.split(".")[0];
      if (prefix !== undefined && registryEntities.has(prefix)) {
        if (!groupMap[prefix]) groupMap[prefix] = [];
        groupMap[prefix].push(id);
      } else {
        moments.push(id);
      }
    }

    const entityGroups: EntityGroup[] = Object.entries(groupMap).map(
      ([entity, ids]) => ({ entity, ids })
    );

    return { entityGroups, momentIds: moments };
  }, [registryEntities]);

  // Mode switching
  function switchToEvents() {
    updateNodeData(node.id, {
      events: [],
      origin: "Person" satisfies Origin,
      schedule: undefined
    });
  }

  function switchToSchedule() {
    updateNodeData(node.id, {
      events: [],
      origin: undefined,
      schedule: defaultSchedule()
    });
  }

  // Event selection — single event only
  function selectEvent(id: string) {
    updateNodeData(node.id, { events: [id] });
  }

  // Schedule patch
  function patchSchedule(patch: Partial<Schedule>) {
    if (!schedule) return;
    updateNodeData(node.id, { schedule: { ...schedule, ...patch } });
  }

  return (
    <FormStack spacing={4}>
      {/* Mode toggle */}
      <div className="space-y-1">
        <Section>
          <Trans>Trigger type</Trans>
        </Section>
        <div className="flex overflow-hidden rounded-md border">
          <button
            type="button"
            className={cn(
              "flex-1 px-3 py-2 text-sm transition-colors",
              !isScheduleMode
                ? "bg-primary text-primary-foreground"
                : "bg-background text-foreground hover:bg-muted"
            )}
            onClick={switchToEvents}
          >
            <Trans>Event</Trans>
          </button>
          <button
            type="button"
            className={cn(
              "flex-1 border-l px-3 py-2 text-sm transition-colors",
              isScheduleMode
                ? "bg-primary text-primary-foreground"
                : "bg-background text-foreground hover:bg-muted"
            )}
            onClick={switchToSchedule}
          >
            <Trans>Schedule</Trans>
          </button>
        </div>
      </div>

      {!isScheduleMode ? (
        <>
          {/* Event selection */}
          <div className="space-y-2">
            <Section>
              <Trans>Event</Trans>
            </Section>
            <EventPicker
              selected={events[0] ?? ""}
              onSelect={selectEvent}
              entityGroups={entityGroups}
              momentIds={momentIds}
              label={label}
            />
          </div>

          {/* Origin selector */}
          <div className="space-y-2">
            <Section
              hint={
                <Trans>
                  Everything else covers people, imports, integrations and the
                  API — anything that is not one of your workflows.
                </Trans>
              }
            >
              <Trans>Triggered by</Trans>
            </Section>
            <ToggleGroup
              type="single"
              value={origin}
              onValueChange={(v) => {
                if (v) updateNodeData(node.id, { origin: v as Origin });
              }}
              className="justify-start"
            >
              <ToggleGroupItem
                value={"Person" satisfies Origin}
                className="text-xs"
              >
                <Trans>Everything else</Trans>
              </ToggleGroupItem>
              <ToggleGroupItem
                value={"Automation" satisfies Origin}
                className="text-xs"
              >
                <Trans>Workflows</Trans>
              </ToggleGroupItem>
              <ToggleGroupItem
                value={"Both" satisfies Origin}
                className="text-xs"
              >
                <Trans>Both</Trans>
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </>
      ) : (
        <>
          {schedule && (
            <ScheduleEditor schedule={schedule} onChange={patchSchedule} />
          )}
        </>
      )}
    </FormStack>
  );
}
