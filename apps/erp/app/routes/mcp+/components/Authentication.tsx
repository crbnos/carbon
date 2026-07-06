import { SpecList, SpecRow } from "./SpecRow";

export function Authentication() {
  return (
    <>
      <p className="text-muted-foreground max-w-[64ch] mb-6 text-[0.95rem] [text-wrap:pretty]">
        Connect with OAuth — no secrets to copy. Carbon's MCP server speaks
        OAuth 2.1, so your client registers itself and you authorize in the
        browser. A scoped API key is there if you'd rather (CI, headless).
      </p>
      <SpecList>
        <SpecRow label="OAuth 2.1">
          PKCE + dynamic client registration. Your client self-registers; you
          sign in, pick your company, and click Authorize — nothing to copy or
          paste.
        </SpecRow>
        <SpecRow label="Permissions">
          The connection inherits exactly your Carbon access (scope{" "}
          <span className="font-[var(--mono)]">mcp:tools</span>). Cross-company
          access is impossible.
        </SpecRow>
        <SpecRow label="API keys">
          Prefer a key for CI or headless use? Create a scoped key in Settings →
          API Keys and send it as{" "}
          <span className="font-[var(--mono)]">
            Authorization: Bearer crbn_…
          </span>
          .
        </SpecRow>
      </SpecList>
      <p className="text-muted-foreground text-[0.9rem] mt-3 max-w-[64ch] [text-wrap:pretty]">
        Access tokens last an hour and refresh automatically.
      </p>
    </>
  );
}
