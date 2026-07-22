import { Button, cn } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  LuArrowRight,
  LuCalendarCheck,
  LuEyeOff,
  LuPhone,
  LuSparkles
} from "react-icons/lu";
import { SPINE } from "../content/spine";
import { currentAnswers, setupCounts, spineForTier } from "../logic";
import { useIntakeState, useTailoring, useTier } from "./state";

// "Your plan is ready" — the intake's payoff. Five elements, in order: the
// identity line, the receipts, the clock, the shape, one button. The receipts
// are what make the hub feel lite: not a shorter list, a justified one.

export function PayoffScreen({
  companyName,
  onFirstWin,
  onOpenPlan,
  onBookCall
}: {
  companyName: string;
  onFirstWin: () => void;
  onOpenPlan: () => void;
  onBookCall: () => void;
}) {
  const { i18n } = useLingui();
  const tier = useTier();
  const intake = useIntakeState();
  const tailoring = useTailoring();

  const answers = currentAnswers(intake);
  const counts = setupCounts(tailoring);
  const spine = spineForTier(SPINE, tier);
  const showGuidedAside =
    tier === "self_serve" &&
    (tailoring.flags.length >= 2 ||
      tailoring.flags.some((f) =>
        ["legacy-erp", "regulated-quality", "sites-4", "erp-and-books"].includes(
          f.key
        )
      ));

  return (
    <div className="w-full max-w-2xl mx-auto flex flex-col gap-8 py-10">
      {/* The identity line */}
      <div className="flex flex-col gap-1">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          <Trans>Your plan is ready</Trans>
        </div>
        <h1 className="text-3xl font-semibold">
          <Trans>The {companyName} plan — built around how you run</Trans>
        </h1>
        {answers.product ? (
          <p className="text-sm text-muted-foreground">{answers.product}</p>
        ) : null}
      </div>

      {/* The receipts */}
      <div className="rounded-xl border bg-card px-5 py-4 flex flex-col gap-2">
        <div className="text-sm font-medium flex items-center gap-2">
          <LuEyeOff className="size-4 text-muted-foreground" />
          <Trans>
            Your plan has {counts.visible} setup steps. We hid {counts.hidden}{" "}
            that don't apply to you.
          </Trans>
        </div>
        <ul className="text-sm text-muted-foreground flex flex-col gap-1">
          {tailoring.receipts.map((line, i) => (
            <li key={i}>· {i18n._(line)}</li>
          ))}
        </ul>
      </div>

      {/* The clock */}
      <div className="rounded-xl border bg-card px-5 py-4 flex items-start gap-3">
        <LuCalendarCheck className="size-5 text-primary shrink-0 mt-0.5" />
        <div className="text-sm">
          {answers.goLiveDate ? (
            <div className="font-medium">
              <Trans>Live by {answers.goLiveDate}</Trans>
            </div>
          ) : null}
          <div className="text-muted-foreground">
            <Trans>
              About {tailoring.suggestedWeeks} focused weeks at{" "}
              {i18n._(tailoring.weeklyEffort)}.
            </Trans>
          </div>
        </div>
      </div>

      {/* The shape — the seven phases, glanced at, not studied */}
      <ol className="flex flex-col gap-1.5">
        {spine.map((step, i) => (
          <li
            key={step.key}
            className={cn(
              "flex items-center gap-3 rounded-lg border px-4 py-2.5 text-sm",
              i === 0 ? "border-primary bg-primary/5 font-medium" : "bg-card"
            )}
          >
            <span
              className={cn(
                "size-6 rounded-full border flex items-center justify-center text-xs tabular-nums shrink-0",
                i === 0 && "border-primary text-primary"
              )}
            >
              {step.n}
            </span>
            {i18n._(step.title)}
            <span className="ml-auto text-xs text-muted-foreground">
              {i18n._(step.timing)}
            </span>
          </li>
        ))}
      </ol>

      {/* The honest aside — a heads-up, not a wall */}
      {showGuidedAside ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-5 py-4 text-sm flex flex-col gap-2">
          <div className="flex items-center gap-2 font-medium">
            <LuSparkles className="size-4" />
            <Trans>A heads-up, not a wall</Trans>
          </div>
          <p className="text-muted-foreground">
            <Trans>
              Factories with your complexity usually get live faster with a
              Carbon person alongside them. Self-serve absolutely works too —
              you have the full plan either way. If you want us in it with you,
              that's a 30-minute call.
            </Trans>
          </p>
          <div>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<LuPhone />}
              onClick={onBookCall}
            >
              <Trans>Book a call with Carbon</Trans>
            </Button>
          </div>
        </div>
      ) : null}

      {/* One button */}
      <div className="flex items-center gap-3">
        <Button size="lg" rightIcon={<LuArrowRight />} onClick={onFirstWin}>
          <Trans>Now — see your first part in Carbon</Trans>
        </Button>
        <Button variant="ghost" onClick={onOpenPlan}>
          <Trans>Skip for now — show me the plan</Trans>
        </Button>
      </div>
    </div>
  );
}
