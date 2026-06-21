import type { ReactNode } from "react";

export function DocPage({ children }: { children: ReactNode }) {
  return <div className="max-w-190">{children}</div>;
}

export function DocEyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 font-mono text-ed-12 font-medium uppercase tracking-[0.08em] text-ed-ink/50">
      {children}
    </p>
  );
}

export function DocTitle({ children }: { children: ReactNode }) {
  return <h1 className="m-0 mt-2 text-ed-32 font-semi leading-[120%] text-ed-ink">{children}</h1>;
}

export function Lead({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 mt-3 max-w-160 text-ed-16 leading-[170%] text-ed-ink/82">
      {children}
    </p>
  );
}

export function H2({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2
      id={id}
      className="m-0 mt-11 mb-0.5 scroll-mt-22 text-ed-24 font-semi leading-[130%] text-ed-ink"
    >
      {children}
    </h2>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <p className="m-0 mt-3 text-ed-15 leading-[170%] text-ed-ink/82">{children}</p>;
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="font-mono text-ed-13 text-ed-brown">{children}</code>;
}

export function DocLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="text-ed-brand-ink underline decoration-ed-blue-border underline-offset-2 hover:decoration-ed-brand-ink"
    >
      {children}
    </a>
  );
}

export function Warn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="my-[18px] rounded-xl border border-ed-amber-stroke bg-[#FFF8EC] px-4 py-[13px]">
      <p className="m-0 text-ed-14 font-semi text-[#8a5a1f]">{title}</p>
      <p className="m-0 mt-1 text-ed-14 leading-[155%] text-ed-ink/78">{children}</p>
    </div>
  );
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="my-[18px] overflow-hidden rounded-[10px] border border-ed-warm-300">{children}</div>
  );
}

export function Row({ cells, cols, head = false }: { cells: ReactNode[]; cols: string; head?: boolean }) {
  return (
    <div className="grid border-t border-ed-warm-300 first:border-t-0" style={{ gridTemplateColumns: cols }}>
      {cells.map((c, i) => (
        <div
          key={i}
          className={`px-3 py-[9px] text-ed-14 leading-normal ${
            head ? "font-semi text-ed-ink" : "text-ed-ink/82"
          } ${i > 0 ? "border-l border-ed-warm-300" : ""}`}
        >
          {c}
        </div>
      ))}
    </div>
  );
}
