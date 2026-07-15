import { Badge, Button, cn } from "@carbon/react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef } from "react";
import {
  LuArrowRight,
  LuArrowUpRight,
  LuPartyPopper,
  LuPlay
} from "react-icons/lu";
import { BOARD_TASKS, boardTasksForScope } from "../content/board";
import { SPINE } from "../content/spine";
import {
  boardTasksForTier,
  effectiveGateStatus,
  gatesDone,
  type NextAction,
  nextAction,
  ownerForStep,
  spineForTier,
  stepTaskProgress
} from "../logic";
import type { GateValue, StepDef, Tier } from "../types";
import { GanttChart } from "./GanttChart";
import { GuidedUpsellCard } from "./GuidedUpsellCard";
import { DerivedStatus, OWNER_TOKENS } from "./primitives";
import { useCheckMap, useExclusions, useSignals, useTier } from "./state";

// Carbon-app routing + video resolution are injected by the ERP route (they use
// `path.to` / trainingConfig). Hub state comes from the store.
type OnboardingHubProps = {
  companyName?: string;
  resolveVideoUrl?: (videoKey: string) => string | undefined;
  // Navigate to the real Carbon screen for a product step, or to a hub page.
  onOpenProduct: (productKey: string) => void;
  onOpenPage: (slug: string) => void;
  // Jump to the matching step card in the Plan view (by spine step key).
  onOpenInPlan: (stepKey: string) => void;
  // Fired once each time every gate flips to done (the celebration trigger). The
  // ERP route owns the confetti so the package needs no animation dep.
  onComplete?: () => void;
  // Finish + leave the implementation hub (ERP opens the exit dialog). Shown on
  // the completion card once every phase is done.
  onExit?: () => void;
  // Book a call with Carbon (Calendly). When provided on a self-serve hub, the
  // Guided-implementation upsell card is shown.
  onContactExpert?: () => void;
};

export function OnboardingHub({
  companyName,
  resolveVideoUrl,
  onOpenProduct,
  onOpenPage,
  onOpenInPlan,
  onComplete,
  onExit,
  onContactExpert
}: OnboardingHubProps) {
  const tier = useTier();
  const map = useCheckMap();
  const signals = useSignals();
  const exclusions = useExclusions();
  const spine = spineForTier(SPINE, tier);
  const tasks = boardTasksForScope(
    boardTasksForTier(BOARD_TASKS, tier),
    exclusions.modules
  );

  const done = gatesDone(spine, map, signals);
  const total = spine.length;
  const remaining = total - done;
  const next = nextAction(spine, map, signals);

  // Fire onComplete only on a live transition into "all done" within this mount.
  // The ref seeds from the current value, so an already-complete hub (reload or
  // revisit) does NOT re-celebrate — the post-completion navigation carries its
  // own celebrate flag instead (see the ERP route).
  const isComplete = total > 0 && done === total;
  const wasComplete = useRef(isComplete);
  useEffect(() => {
    if (isComplete && !wasComplete.current) onComplete?.();
    wasComplete.current = isComplete;
  }, [isComplete, onComplete]);

  const stateText =
    done === total ? (
      <Trans>Live on Carbon</Trans>
    ) : done === 0 ? (
      <Trans>{total} phases to go live</Trans>
    ) : (
      <Plural value={remaining} one="# phase left" other="# phases left" />
    );

  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col gap-6">
      <header className="flex flex-col items-center text-center gap-3 pt-2">
        <div className="size-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-1">
          <img
            src="/carbon-mark-light.svg"
            alt="Carbon"
            className="size-7 dark:hidden"
          />
          <img
            src="/carbon-mark-dark.svg"
            alt="Carbon"
            className="size-7 hidden dark:block"
          />
        </div>
        <h1 className="text-3xl font-medium tracking-tight text-balance">
          {companyName ? (
            <Trans>Welcome, {companyName}</Trans>
          ) : (
            <Trans>Getting set up</Trans>
          )}
        </h1>
        <p className="text-base text-muted-foreground max-w-xl text-pretty">
          <Trans>
            {total} phases to get your company live on Carbon. Each one ends at
            a checkpoint.
          </Trans>
        </p>
      </header>

      {next ? (
        <NextStepCard
          action={next}
          onOpenProduct={onOpenProduct}
          onOpenPage={onOpenPage}
          resolveVideoUrl={resolveVideoUrl}
        />
      ) : null}

      {done === total ? (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-6 flex items-center gap-4 motion-safe:animate-in motion-safe:fade-in-50 motion-safe:zoom-in-95 motion-safe:duration-500">
          <div className="shrink-0 size-12 rounded-2xl bg-emerald-500/15 flex items-center justify-center">
            <LuPartyPopper className="text-2xl text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-lg font-medium tracking-tight">
              <Trans>You're live on Carbon</Trans>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              <Trans>
                All {total} phases are done. Nice work — your team is up and
                running.
              </Trans>
            </p>
          </div>
          {onExit ? (
            <Button variant="primary" className="shrink-0" onClick={onExit}>
              <Trans>Finish onboarding</Trans>
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-2xl border bg-card overflow-hidden">
        <div className="flex items-end justify-between gap-4 flex-wrap p-6 pb-4 border-b">
          <div className="text-base font-medium tracking-tight">
            <Trans>
              {done} of {total} phases complete
            </Trans>
          </div>
          <span className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <span
              className={cn(
                "size-2 rounded-full",
                done === total ? "bg-emerald-500" : "bg-primary"
              )}
            />
            {stateText}
          </span>
        </div>

        <div className="flex gap-1.5 px-6 py-4">
          {spine.map((step) => {
            const st = effectiveGateStatus(
              step,
              map,
              signals,
              stepTaskProgress(tasks, step.key, map)
            );
            return (
              <div
                key={step.key}
                className={cn(
                  "flex-1 h-2.5 rounded-full transition-colors",
                  st === "done"
                    ? "bg-emerald-500"
                    : st === "prog"
                      ? "bg-primary"
                      : "bg-border"
                )}
              />
            );
          })}
        </div>

        <ul className="divide-y">
          {spine.map((step) => (
            <GateRow
              key={step.key}
              step={step}
              tier={tier}
              status={effectiveGateStatus(
                step,
                map,
                signals,
                stepTaskProgress(tasks, step.key, map)
              )}
              progress={stepTaskProgress(tasks, step.key, map)}
              onOpenInPlan={onOpenInPlan}
            />
          ))}
        </ul>
      </div>

      {tier === "self_serve" && onContactExpert ? (
        <GuidedUpsellCard onContactExpert={onContactExpert} />
      ) : null}

      <GanttChart steps={spine} />
    </div>
  );
}

// The guided focal point: the one thing to do next, with a CTA into the real
// Carbon screen (or the hub page that backs the gate).
function NextStepCard({
  action,
  onOpenProduct,
  onOpenPage,
  resolveVideoUrl
}: {
  action: NextAction;
  onOpenProduct: (productKey: string) => void;
  onOpenPage: (slug: string) => void;
  resolveVideoUrl?: (videoKey: string) => string | undefined;
}) {
  const { t, i18n } = useLingui();
  const product = action.productStep;
  const videoUrl = product?.videoKey
    ? resolveVideoUrl?.(product.videoKey)
    : undefined;

  return (
    <div className="rounded-2xl border border-border p-5 flex items-start gap-4 motion-safe:animate-in motion-safe:fade-in-50 motion-safe:slide-in-from-bottom-2 motion-safe:duration-300">
      <div className="shrink-0 size-9 rounded-xl bg-primary/15 flex items-center justify-center text-sm font-medium tabular-nums text-primary">
        {action.gateNumber}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xxs uppercase text-muted-foreground tracking-wide font-medium">
          <Trans>Next step</Trans>
        </div>
        <div className="text-base font-medium tracking-tight mt-0.5">
          {i18n._(action.title)}
        </div>
        {action.detail ? (
          <p className="text-sm text-muted-foreground mt-1">
            {i18n._(action.detail)}
          </p>
        ) : null}
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          {product ? (
            <Button
              leftIcon={<LuArrowRight />}
              onClick={() => onOpenProduct(product.key)}
            >
              {product.cta ? i18n._(product.cta) : t`Open in Carbon`}
            </Button>
          ) : (
            <Button
              leftIcon={<LuArrowRight />}
              onClick={() => onOpenPage(action.refSlug)}
            >
              <Trans>Go to {i18n._(action.refTitle)}</Trans>
            </Button>
          )}
          {videoUrl ? (
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<LuPlay />}
              onClick={() => window.open(videoUrl, "_blank", "noopener")}
            >
              <Trans>Watch</Trans>
            </Button>
          ) : null}
          {product?.docsUrl ? (
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<LuArrowUpRight />}
              onClick={() =>
                window.open(product.docsUrl, "_blank", "noopener,noreferrer")
              }
            >
              <Trans>Docs</Trans>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// A flat gate row. No inline accordion — the per-step breakdown lives in the
// Project Plan, so clicking the row jumps to that step's plan card. The status
// indicator is display-only (and deliberately not a checkbox): phases complete
// on their own as their plan tasks finish, and this command center reflects
// that state.
function GateRow({
  step,
  tier,
  status,
  progress,
  onOpenInPlan
}: {
  step: StepDef;
  tier: Tier;
  status: GateValue;
  progress: { done: number; total: number };
  onOpenInPlan: (stepKey: string) => void;
}) {
  const { t, i18n } = useLingui();

  return (
    <li className="p-5 pl-6 transition-colors hover:bg-primary/[0.02]">
      <div className="flex items-start gap-4">
        <DerivedStatus
          status={status}
          fraction={
            progress.total > 0 ? progress.done / progress.total : undefined
          }
          tooltip={
            status === "done"
              ? t`The "${i18n._(step.title)}" phase is done — its "${i18n._(step.gate)}" checkpoint has been passed.`
              : t`The "${i18n._(step.title)}" phase checks itself off once all of its tasks in the project plan are done.`
          }
          className="size-5 mt-1"
        />
        <button
          type="button"
          onClick={() => onOpenInPlan(step.key)}
          className="flex-1 min-w-0 text-left group"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={cn(
                "text-sm font-medium transition-colors group-hover:text-primary",
                status === "done" && "line-through text-muted-foreground"
              )}
            >
              {step.n} · {i18n._(step.title)}
            </span>
            {progress.total > 0 ? (
              <span className="text-xxs text-muted-foreground tabular-nums">
                {progress.done}/{progress.total} <Trans>done</Trans>
              </span>
            ) : null}
            {tier !== "self_serve" ? (
              <Badge variant="outline" className="ml-auto">
                {i18n._(OWNER_TOKENS[ownerForStep(step, tier)].label)}
              </Badge>
            ) : null}
            <LuArrowRight
              className={cn(
                "size-4 shrink-0 text-muted-foreground/50 transition group-hover:translate-x-0.5 group-hover:text-primary",
                tier === "self_serve" && "ml-auto"
              )}
            />
          </div>
          {step.desc ? (
            <p className="text-sm text-muted-foreground mt-1">
              {i18n._(step.desc)}
            </p>
          ) : null}
          <span className="text-xxs font-medium text-muted-foreground/80 mt-2 inline-block transition-colors group-hover:text-primary">
            <Trans>View in project plan</Trans>
          </span>
        </button>
      </div>
    </li>
  );
}
