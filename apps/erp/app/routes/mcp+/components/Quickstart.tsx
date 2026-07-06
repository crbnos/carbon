import { SetupPipeline } from "./SetupPipeline";

export function Quickstart() {
  return (
    <>
      <p className="text-muted-foreground max-w-[64ch] mb-[26px] text-[0.95rem] [text-wrap:pretty]">
        Pick your client, follow the three steps, and you&apos;re talking to
        your ERP. About a minute.
      </p>
      <SetupPipeline />
      <p className="text-muted-foreground mt-[18px] text-[0.8rem] [text-wrap:pretty]">
        Connector clients authorize in the browser — nothing to paste. CLI and
        config clients use a scoped key from Settings → API Keys (
        <span className="font-[var(--mono)]">Authorization: Bearer crbn_…</span>
        ). stdio-only clients bridge through the{" "}
        <span className="font-[var(--mono)]">mcp-remote</span> shim.
      </p>
    </>
  );
}
