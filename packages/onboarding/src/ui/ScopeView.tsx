import { Button, cn } from "@carbon/react";
import { LuCheck, LuX } from "react-icons/lu";
import { PAGE_COPY, UI_TEXT } from "../content";
import {
  SCOPE_GOAL_DEFAULT,
  SCOPE_IN,
  SCOPE_LEAD_SELF_SERVE,
  scopeAssumptionsForTier,
  scopeDoneForTier,
  scopeOutForTier
} from "../content/scope";
import { filterByModule, gateKey } from "../logic";
import { MODULE_NAME, MODULES } from "../types";
import { EditableField } from "./EditableField";
import { PageHeader, Panel } from "./primitives";
import {
  useCanEdit,
  useCheckMap,
  useExclusions,
  useFieldMap,
  useHubActions,
  useTier
} from "./state";

export function ScopeView() {
  const canEdit = useCanEdit();
  const map = useCheckMap();
  const tier = useTier();
  const exclusions = useExclusions();
  const fields = useFieldMap();
  const { setGate } = useHubActions();

  const agreed = map.get(gateKey("discovery")) === "done";
  const inScope = filterByModule(
    SCOPE_IN.filter((i) => !i.tiers || i.tiers.includes(tier)),
    exclusions.modules
  );
  const excludedModuleNotes = MODULES.filter((m) =>
    exclusions.modules.includes(m)
  ).map((m) => `${MODULE_NAME[m]} (excluded for this customer)`);

  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col gap-6">
      <PageHeader
        title={PAGE_COPY.scope.title}
        lead={
          tier === "self_serve" ? SCOPE_LEAD_SELF_SERVE : PAGE_COPY.scope.lead
        }
      />

      <Panel title="The goal">
        <EditableField
          fieldKey="scope.goal"
          value={fields.get("scope.goal")}
          defaultValue={SCOPE_GOAL_DEFAULT}
          multiline
          className="leading-relaxed"
        />
        {canEdit ? (
          <p className="text-xxs text-muted-foreground mt-2">
            {UI_TEXT.carbonOnlyLockedField}
          </p>
        ) : null}
      </Panel>

      <Panel title="What's in scope">
        <ul className="flex flex-col gap-2">
          {inScope.map((item) => (
            <li key={item.label} className="flex items-start gap-2.5 text-sm">
              <span className="shrink-0 mt-0.5 size-4 rounded flex items-center justify-center bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <LuCheck className="size-3" />
              </span>
              {item.label}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="What's out of scope">
        <ul className="flex flex-col gap-2">
          {[...scopeOutForTier(tier), ...excludedModuleNotes].map((label) => (
            <li
              key={label}
              className="flex items-start gap-2.5 text-sm text-muted-foreground"
            >
              <span className="shrink-0 mt-0.5 size-4 rounded flex items-center justify-center border text-muted-foreground">
                <LuX className="size-3" />
              </span>
              {label}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="What we're assuming">
        <ul className="flex flex-col gap-2">
          {scopeAssumptionsForTier(tier).map((label) => (
            <li key={label} className="flex items-start gap-2.5 text-sm">
              <span className="shrink-0 mt-1.5 size-1.5 rounded-full bg-muted-foreground/50" />
              {label}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="How we know we're done">
        <p className="text-sm leading-relaxed text-muted-foreground">
          {scopeDoneForTier(tier)}
        </p>
      </Panel>

      <section
        className={cn(
          "rounded-2xl border p-5 shadow-button-base",
          agreed
            ? "border-emerald-500/30 bg-emerald-500/5"
            : "border-primary/30 bg-primary/5"
        )}
      >
        {agreed ? (
          <div className="flex items-center gap-3">
            <span className="shrink-0 size-9 rounded-xl bg-emerald-500/15 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <LuCheck />
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold">Scope agreed</div>
              <div className="text-xs text-muted-foreground">
                This completes the Discovery step.
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setGate(gateKey("discovery"), "todo")}
            >
              Undo
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold">Agree on the scope</div>
              <p className="text-xs text-muted-foreground mt-0.5">
                When this looks right, mark it agreed. That completes the
                Discovery step on your command center.
              </p>
            </div>
            <Button onClick={() => setGate(gateKey("discovery"), "done")}>
              Mark scope as agreed
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
