import { Badge, Button, cn } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import {
  LuArrowUpRight,
  LuChevronDown,
  LuChevronRight,
  LuLock
} from "react-icons/lu";
import { GUIDED_MOMENTS, PAGE_COPY } from "../content";
import type { DataSetDef } from "../content/recipes";
import { GuidedMomentCard } from "./GuidedMomentCard";
import {
  DATA_SETS,
  leadSource,
  SOURCE_RECIPES,
  SWITCH_WEEK_SETS
} from "../content/recipes";
import { currentAnswers, taskKey } from "../logic";
import type { HubCountEntry } from "../types";
import { ProgressPill } from "./ProgressPill";
import { PageHeader, Section, SectionList, StatusToggle } from "./primitives";
import {
  useCheckMap,
  useCounts,
  useHubActions,
  useIntakeState,
  useResolveRecordUrl,
  useResolveScreenUrl
} from "./state";

// Load Your Data — "bring your lists in without retyping them." Each data set
// opens with a step-by-step recipe for the factory's ACTUAL source, imports run
// through the existing Bulk Import on each screen, live counts prove momentum,
// and the spot-check (five random records, "do they look right?") is the whole
// self-serve version of data validation: ten minutes, high confidence, zero
// ceremony. Switch-week rows sit greyed at the bottom from day one — nothing
// about the switch is a surprise later.

const COUNT_KEY: Partial<
  Record<DataSetDef["key"], "customers" | "suppliers" | "items">
> = {
  customers: "customers",
  suppliers: "suppliers",
  items: "items"
};

const RECORD_ENTITY: Partial<
  Record<DataSetDef["key"], "customer" | "supplier" | "item">
> = {
  customers: "customer",
  suppliers: "supplier",
  items: "item"
};

export function LoadDataView() {
  const { t, i18n } = useLingui();
  const map = useCheckMap();
  const counts = useCounts();
  const intake = useIntakeState();
  const { setCheck } = useHubActions();
  const resolveScreenUrl = useResolveScreenUrl();
  const resolveRecordUrl = useResolveRecordUrl();
  const [openRecipe, setOpenRecipe] = useState<string | null>(null);

  const answers = currentAnswers(intake);
  const source = leadSource(answers.systems);
  const recipe = SOURCE_RECIPES[source];

  // Pricing only exists for catalog/repeat business — hidden with the same
  // receipt logic as everywhere else (it simply never appears; the How You Run
  // page carries the reason).
  const sets = DATA_SETS.filter(
    (set) =>
      set.key !== "pricing" || (answers.workIntake ?? []).includes("catalog")
  );

  const loaded = sets.filter(
    (set) => map.get(taskKey(set.taskKey)) === "done"
  ).length;

  const totalRecords =
    (counts?.customers.count ?? 0) +
    (counts?.suppliers.count ?? 0) +
    (counts?.items.count ?? 0);

  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col gap-6">
      <PageHeader
        title={i18n._(PAGE_COPY["load-data"].title)}
        lead={i18n._(PAGE_COPY["load-data"].lead)}
        aside={
          <div className="flex flex-col items-end gap-1">
            <ProgressPill done={loaded} total={sets.length} label={t`loaded`} />
            {totalRecords > 0 ? (
              <span className="text-xs text-muted-foreground tabular-nums">
                <Trans>Your factory in Carbon: {totalRecords} records</Trans>
              </span>
            ) : null}
          </div>
        }
      />

      {/* The #1 stall point in the churn data; peak pain, peak relevance. */}
      <GuidedMomentCard {...GUIDED_MOMENTS.loadData} />

      <Section>
        <SectionList>
          {sets.map((set, index) => {
            const key = taskKey(set.taskKey);
            const done = map.get(key) === "done";
            const url = resolveScreenUrl(set.screenKey);
            const countEntry: HubCountEntry | undefined = COUNT_KEY[set.key]
              ? counts?.[COUNT_KEY[set.key]!]
              : set.key === "boms" && counts
                ? { count: counts.bomLines.count, sample: [] }
                : undefined;
            const recipeOpen = openRecipe === set.key;
            const entity = RECORD_ENTITY[set.key];

            return (
              <li key={set.key} className="flex flex-col px-5 py-3 gap-2">
                <div className="flex items-center gap-4">
                  <span className="size-6 rounded-full border flex items-center justify-center text-xs tabular-nums shrink-0">
                    {index + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="group inline-flex items-center gap-1 text-sm font-medium hover:text-primary transition-colors"
                        >
                          {i18n._(set.title)}
                          <LuArrowUpRight className="size-3.5 shrink-0 text-muted-foreground/50 transition group-hover:text-primary" />
                        </a>
                      ) : (
                        <span className="text-sm font-medium">
                          {i18n._(set.title)}
                        </span>
                      )}
                      {countEntry && countEntry.count > 0 ? (
                        <Badge variant="secondary" className="tabular-nums">
                          <Trans>{countEntry.count} in Carbon</Trans>
                        </Badge>
                      ) : null}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {i18n._(set.detail)}
                    </div>
                  </div>
                  <StatusToggle
                    active={done}
                    activeLabel={t`Loaded`}
                    inactiveLabel={t`Not yet`}
                    onToggle={() =>
                      setCheck(key, "task", done ? "todo" : "done")
                    }
                  />
                </div>

                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground w-fit"
                  onClick={() => setOpenRecipe(recipeOpen ? null : set.key)}
                >
                  {recipeOpen ? (
                    <LuChevronDown className="size-3" />
                  ) : (
                    <LuChevronRight className="size-3" />
                  )}
                  <Trans>How to get this out of what you run today</Trans>
                </button>

                {recipeOpen ? (
                  <div className="rounded-lg border bg-muted/30 px-4 py-3 flex flex-col gap-2 text-sm">
                    <ol className="list-decimal ml-4 flex flex-col gap-1">
                      {recipe.map((step, i) => (
                        <li key={i}>{i18n._(step)}</li>
                      ))}
                    </ol>
                    <p className="text-xs text-muted-foreground">
                      {i18n._(set.needs)}
                    </p>
                    {url ? (
                      <div>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            window.open(url, "_blank", "noopener,noreferrer")
                          }
                        >
                          <Trans>Open the screen and use Bulk Import</Trans>
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {/* Spot-check: five random records, "do they look right?" */}
                {entity && countEntry && countEntry.count > 0 && !done ? (
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-muted-foreground">
                      <Trans>Spot-check five — do they look right?</Trans>
                    </span>
                    {countEntry.sample.map((record) => {
                      const recordUrl = resolveRecordUrl(entity, record.id);
                      return recordUrl ? (
                        <a
                          key={record.id}
                          href={recordUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-full border bg-card px-2 py-0.5 hover:text-primary transition-colors truncate max-w-40"
                        >
                          {record.name}
                        </a>
                      ) : null;
                    })}
                  </div>
                ) : null}
              </li>
            );
          })}
        </SectionList>
      </Section>

      {/* Switch-week rows — visible from day one, loaded at the switch so
          they're current. No surprises later. */}
      <Section
        title={<Trans>Loads at switch week — so it's current</Trans>}
        subtitle={
          <Trans>
            These wait on purpose: what's on hand and what's open changes daily,
            so it goes in the weekend you switch.
          </Trans>
        }
      >
        <SectionList>
          {SWITCH_WEEK_SETS.map((set) => (
            <li
              key={set.key}
              className={cn(
                "flex items-center gap-4 px-5 py-3 text-muted-foreground"
              )}
            >
              <LuLock className="size-4 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{i18n._(set.title)}</div>
                <div className="text-xs">{i18n._(set.detail)}</div>
              </div>
              <Badge variant="outline">
                <Trans>Switch week</Trans>
              </Badge>
            </li>
          ))}
        </SectionList>
      </Section>
    </div>
  );
}
