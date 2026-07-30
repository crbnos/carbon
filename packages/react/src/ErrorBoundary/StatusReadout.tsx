import { useEffect, useState } from "react";
import { cn } from "../utils/cn";

export function StatusReadout({
  lines,
  highlightIndex,
  title = "system.log"
}: {
  lines: string[];
  highlightIndex?: number;
  title?: string;
}) {
  const [visible, setVisible] = useState(0);

  // Reset + replay whenever the log *content* changes. Depend on a derived
  // string key, not the `lines` array identity: callers build a fresh array on
  // every render, so keying off identity would reset the typewriter to 0 on
  // each re-render and it would never advance past the cursor.
  const content = lines.join("\n");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `content` is the intended reset trigger, not read in the body
  useEffect(() => {
    setVisible(0);
  }, [content]);

  useEffect(() => {
    if (visible >= lines.length) return;
    const t = setTimeout(() => setVisible((v) => v + 1), 420);
    return () => clearTimeout(t);
  }, [visible, lines.length]);

  return (
    <div className="w-full max-w-md border border-border bg-card/40 p-4 font-mono text-xs text-muted-foreground backdrop-blur-sm">
      <div className="mb-3 flex items-center justify-between border-b border-border pb-2 text-[10px] uppercase tracking-[0.25em] text-foreground/70">
        <span>{title}</span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-1.5 animate-flicker bg-foreground motion-reduce:animate-none" />
          live
        </span>
      </div>
      <div className="space-y-1.5">
        {lines.slice(0, visible).map((line, i) => (
          <p
            key={`${i}-${line}`}
            // `break-all` wraps long unbroken tokens (e.g. absolute file paths
            // from a stack trace) so they don't overflow the readout.
            className={cn(
              "break-all",
              i === highlightIndex
                ? "text-foreground"
                : i === visible - 1 && "text-foreground/90"
            )}
          >
            {line}
          </p>
        ))}
        {visible < lines.length && (
          <p className="text-foreground">
            {"> "}
            <span className="inline-block h-3 w-2 animate-flicker bg-foreground motion-reduce:animate-none align-middle" />
          </p>
        )}
      </div>
    </div>
  );
}
