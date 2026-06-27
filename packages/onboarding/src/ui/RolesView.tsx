import { cn } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { PAGE_COPY } from "../content";
import { ROLES } from "../content/roles";
import type { Owner } from "../types";
import { OWNER_TOKENS } from "./primitives";

export function RolesView() {
  const { i18n } = useLingui();
  const yourItems = ROLES.flatMap((s) =>
    s.lines
      .filter((l) => l.owner === "you")
      .map((l) => ({ step: s.title, label: l.label }))
  );

  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {i18n._(PAGE_COPY.roles.title)}
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl text-pretty">
          {i18n._(PAGE_COPY.roles.lead)}
        </p>
        <div className="flex items-center gap-4 mt-1">
          {(Object.keys(OWNER_TOKENS) as Owner[]).map((o) => (
            <span
              key={o}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              <span
                className={cn("size-2 rounded-full", OWNER_TOKENS[o].dot)}
              />
              {i18n._(OWNER_TOKENS[o].label)}
            </span>
          ))}
        </div>
      </header>

      <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 shadow-button-base p-5">
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <span className="size-2 rounded-full bg-emerald-500" />
          <Trans>What you need to do</Trans>
        </h2>
        <ul className="flex flex-col gap-2">
          {yourItems.map((item, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm">
              <span className="shrink-0 mt-1.5 size-1.5 rounded-full bg-emerald-500" />
              <span className="flex-1">{i18n._(item.label)}</span>
              <span className="text-xxs uppercase tracking-wide text-muted-foreground shrink-0 pt-0.5">
                {i18n._(item.step)}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground mt-3">
          <Trans>
            The customers who go live fastest own these well. The full
            ours/yours split is below.
          </Trans>
        </p>
      </section>

      <div className="flex flex-col gap-4">
        {ROLES.map((step) => (
          <div
            key={step.stepKey}
            className="rounded-2xl border bg-card shadow-button-base overflow-hidden"
          >
            <div className="px-5 py-3 border-b">
              <span className="text-sm font-semibold">
                {i18n._(step.title)}
              </span>
            </div>
            <ul className="divide-y">
              {step.lines.map((line, i) => (
                <li key={i} className="flex items-center gap-3 px-5 py-3">
                  <span className="flex-1 text-sm">{i18n._(line.label)}</span>
                  <span
                    className={cn(
                      "shrink-0 inline-flex items-center gap-1.5 rounded-full pl-2 pr-2.5 py-0.5 text-xs font-medium",
                      OWNER_TOKENS[line.owner].cls
                    )}
                  >
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        OWNER_TOKENS[line.owner].dot
                      )}
                    />
                    {i18n._(OWNER_TOKENS[line.owner].label)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
