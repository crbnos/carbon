import type { ReactNode } from "react";
import { useInViewClass } from "../hooks/useInViewClass";

export function Section({
  id,
  fig,
  label,
  title,
  children
}: {
  id: string;
  fig: string;
  label: string;
  title?: string;
  children: ReactNode;
}) {
  const ref = useInViewClass<HTMLElement>();
  return (
    <section
      ref={ref}
      id={id}
      className="reveal hr-wipe relative py-[54px] scroll-mt-20"
    >
      <div className="font-[var(--mono)] text-[0.68rem] tracking-[0.18em] uppercase text-muted-foreground mb-4">
        <span className="text-[var(--acc)] font-medium">{fig}</span> · {label}
      </div>
      {title && (
        <h2 className="font-medium tracking-[-0.03em] text-[clamp(1.5rem,2.2vw,1.9rem)] leading-[1.12] mb-[9px] text-balance">
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}
