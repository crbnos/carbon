import { Button, cn, DatePicker, Input } from "@carbon/react";
import { useEffect, useState } from "react";
import { OPTIONAL_SECTIONS, REGISTRY, SPINE } from "../content";
import {
  gateDateKey,
  PLAN_START_KEY,
  phaseWeeksKey,
  spineForTier
} from "../logic";
import type { Mod, StepDef, Tier } from "../types";
import { MODULE_NAME, MODULES } from "../types";
import { toCalendarDate } from "./date";
import {
  useContacts,
  useExclusions,
  useFieldMap,
  useHubActions,
  useTier
} from "./state";

const GOLIVE_DATE_KEY = gateDateKey("gate:golive");

const TIERS: { value: Tier; label: string; hint: string }[] = [
  {
    value: "self_serve",
    label: "Self-serve",
    hint: "Customer follows it alone"
  },
  { value: "guided", label: "Guided", hint: "Activation fee · we advise" },
  { value: "enterprise", label: "Enterprise", hint: "Custom SOW · we manage" }
];

// Carbon-only: tailor a customer's hub. Module/page/section toggles drive the
// server-side visibility filter; tier relabels the hub; contacts fill across it.
export function SetupControls() {
  const tier = useTier();
  const exclusions = useExclusions();
  const contacts = useContacts();
  const fields = useFieldMap();
  const { setTier, setExclusions, setContacts, setField } = useHubActions();

  const [owner, setOwner] = useState(contacts.owner ?? "");
  const [champion, setChampion] = useState(contacts.champion ?? "");

  const toggleIn = (list: string[], key: string) =>
    list.includes(key) ? list.filter((k) => k !== key) : [...list, key];

  const optionalPages = REGISTRY.filter((p) => p.optional);

  return (
    <div className="w-full max-w-2xl mx-auto flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Setup & Controls
          </h1>
          <span className="text-xxs uppercase tracking-wide rounded px-1.5 py-0.5 bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium">
            Carbon only
          </span>
        </div>
        <p className="text-sm text-muted-foreground max-w-xl text-pretty">
          Tailor this hub for the customer. Changes apply live for everyone
          viewing it. Never shown to the customer here.
        </p>
      </header>

      <Card
        title="Engagement tier"
        subtitle="Relabels the hub and frames the deal."
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {TIERS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTier(t.value)}
              className={cn(
                "rounded-xl border p-3 text-left transition-colors active:scale-[0.98]",
                tier === t.value
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "hover:bg-muted/50"
              )}
            >
              <div className="text-sm font-semibold">{t.label}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {t.hint}
              </div>
            </button>
          ))}
        </div>
      </Card>

      <Card
        title="Schedule"
        subtitle="Anchors the Plan timeline to real dates. Leave blank for a relative, week-numbered timeline. Setting either one fills in the rest."
      >
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-6">
          <DateRow
            label="Project start"
            value={fields.get(PLAN_START_KEY)}
            onChange={(v) => setField(PLAN_START_KEY, v)}
          />
          <DateRow
            label="Target go-live"
            value={fields.get(GOLIVE_DATE_KEY)}
            onChange={(v) => setField(GOLIVE_DATE_KEY, v)}
          />
        </div>
      </Card>

      <Card
        title="Phase durations"
        subtitle="How long each phase runs, in weeks. Drives the Plan timeline; leave blank to use the default."
      >
        <div className="flex flex-col gap-2">
          {spineForTier(SPINE, tier).map((step) => (
            <PhaseDurationRow
              key={step.key}
              step={step}
              value={fields.get(phaseWeeksKey(step.key))}
              onCommit={(weeks) => setField(phaseWeeksKey(step.key), weeks)}
            />
          ))}
        </div>
      </Card>

      <Card
        title="Modules in scope"
        subtitle="Switch a module off to remove it everywhere: Requirements, Data, Training, Scope."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {MODULES.map((m: Mod) => {
            const included = !exclusions.modules.includes(m);
            return (
              <ToggleRow
                key={m}
                label={MODULE_NAME[m]}
                on={included}
                onToggle={() =>
                  setExclusions({
                    ...exclusions,
                    modules: toggleIn(exclusions.modules, m) as Mod[]
                  })
                }
              />
            );
          })}
        </div>
      </Card>

      {optionalPages.length || OPTIONAL_SECTIONS.length ? (
        <Card
          title="Optional pages & sections"
          subtitle="Drop whole pages or sections a customer doesn't need."
        >
          <div className="flex flex-col gap-2">
            {optionalPages.map((p) => (
              <ToggleRow
                key={p.slug}
                label={p.navLabel}
                badge="Page"
                on={!exclusions.pages.includes(p.slug)}
                onToggle={() =>
                  setExclusions({
                    ...exclusions,
                    pages: toggleIn(exclusions.pages, p.slug)
                  })
                }
              />
            ))}
            {OPTIONAL_SECTIONS.map((s) => (
              <ToggleRow
                key={s.key}
                label={s.label}
                badge="Section"
                on={!exclusions.sections.includes(s.key)}
                onToggle={() =>
                  setExclusions({
                    ...exclusions,
                    sections: toggleIn(exclusions.sections, s.key)
                  })
                }
              />
            ))}
          </div>
        </Card>
      ) : null}

      {tier !== "self_serve" ? (
        <Card
          title="Customer contacts"
          subtitle="Names fill in wherever those roles are referenced across the hub."
        >
          <div className="flex flex-col gap-3">
            <Field
              label="Project owner"
              value={owner}
              onChange={setOwner}
              placeholder="e.g. Jane Smith"
            />
            <Field
              label="Champion(s)"
              value={champion}
              onChange={setChampion}
              placeholder="e.g. Marco + the area leads"
            />
            <div>
              <Button
                onClick={() => setContacts({ ...contacts, owner, champion })}
              >
                Save contacts
              </Button>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function Card({
  title,
  subtitle,
  children
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border bg-card shadow-button-base p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      {subtitle ? (
        <p className="text-xs text-muted-foreground mt-1 mb-4 max-w-xl">
          {subtitle}
        </p>
      ) : (
        <div className="mb-4" />
      )}
      {children}
    </section>
  );
}

function PhaseDurationRow({
  step,
  value,
  onCommit
}: {
  step: StepDef;
  value: string | undefined;
  onCommit: (weeks: string) => void;
}) {
  const [weeks, setWeeks] = useState(value ?? "");
  // Re-sync if the server value changes underneath (realtime / revalidate).
  useEffect(() => setWeeks(value ?? ""), [value]);

  return (
    <div className="flex items-center gap-3 rounded-lg border px-3 py-2">
      <span className="shrink-0 size-6 rounded-lg border bg-background flex items-center justify-center text-xs font-semibold tabular-nums">
        {step.n}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{step.title}</div>
        <div className="text-xs text-muted-foreground truncate">
          {step.gate}
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <Input
          type="number"
          min={1}
          step={1}
          value={weeks}
          placeholder={String(step.gantt?.weeks ?? "")}
          onChange={(e) => setWeeks(e.target.value)}
          onBlur={() => {
            if (weeks !== (value ?? "")) onCommit(weeks);
          }}
          className="w-16 tabular-nums text-right"
        />
        <span className="text-xs text-muted-foreground">wks</span>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  badge,
  on,
  onToggle
}: {
  label: string;
  badge?: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border px-3 py-2",
        !on && "opacity-60 bg-muted/40"
      )}
    >
      <span className="flex-1 text-sm font-medium">{label}</span>
      {badge ? (
        <span className="text-xxs uppercase tracking-wide rounded px-1.5 py-0.5 border text-muted-foreground font-medium">
          {badge}
        </span>
      ) : null}
      <Button variant={on ? "secondary" : "ghost"} size="sm" onClick={onToggle}>
        {on ? "Included" : "Excluded"}
      </Button>
    </div>
  );
}

function DateRow({
  label,
  value,
  onChange
}: {
  label: string;
  value: string | undefined;
  onChange: (iso: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 flex-1 min-w-0">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <DatePicker
        aria-label={label}
        value={toCalendarDate(value)}
        onChange={(d) => onChange(d ? d.toString() : "")}
      />
    </label>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
