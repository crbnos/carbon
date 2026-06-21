import { CodeBlock } from "@/components/api/code-block";
import { McpEndpoint } from "@/components/api/config-inline";
import {
  DocEyebrow,
  DocLink,
  DocPage,
  DocTitle,
  H2,
  Lead,
  P
} from "@/components/api/doc";
import { Faq, type FaqEntry } from "@/components/api/faq";
import { ContentFooter } from "@/components/api/page-footer";
import { highlight } from "@/lib/highlight";
import { pageSeo, SEO } from "@/lib/seo";

export const metadata = pageSeo({
  title: `${SEO.mcp.intro.title} — Carbon`,
  ogTitle: SEO.mcp.intro.title,
  description: SEO.mcp.intro.description,
  path: "/mcp",
  eyebrow: "MCP"
});

const ENDPOINT = "https://app.carbon.ms/api/mcp";

const CLAUDE_CODE = `claude mcp add --transport http carbon \\
  ${ENDPOINT} \\
  --header "Authorization: Bearer <api-key>"`;

const CURSOR = `{
  "mcpServers": {
    "carbon": {
      "url": "${ENDPOINT}",
      "headers": { "Authorization": "Bearer <api-key>" }
    }
  }
}`;

const PROMPTS = [
  "Show all open sales orders due to ship this week.",
  "Which purchase orders are past their promised receipt date?",
  "What's the on-hand quantity and reorder point for a part across locations?",
  "Draft a quote for a customer for 200 aluminum housings.",
  "List every job behind schedule and who's assigned."
];

const FAQ: FaqEntry[] = [
  {
    q: "What can the assistant actually do?",
    a: "Read and write across every module the identity can reach — query orders and inventory, create jobs, draft quotes, update statuses. It acts as that user, so it can only touch what you've granted."
  },
  {
    q: "Do I need an API key?",
    a: "Not for connector clients — Claude.ai, Claude Desktop, and ChatGPT add the URL and authorize in your browser. Keys are for command and config clients (Claude Code, Cursor, VS Code, Codex) and any headless or CI use."
  },
  {
    q: "Does it respect my Carbon permissions?",
    a: "Yes — there's no way around them. A connector inherits the role and company of whoever authorized it; a key carries its own scopes. The assistant can never do what that identity can't."
  },
  {
    q: "Can I give it read-only access?",
    a: "Yes. Scope a key to only the modules and actions it needs — View with no Create, Update, or Delete makes it read-only. Use a separate key per client so you can re-scope or revoke one without touching the rest."
  },
  {
    q: "Where does my data go?",
    a: "Carbon doesn't send it anywhere new — your MCP client does, to whatever model provider it runs on, under that provider's terms. Scope keys tightly and prefer a read-only key when you only need to read."
  },
  {
    q: "Is MCP available on my plan?",
    a: "On Carbon Cloud, API and MCP access is a Business-plan feature — Starter keys are rejected with 403. Self-hosted instances aren't gated."
  },
  {
    q: "Is there a rate limit?",
    a: "Each key has its own limit and window, set in Settings → API Keys. Go over it and calls return 429 with X-RateLimit-* headers telling the client when to retry."
  },
  {
    q: "I'm getting 401 Unauthorized",
    a: "Key clients: the key is missing, malformed, expired, or deleted — recreate it in Settings → API Keys and update the Authorization header. Connector clients: re-authorize the connection from your client."
  },
  {
    q: "I'm getting 403 Forbidden",
    a: "The identity is authenticated but lacks the module permission for that action — or, on Cloud, the company is on the Starter plan. Grant the scope, or switch to a key that has it."
  },
  {
    q: "How do I manage or revoke a key?",
    a: "Each key in Settings → API Keys shows its scopes, rate limit, expiry, and who created it. Delete a key to revoke it instantly; nothing else breaks if you key each client separately."
  }
];

export default async function McpPage() {
  const [code, cursor] = await Promise.all([
    highlight(CLAUDE_CODE, "curl"),
    highlight(CURSOR, "json")
  ]);

  return (
    <DocPage>
      <DocEyebrow>MCP</DocEyebrow>
      <DocTitle>Model Context Protocol</DocTitle>
      <Lead>
        Carbon runs an MCP server, so AI clients — Claude Code, Claude Desktop,
        Cursor, ChatGPT — can read and write your manufacturing data in plain
        language.
      </Lead>
      <P>
        The server lives at <McpEndpoint />. Connect it one of two ways,
        depending on your client.
      </P>

      <H2 id="connect">Connect</H2>
      <P>
        <strong>Connector clients</strong> — Claude.ai, Claude Desktop, ChatGPT
        — add the URL and authorize in your browser. No key needed.
      </P>
      <P>
        <strong>Command &amp; key clients</strong> — Claude Code, Cursor, VS
        Code, Codex — paste a snippet carrying a scoped API key.
      </P>
      <CodeBlock
        html={code}
        code={CLAUDE_CODE}
        label="Terminal · Claude Code"
      />
      <CodeBlock html={cursor} code={CURSOR} label=".cursor/mcp.json" />

      <H2 id="ask">What you can ask</H2>
      <P>Once connected, ask in natural language:</P>
      <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
        {PROMPTS.map((p) => (
          <li
            key={p}
            className="flex gap-2.5 text-ed-15 leading-[160%] text-ed-ink/82"
          >
            <span className="mt-[9px] h-[5px] w-[5px] shrink-0 rounded-full bg-ed-ink/40" />
            <span>{p}</span>
          </li>
        ))}
      </ul>
      <P>
        Next: <DocLink href="/mcp/authentication">Authentication</DocLink> for
        the auth flows, and <DocLink href="/mcp/tools">Tools</DocLink> for how
        the assistant finds what it needs.
      </P>

      <H2 id="faq">FAQ</H2>
      <Faq items={FAQ} />

      <ContentFooter
        next={{ label: "Authentication", url: "/mcp/authentication" }}
      />
    </DocPage>
  );
}
