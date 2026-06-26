import { Button } from "@carbon/react";
import { LuArrowRight, LuCheck, LuSparkles } from "react-icons/lu";
import { GUIDED_UPSELL } from "../content";

// Self-serve upsell for the Guided tier. Rendered by the command center only when
// the hub is self-serve and the ERP route wires `onContactExpert` (opens the
// booking link). Copy lives in content/support.ts.
export function GuidedUpsellCard({
  onContactExpert
}: {
  onContactExpert: () => void;
}) {
  return (
    <section className="rounded-2xl border border-blue-500/30 bg-blue-500/[0.04] shadow-button-base p-6 flex items-start gap-4">
      <div className="shrink-0 size-11 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-600 dark:text-blue-400">
        <LuSparkles className="text-xl" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xxs uppercase tracking-wide font-medium text-blue-600 dark:text-blue-400">
          {GUIDED_UPSELL.eyebrow}
        </div>
        <div className="text-base font-semibold tracking-tight mt-0.5 text-balance">
          {GUIDED_UPSELL.heading}
        </div>
        <p className="text-sm text-muted-foreground mt-1 text-pretty">
          {GUIDED_UPSELL.body}
        </p>
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
          {GUIDED_UPSELL.points.map((point) => (
            <li
              key={point}
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              <LuCheck className="size-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
              {point}
            </li>
          ))}
        </ul>
        <Button
          className="mt-4"
          onClick={onContactExpert}
          rightIcon={<LuArrowRight />}
        >
          {GUIDED_UPSELL.cta}
        </Button>
      </div>
    </section>
  );
}
