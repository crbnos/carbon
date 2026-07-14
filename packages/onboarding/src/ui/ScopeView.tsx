import { Button, cn } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
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
  const { t, i18n } = useLingui();
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
  ).map((m) => `${i18n._(MODULE_NAME[m])} ${t`(excluded for this customer)`}`);

  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col gap-6">
      <PageHeader
        title={i18n._(PAGE_COPY.scope.title)}
        lead={i18n._(
          tier === "self_serve" ? SCOPE_LEAD_SELF_SERVE : PAGE_COPY.scope.lead
        )}
      />

      <Panel title={<Trans>The goal</Trans>}>
        <EditableField
          fieldKey="scope.goal"
          value={fields.get("scope.goal")}
          defaultValue={SCOPE_GOAL_DEFAULT}
          multiline
          className="leading-relaxed"
        />
        {canEdit ? (
          <p className="text-xxs text-muted-foreground mt-2">
            {i18n._(UI_TEXT.carbonOnlyLockedField)}
          </p>
        ) : null}
      </Panel>

      <Panel title={<Trans>What's in scope</Trans>}>
        <ul className="flex flex-col gap-2">
          {inScope.map((item, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm">
              <span className="shrink-0 mt-0.5 size-4 rounded flex items-center justify-center bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <LuCheck className="size-3" />
              </span>
              {i18n._(item.label)}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title={<Trans>What's out of scope</Trans>}>
        <ul className="flex flex-col gap-2">
          {[...scopeOutForTier(tier), ...excludedModuleNotes].map(
            (label, i) => (
              <li
                key={i}
                className="flex items-start gap-2.5 text-sm text-muted-foreground"
              >
                <span className="shrink-0 mt-0.5 size-4 rounded flex items-center justify-center border text-muted-foreground">
                  <LuX className="size-3" />
                </span>
                {typeof label === "string" ? label : i18n._(label)}
              </li>
            )
          )}
        </ul>
      </Panel>

      <Panel title={<Trans>What we're assuming</Trans>}>
        <ul className="flex flex-col gap-2">
          {scopeAssumptionsForTier(tier).map((label, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm">
              <span className="shrink-0 mt-1.5 size-1.5 rounded-full bg-muted-foreground/50" />
              {typeof label === "string" ? label : i18n._(label)}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title={<Trans>How we know we're done</Trans>}>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {i18n._(scopeDoneForTier(tier))}
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
              <div className="text-sm font-semibold">
                <Trans>Scope agreed</Trans>
              </div>
              <div className="text-xs text-muted-foreground">
                <Trans>This completes the Discovery step.</Trans>
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setGate(gateKey("discovery"), "todo")}
            >
              <Trans>Undo</Trans>
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold">
                <Trans>Agree on the scope</Trans>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                <Trans>
                  When this looks right, mark it agreed. That completes the
                  Discovery step on your command center.
                </Trans>
              </p>
            </div>
            <Button onClick={() => setGate(gateKey("discovery"), "done")}>
              <Trans>Mark scope as agreed</Trans>
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
