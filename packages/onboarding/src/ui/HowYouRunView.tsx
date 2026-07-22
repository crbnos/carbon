import { Badge, Button } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuEyeOff, LuPencil, LuTriangleAlert } from "react-icons/lu";
import { PAGE_COPY } from "../content";
import type { IntakeAnswers } from "../content/intake";
import { INTAKE_QUESTIONS } from "../content/intake";
import { currentAnswers, setupCounts } from "../logic";
import { PageHeader, Panel } from "./primitives";
import { useIntakeState, useTailoring } from "./state";

// "How You Run" — the intake's permanent home in the hub: the current answers,
// the receipts they produced, and the door back into the wizard ("Retune my
// plan"). Answers are never locked in; changing one re-tailors the plan and
// shows exactly what moves before anything applies.

const display = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return value.length ? value.join(", ") : null;
  if (typeof value === "boolean") return value ? "yes" : "no";
  const text = String(value);
  return text.length ? text : null;
};

export function HowYouRunView({ onRetune }: { onRetune: () => void }) {
  const { t, i18n } = useLingui();
  const intake = useIntakeState();
  const tailoring = useTailoring();

  const answers = currentAnswers(intake);
  const counts = setupCounts(tailoring);
  const answered = INTAKE_QUESTIONS.flatMap((q) => {
    const keys =
      q.kind === "owner"
        ? (["ownerName", "ownerEmail"] as const)
        : q.kind === "upload"
          ? (["uploadName"] as const)
          : ([q.key] as (keyof IntakeAnswers)[]);
    const value = keys
      .map((key) => display(answers[key as keyof IntakeAnswers]))
      .filter(Boolean)
      .join(" · ");
    return value ? [{ key: String(q.key), ask: q.ask, value }] : [];
  });

  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col gap-6">
      <PageHeader
        title={i18n._(PAGE_COPY["how-you-run"].title)}
        lead={i18n._(PAGE_COPY["how-you-run"].lead)}
        aside={
          <Button leftIcon={<LuPencil />} onClick={onRetune}>
            {intake.current ? (
              <Trans>Retune my plan</Trans>
            ) : (
              <Trans>Start the questions</Trans>
            )}
          </Button>
        }
      />

      {tailoring.conflicts.map((line, i) => (
        <div
          key={i}
          className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm flex gap-2"
        >
          <LuTriangleAlert className="size-4 shrink-0 mt-0.5" />
          {i18n._(line)}
        </div>
      ))}

      {intake.current ? (
        <>
          <Panel
            title={<Trans>What your answers shaped</Trans>}
            aside={
              <Badge variant="secondary">
                <LuEyeOff className="size-3 mr-1" />
                {t`${counts.hidden} steps hidden`}
              </Badge>
            }
          >
            <ul className="text-sm text-muted-foreground flex flex-col gap-1">
              {tailoring.receipts.map((line, i) => (
                <li key={i}>· {i18n._(line)}</li>
              ))}
              {tailoring.receipts.length === 0 ? (
                <li>
                  <Trans>
                    Everything applies to you — nothing needed hiding.
                  </Trans>
                </li>
              ) : null}
            </ul>
          </Panel>

          <Panel title={<Trans>Your answers</Trans>}>
            <ul className="divide-y">
              {answered.map((row) => (
                <li
                  key={row.key}
                  className="flex items-baseline justify-between gap-6 py-2 text-sm"
                >
                  <span className="text-muted-foreground">
                    {i18n._(row.ask)}
                  </span>
                  <span className="font-medium text-right">{row.value}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </>
      ) : (
        <Panel title={<Trans>Ten minutes, one plan</Trans>}>
          <p className="text-sm text-muted-foreground">
            <Trans>
              Answer the questions and your plan will only contain what applies
              to you — with a reason for everything we hide.
            </Trans>
          </p>
        </Panel>
      )}
    </div>
  );
}
