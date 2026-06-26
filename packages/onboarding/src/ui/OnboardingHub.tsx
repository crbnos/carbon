import { Button, cn } from "@carbon/react";
import { useEffect, useRef } from "react";
import {
  LuArrowRight,
  LuArrowUpRight,
  LuCheck,
  LuCircleHelp,
  LuPartyPopper,
  LuPlay,
  LuRocket
} from "react-icons/lu";
import { SPINE } from "../content/spine";
import {
  effectiveGateStatus,
  effectiveProductStatus,
  gatesDone,
  type NextAction,
  nextAction,
  ownerForStep,
  type Signals,
  spineForTier
} from "../logic";
import type { GateValue, StepDef, Tier } from "../types";
import { GuidedUpsellCard } from "./GuidedUpsellCard";
import { OWNER_TOKENS } from "./primitives";
import { useCheckMap, useSignals, useTier } from "./state";

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
  const spine = spineForTier(SPINE, tier);

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
    done === total
      ? "Live on Carbon"
      : done === 0
        ? `${total} phases to go live`
        : `${remaining} ${remaining === 1 ? "phase" : "phases"} left`;

  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col gap-6">
      <header className="flex flex-col items-center text-center gap-3 pt-2">
        <div className="size-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-1">
          <LuRocket className="text-2xl text-primary" />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-balance">
          {companyName ? `Welcome, ${companyName}` : "Getting set up"}
        </h1>
        <p className="text-base text-muted-foreground max-w-xl text-pretty">
          {total} phases to get your shop live on Carbon. Each one ends at a
          checkpoint. You and the Carbon team work from the same view.
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
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 shadow-button-base p-6 flex items-center gap-4 motion-safe:animate-in motion-safe:fade-in-50 motion-safe:zoom-in-95 motion-safe:duration-500">
          <div className="shrink-0 size-12 rounded-2xl bg-emerald-500/15 flex items-center justify-center">
            <LuPartyPopper className="text-2xl text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-lg font-semibold tracking-tight">
              You're live on Carbon
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              All {total} phases are done. Nice work — your team is up and
              running.
            </p>
          </div>
          {onExit ? (
            <Button variant="primary" className="shrink-0" onClick={onExit}>
              Finish onboarding
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-2xl border bg-card shadow-button-base overflow-hidden">
        <div className="flex items-end justify-between gap-4 flex-wrap p-6 pb-4 border-b">
          <div className="text-2xl font-semibold tracking-tight">
            <span className="text-primary tabular-nums">{done}</span> of {total}{" "}
            phases complete
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
            const st = effectiveGateStatus(step, map, signals);
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
              status={effectiveGateStatus(step, map, signals)}
              map={map}
              signals={signals}
              onOpenInPlan={onOpenInPlan}
            />
          ))}
        </ul>
      </div>

      {tier === "self_serve" && onContactExpert ? (
        <GuidedUpsellCard onContactExpert={onContactExpert} />
      ) : null}
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
  const product = action.productStep;
  const videoUrl = product?.videoKey
    ? resolveVideoUrl?.(product.videoKey)
    : undefined;

  return (
    <div className="rounded-2xl border border-primary/30 bg-primary/5 shadow-button-base p-5 flex items-start gap-4 motion-safe:animate-in motion-safe:fade-in-50 motion-safe:slide-in-from-bottom-2 motion-safe:duration-300">
      <div className="shrink-0 size-9 rounded-xl bg-primary/15 flex items-center justify-center text-sm font-semibold tabular-nums text-primary">
        {action.gateNumber}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xxs uppercase tracking-wide font-medium text-primary">
          Next step
        </div>
        <div className="text-base font-semibold tracking-tight mt-0.5">
          {action.title}
        </div>
        {action.detail ? (
          <p className="text-sm text-muted-foreground mt-1">{action.detail}</p>
        ) : null}
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          {product ? (
            <Button
              leftIcon={<LuArrowRight />}
              onClick={() => onOpenProduct(product.key)}
            >
              {product.cta ?? "Open in Carbon"}
            </Button>
          ) : (
            <Button
              leftIcon={<LuArrowRight />}
              onClick={() => onOpenPage(action.refSlug)}
            >
              {`Go to ${action.refTitle}`}
            </Button>
          )}
          {videoUrl ? (
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<LuPlay />}
              onClick={() => window.open(videoUrl, "_blank", "noopener")}
            >
              Watch
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
              Docs
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// A flat gate row. No inline accordion — the per-step breakdown lives in the
// Project Plan, so clicking the row jumps to that step's plan card. The status
// box is display-only here: gates are completed in the plan (by ticking tasks or
// the gate itself), and this command center reflects that state.
function GateRow({
  step,
  tier,
  status,
  map,
  signals,
  onOpenInPlan
}: {
  step: StepDef;
  tier: Tier;
  status: GateValue;
  map: Map<string, string>;
  signals: Signals;
  onOpenInPlan: (stepKey: string) => void;
}) {
  const nested = step.nested ?? [];
  const nestedDone = nested.filter(
    (n) => effectiveProductStatus(n, map, signals) === "done"
  ).length;

  return (
    <li className="p-5 pl-6 transition-colors hover:bg-primary/[0.02]">
      <div className="flex items-start gap-4">
        <button
          type="button"
          onClick={() => onOpenInPlan(step.key)}
          aria-label={`${step.title} · ${status}. Update this in the project plan.`}
          title="Update this in the project plan"
          className="shrink-0 rounded-md"
        >
          <StatusBox status={status} interactive={false} ariaLabel="" />
        </button>
        <button
          type="button"
          onClick={() => onOpenInPlan(step.key)}
          className="flex-1 min-w-0 text-left group"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={cn(
                "text-sm font-semibold transition-colors group-hover:text-primary",
                status === "done" && "text-muted-foreground"
              )}
            >
              {step.n} · {step.title}
            </span>
            <span className="text-xxs uppercase tracking-wide rounded px-1.5 py-0.5 border text-muted-foreground font-medium">
              Checkpoint: {step.gate}
            </span>
            {nested.length ? (
              <span className="text-xxs text-muted-foreground tabular-nums">
                {nestedDone}/{nested.length} done
              </span>
            ) : null}
            {tier !== "self_serve" ? (
              <span className="text-xxs uppercase tracking-wide rounded px-1.5 py-0.5 border text-muted-foreground font-medium ml-auto">
                {OWNER_TOKENS[ownerForStep(step, tier)].label}
              </span>
            ) : null}
            <LuArrowRight
              className={cn(
                "size-4 shrink-0 text-muted-foreground/50 transition group-hover:translate-x-0.5 group-hover:text-primary",
                tier === "self_serve" && "ml-auto"
              )}
            />
          </div>
          {step.desc ? (
            <p className="text-sm text-muted-foreground mt-1">{step.desc}</p>
          ) : null}
          <span className="text-xxs font-medium text-muted-foreground/80 mt-2 inline-block transition-colors group-hover:text-primary">
            View in project plan
          </span>
        </button>
      </div>
    </li>
  );
}

function StatusBox({
  status,
  small,
  ariaLabel,
  onClick,
  interactive = true
}: {
  status: GateValue;
  small?: boolean;
  ariaLabel: string;
  onClick?: () => void;
  interactive?: boolean;
}) {
  const boxClass = cn(
    "shrink-0 flex items-center justify-center rounded-md border transition-colors",
    small ? "size-5 mt-0.5" : "size-6 mt-0.5",
    interactive && "active:scale-[0.96]",
    status === "done"
      ? "bg-emerald-500 border-emerald-500 text-white"
      : status === "prog"
        ? "border-primary text-primary bg-primary/10"
        : cn(
            "bg-card border-input text-transparent",
            interactive && "hover:border-primary"
          )
  );

  const content =
    status === "done" ? (
      <LuCheck className={small ? "size-3" : "size-3.5"} />
    ) : status === "prog" ? (
      <span
        className={cn("rounded-full bg-primary", small ? "size-1.5" : "size-2")}
      />
    ) : (
      <LuCircleHelp className="size-0" />
    );

  // Derived gates (those with nested steps) are not manual checkboxes — they
  // reflect their steps, so render a non-interactive indicator instead.
  if (!interactive) {
    return (
      <span aria-label={ariaLabel} title={ariaLabel} className={boxClass}>
        {content}
      </span>
    );
  }

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className={boxClass}
    >
      {content}
    </button>
  );
}
