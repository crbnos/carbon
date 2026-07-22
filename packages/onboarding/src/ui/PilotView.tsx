import { Button } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuCheck, LuFlag, LuRepeat } from "react-icons/lu";
import { PAGE_COPY } from "../content";
import { PILOT_COPY, PILOT_STAGES } from "../content/pilot";
import { checkKey, currentAnswers, gateKey } from "../logic";
import { ProgressPill } from "./ProgressPill";
import { PageHeader, Panel, Section, SectionList } from "./primitives";
import {
  useCheckMap,
  useHubActions,
  useIntakeState,
  useSignals,
  useTailoring
} from "./state";

// Prove It Works — the self-verifying trace. Each stage checks itself when its
// document appears in Carbon (manual tick stays available for what the product
// can't see). When the trace completes, the gate celebrates.

export function PilotView() {
  const { t, i18n } = useLingui();
  const map = useCheckMap();
  const signals = useSignals();
  const intake = useIntakeState();
  const tailoring = useTailoring();
  const { toggleFlag, setGate } = useHubActions();

  const answers = currentAnswers(intake);
  const stages = PILOT_STAGES.filter(
    (stage) => !stage.appliesTo || stage.appliesTo(answers)
  );

  const stageDone = (stage: (typeof stages)[number]) =>
    (stage.detect && signals[stage.detect]) ||
    map.get(checkKey("pilot", stage.key)) === "1";

  const done = stages.filter(stageDone).length;
  const complete = done === stages.length;
  const gateDone = map.get(gateKey("pilot")) === "done";

  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col gap-6">
      <PageHeader
        title={i18n._(PAGE_COPY.pilot.title)}
        lead={i18n._(PAGE_COPY.pilot.lead)}
        aside={
          <ProgressPill done={done} total={stages.length} label={t`traced`} />
        }
      />

      <Panel title={<Trans>The setup — two minutes</Trans>}>
        <p className="text-sm text-muted-foreground">
          {i18n._(PILOT_COPY.setupLead)}
        </p>
      </Panel>

      <Section title={<Trans>The trace</Trans>}>
        <SectionList>
          {stages.map((stage, index) => {
            const isDone = stageDone(stage);
            const auto = stage.detect ? signals[stage.detect] : false;
            const manualKey = checkKey("pilot", stage.key);
            return (
              <li key={stage.key} className="flex items-center gap-4 px-5 py-3">
                <span className="size-6 rounded-full border flex items-center justify-center text-xs tabular-nums shrink-0">
                  {index + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">
                    {i18n._(stage.label)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {i18n._(stage.detail)}
                  </div>
                </div>
                {isDone ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                    <LuCheck className="size-4" />
                    {auto ? (
                      <Trans>Verified itself</Trans>
                    ) : (
                      <Trans>Done</Trans>
                    )}
                  </span>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => toggleFlag(manualKey, "check", true)}
                  >
                    <Trans>Mark done</Trans>
                  </Button>
                )}
              </li>
            );
          })}
        </SectionList>
      </Section>

      {complete && !gateDone ? (
        <Panel>
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm font-medium">{i18n._(PILOT_COPY.done)}</p>
            <Button
              leftIcon={<LuFlag />}
              onClick={() => setGate(gateKey("pilot"), "done")}
            >
              <Trans>Mark it proven</Trans>
            </Button>
          </div>
        </Panel>
      ) : null}

      {tailoring.band !== "simple" ? (
        <Panel
          title={
            <span className="inline-flex items-center gap-2">
              <LuRepeat className="size-4" />
              <Trans>Lap two</Trans>
            </span>
          }
        >
          <p className="text-sm text-muted-foreground">
            {i18n._(PILOT_COPY.lapTwo)}
          </p>
        </Panel>
      ) : null}

      <Panel title={<Trans>The graduation run</Trans>}>
        <p className="text-sm text-muted-foreground">
          {i18n._(PILOT_COPY.graduation)}
        </p>
      </Panel>
    </div>
  );
}
