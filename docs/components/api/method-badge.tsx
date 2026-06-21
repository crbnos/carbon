const TONE: Record<string, string> = {
  GET: "text-[#3F9142] bg-[#E4F8DA] border-[#A8DB91]",
  POST: "text-[#1E84B0] bg-[#DFF5FF] border-[#A9DAF3]",
  PATCH: "text-[#9C7136] bg-[#FFF2D8] border-[#E6CFA3]",
  DELETE: "text-[#B3261E] bg-[#FCE8E6] border-[#F2C0BC]",
};

export function MethodBadge({ method, className = "" }: { method: string; className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-[6px] border px-[7px] py-[2px] font-[family-name:var(--font-mono)] text-[11px] font-semibold leading-[14px] tracking-[0.04em] ${
        TONE[method] || TONE.GET
      } ${className}`}
    >
      {method}
    </span>
  );
}
