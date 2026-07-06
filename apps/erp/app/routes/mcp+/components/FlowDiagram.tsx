import { Fragment } from "react";
import type { Classification } from "../catalog";
import { Tag } from "./Tag";

export interface FlowStep {
  name: string;
  text: string;
  tag?: Classification;
  num?: string;
}

export function FlowDiagram({
  label,
  caption,
  steps,
  vertical = false
}: {
  label: string;
  caption: string;
  steps: FlowStep[];
  vertical?: boolean;
}) {
  if (vertical) {
    return (
      <div className="bg-card border border-border rounded-[12px] p-[18px]">
        <div className="text-[var(--acc)] font-[var(--mono)] text-[0.68rem] tracking-[0.14em] font-medium">
          {label}
        </div>
        <div className="text-muted-foreground text-[0.85rem] mt-1 mb-[15px]">
          {caption}
        </div>
        <div className="flex flex-col stagger">
          {steps.map((s, i) => (
            <div
              className="grid gap-[14px] py-3 [grid-template-columns:30px_1fr] [&:not(:last-child)]:border-b [&:not(:last-child)]:border-border"
              key={`${s.name}-${i}`}
            >
              <span className="text-[var(--acc)] font-[var(--mono)] text-[0.7rem]">
                {s.num ?? String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <span className="font-[var(--mono)] font-medium text-foreground text-[0.85rem] flex items-center gap-2 flex-wrap">
                  {s.name}
                  {s.tag && <Tag kind={s.tag} />}
                </span>
                <p className="mt-[5px] text-[0.82rem] text-muted-foreground m-0">
                  {s.text}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="bg-card border border-border rounded-[12px] p-[18px]">
      <div className="text-[var(--acc)] font-[var(--mono)] text-[0.68rem] tracking-[0.14em] font-medium">
        {label}
      </div>
      <div className="text-muted-foreground text-[0.85rem] mt-1 mb-[15px]">
        {caption}
      </div>
      <div className="flex items-stretch flex-wrap stagger">
        {steps.map((s, i) => (
          <Fragment key={`${s.name}-${i}`}>
            {i > 0 && (
              <div className="flex items-center text-[var(--acc)] px-[10px] text-[17px]">
                →
              </div>
            )}
            <div className="flex-1 min-w-[172px] bg-muted border border-border rounded-[10px] p-[13px]">
              {s.tag ? (
                <Tag kind={s.tag} />
              ) : (
                <span className="font-[var(--mono)] text-[0.68rem] text-muted-foreground">
                  {s.num ?? String(i + 1).padStart(2, "0")}
                </span>
              )}
              <div className="font-[var(--mono)] font-medium text-foreground mt-[3px] text-[0.85rem]">
                {s.name}
              </div>
              <p className="mt-[7px] text-[0.8rem] text-muted-foreground m-0">
                {s.text}
              </p>
            </div>
          </Fragment>
        ))}
      </div>
    </div>
  );
}
