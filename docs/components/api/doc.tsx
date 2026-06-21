import type { ReactNode } from "react";

export function DocPage({ children }: { children: ReactNode }) {
  return <div className="max-w-[760px]">{children}</div>;
}

export function DocEyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 font-[family-name:var(--font-mono)] text-[12px] font-medium uppercase tracking-[0.08em] text-[rgba(38,35,35,0.5)]">
      {children}
    </p>
  );
}

export function DocTitle({ children }: { children: ReactNode }) {
  return <h1 className="m-0 mt-[8px] text-[34px] font-[560] leading-[120%] text-[#262323]">{children}</h1>;
}

export function Lead({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 mt-[12px] max-w-[640px] text-[16.5px] leading-[170%] text-[rgba(38,35,35,0.82)]">
      {children}
    </p>
  );
}

export function H2({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2
      id={id}
      className="m-0 mt-[44px] mb-[2px] scroll-mt-[88px] text-[22px] font-[560] leading-[130%] text-[#262323]"
    >
      {children}
    </h2>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <p className="m-0 mt-[12px] text-[15.5px] leading-[170%] text-[rgba(38,35,35,0.82)]">{children}</p>;
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="font-[family-name:var(--font-mono)] text-[13.5px] text-[#a76451]">{children}</code>;
}

export function DocLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="text-[#1E84B0] underline decoration-[#A9DAF3] underline-offset-2 hover:decoration-[#1E84B0]"
    >
      {children}
    </a>
  );
}

export function Warn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="my-[18px] rounded-[12px] border border-[#E6CFA3] bg-[#FFF8EC] px-[16px] py-[13px]">
      <p className="m-0 text-[14.5px] font-[560] text-[#8a5a1f]">{title}</p>
      <p className="m-0 mt-[4px] text-[14px] leading-[155%] text-[rgba(38,35,35,0.78)]">{children}</p>
    </div>
  );
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="my-[18px] overflow-hidden rounded-[10px] border border-[#E3E3DF]">{children}</div>
  );
}

export function Row({ cells, cols, head = false }: { cells: ReactNode[]; cols: string; head?: boolean }) {
  return (
    <div className="grid border-t border-[#E3E3DF] first:border-t-0" style={{ gridTemplateColumns: cols }}>
      {cells.map((c, i) => (
        <div
          key={i}
          className={`px-[12px] py-[9px] text-[14px] leading-[150%] ${
            head ? "font-[560] text-[#262323]" : "text-[rgba(38,35,35,0.82)]"
          } ${i > 0 ? "border-l border-[#E3E3DF]" : ""}`}
        >
          {c}
        </div>
      ))}
    </div>
  );
}
