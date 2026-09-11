import { useState } from "react";
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
  eyebrow: string;
  title: string;
  message: string;
  logLines: string[];
  highlightIndex?: number;
  actions: ErrorAction[];
  requestId?: string;
};

export function ErrorScreen({
  code,
  eyebrow,
  title,
  message,
  logLines,
  highlightIndex,
  actions,
  requestId
}: ErrorScreenProps) {
  const [copied, setCopied] = useState(false);

  const copyRequestId = () => {
    if (requestId) {
      navigator.clipboard.writeText(requestId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  return (
    <main className="relative flex min-h-svh flex-col overflow-hidden bg-background text-foreground">
      <NoiseOverlay />

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
            {requestId && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-mono text-muted-foreground">
                  reference id
                </p>
                <button
                  onClick={copyRequestId}
                  className="max-w-fit rounded border border-muted-foreground/30 bg-muted/30 px-3 py-2 font-mono text-xs text-foreground transition-colors hover:border-muted-foreground/50 hover:bg-muted/50 active:scale-[0.96] active:duration-75"
                  title="Click to copy"
                >
                  {requestId}
                  <span className="ml-2 text-muted-foreground">
                    {copied ? "✓" : "⎘"}
                  </span>
                </button>
              </div>
            )}
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
    </main>
  );
}
