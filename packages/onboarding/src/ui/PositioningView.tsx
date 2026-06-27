import { Trans, useLingui } from "@lingui/react/macro";
import {
  CARBON_STRENGTHS,
  OTHER_STRENGTHS,
  type VsPoint
} from "../content/positioning";

export function PositioningView() {
  const { t } = useLingui();
  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col gap-6">
      <div className="inline-flex items-center gap-2 self-start rounded-full bg-red-500/10 px-3 py-1 text-xs font-medium text-red-600 dark:text-red-400">
        <span className="size-1.5 rounded-full bg-red-500" />
        <Trans>Internal only · not for customers</Trans>
      </div>

      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          <Trans>Others vs Carbon</Trans>
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl text-pretty">
          <Trans>
            Internal reference for where each tool is stronger. Use it to set
            expectations honestly, not to oversell.
          </Trans>
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <VsColumn
          title={t`What others do better`}
          tone="red"
          points={OTHER_STRENGTHS}
        />
        <VsColumn
          title={t`What Carbon does better`}
          tone="blue"
          points={CARBON_STRENGTHS}
        />
      </div>
    </div>
  );
}

function VsColumn({
  title,
  tone,
  points
}: {
  title: string;
  tone: "red" | "blue";
  points: VsPoint[];
}) {
  const { i18n } = useLingui();
  return (
    <section className="rounded-2xl border bg-card shadow-button-base p-5">
      <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
        <span
          className={
            tone === "red"
              ? "size-2 rounded-full bg-red-500"
              : "size-2 rounded-full bg-blue-500"
          }
        />
        {title}
      </h2>
      <div className="flex flex-col gap-4">
        {points.map((p, i) => (
          <div key={i}>
            <div className="text-sm font-medium">{i18n._(p.lead)}</div>
            <div className="text-sm text-muted-foreground mt-0.5">
              {i18n._(p.body)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
