import { Button } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
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
  const { i18n } = useLingui();
  return (
    <section className="rounded-2xl border border-primary/30 bg-primary/5 shadow-button-base p-6 flex items-start gap-4">
      <div className="shrink-0 size-11 rounded-2xl bg-primary/15 flex items-center justify-center text-primary">
        <LuSparkles className="text-xl" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xxs uppercase tracking-wide font-medium text-primary">
          {i18n._(GUIDED_UPSELL.eyebrow)}
        </div>
        <div className="text-base font-semibold tracking-tight mt-0.5 text-balance">
          {i18n._(GUIDED_UPSELL.heading)}
        </div>
        <p className="text-sm text-muted-foreground mt-1 text-pretty">
          {i18n._(GUIDED_UPSELL.body)}
        </p>
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
          {GUIDED_UPSELL.points.map((point, index) => (
            <li
              key={index}
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              <LuCheck className="size-3.5 shrink-0 text-primary" />
              {i18n._(point)}
            </li>
          ))}
        </ul>
        <Button
          className="mt-4"
          onClick={onContactExpert}
          rightIcon={<LuArrowRight />}
        >
          {i18n._(GUIDED_UPSELL.cta)}
        </Button>
      </div>
    </section>
  );
}
