import { GlitchHeading } from "./GlitchHeading";
import { MagneticLink } from "./MagneticLink";
import { NoiseOverlay } from "./NoiseOverlay";
import { StatusReadout } from "./StatusReadout";

export type ErrorAction = {
  label: string;
  to?: string;
  onClick?: () => void;
  variant?: "solid" | "ghost";
};

export type ErrorScreenProps = {
  code: string;
  statusLabel: string;
  eyebrow: string;
  title: string;
  message: string;
  logLines: string[];
  highlightIndex?: number;
  marqueeItems: string[];
  actions: ErrorAction[];
};

export function ErrorScreen({
  code,
  statusLabel,
  eyebrow,
  title,
  message,
  logLines,
  highlightIndex,
  marqueeItems,
  actions
}: ErrorScreenProps) {
  return (
    <main className="relative flex min-h-svh flex-col overflow-hidden bg-background text-foreground">
      <NoiseOverlay />

      {/* Top meta bar */}
      <header className="relative z-10 flex items-center justify-between border-b border-border px-5 py-4 font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground sm:text-xs">
        <span className="text-foreground">{"VOID//SYS"}</span>
        <span className="hidden sm:inline">error_handler v9.4.0</span>
        <span className="flex items-center gap-2">
          <span className="inline-block size-1.5 animate-flicker bg-foreground motion-reduce:animate-none" />
          {statusLabel}
        </span>
      </header>

      {/* Body */}
      <div className="relative z-10 flex flex-1 flex-col justify-center px-5 py-12 sm:px-8">
        <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.35em] text-muted-foreground sm:text-xs">
          {eyebrow}
        </p>

        <div className="grid grid-cols-1 items-end gap-10 lg:grid-cols-12">
          <div className="lg:col-span-8">
            <GlitchHeading code={code} srText={`Error ${code}. ${title} `} />
          </div>

          <div className="flex flex-col gap-6 lg:col-span-4 lg:pb-6">
            <h2
              className="font-sans text-2xl font-bold leading-[0.95] tracking-tight text-balance sm:text-3xl"
              style={{ fontSize: "clamp(1.75rem, 3vw, 2.75rem)" }}
            >
              {title}
            </h2>
            <p className="max-w-sm font-mono text-sm leading-relaxed text-muted-foreground text-pretty">
              {message}
            </p>
            <StatusReadout lines={logLines} highlightIndex={highlightIndex} />
          </div>
        </div>

        {/* Actions */}
        <div className="mt-12 flex flex-col gap-4 sm:flex-row sm:items-center">
          {actions.map((action) => (
            <MagneticLink
              key={action.label}
              to={action.to}
              onClick={action.onClick}
              variant={action.variant}
            >
              {action.label}
            </MagneticLink>
          ))}
        </div>
      </div>

      {/* Bottom marquee */}
      <div className="relative z-10 overflow-hidden border-t border-border bg-foreground py-3 text-background">
        <div className="flex w-max whitespace-nowrap">
          <Marquee items={marqueeItems} />
          <Marquee items={marqueeItems} />
        </div>
      </div>
    </main>
  );
}

function Marquee({ items }: { items: string[] }) {
  return (
    <div className="flex shrink-0 animate-marquee items-center motion-reduce:animate-none">
      {items.map((item, i) => (
        <span
          key={`${item}-${i}`}
          className="flex items-center px-6 font-mono text-xs font-medium uppercase tracking-[0.3em]"
        >
          {item}
          <span aria-hidden="true" className="pl-6">
            ✳
          </span>
        </span>
      ))}
    </div>
  );
}
