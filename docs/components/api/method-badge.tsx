const TONE: Record<string, string> = {
  GET: "text-ed-green-strong bg-ed-green-bg border-ed-green-border",
  POST: "text-ed-brand-ink bg-ed-blue-bg border-ed-blue-border",
  PATCH: "text-ed-amber-text bg-ed-amber-fill border-ed-amber-stroke",
  DELETE: "text-ed-red bg-ed-red-bg border-ed-red-border",
};

export function MethodBadge({ method, className = "" }: { method: string; className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-[7px] py-0.5 font-mono text-ed-11 font-semibold leading-3.5 tracking-[0.04em] ${
        TONE[method] || TONE.GET
      } ${className}`}
    >
      {method}
    </span>
  );
}
