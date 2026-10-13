// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { CodeBlock } from "@/components/api/code-block";
import { DEFAULT_MCP_ENDPOINT } from "@/components/api/config-constants";
import { McpEndpoint } from "@/components/api/config-inline";
import {
  Code,
  DocEyebrow,
  DocLink,
  DocPage,
  DocTitle,
  H2,
  Lead,
  P,
  Row,
  Table
} from "@/components/api/doc";
import { Faq, type FaqEntry } from "@/components/api/faq";
import { ContentFooter } from "@/components/api/page-footer";
import { highlight } from "@/lib/highlight";
import { pageSeo, SEO } from "@/lib/seo";
import { toolCounts } from "@/lib/tools-data";

export const metadata = pageSeo({
  title: `${SEO.carbonApi.mcp.title} | Carbon`,
  ogTitle: SEO.carbonApi.mcp.title,
  description: SEO.carbonApi.mcp.description,
  path: "/api/mcp",
  eyebrow: "Carbon API"
});

// Sourced from the config so the samples below stay in lockstep with what
// applyConfig() rewrites at render — a divergent literal would never substitute.
const ENDPOINT = DEFAULT_MCP_ENDPOINT;

const CLAUDE_CODE = `claude mcp add --transport http carbon \\
  ${ENDPOINT} \\
  --header "Authorization: Bearer <api-key>"`;

const GROK_BUILD = `grok mcp add --transport http carbon \\
  ${ENDPOINT} \\
  --header 'Authorization: Bearer \${CARBON_API_KEY}'`;

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
    a: "Not for the Carbon marketplace plugin in Cursor or Grok Bot, and not for Claude.ai, Claude Desktop, or ChatGPT. Those authorize in the browser and act as you. Grok Build, Cursor on a private origin, Claude Code, VS Code, and Codex take a scoped API key. A local agent should start with View only, one key per client."
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
    a: "Keeping Carbon on a private network keeps the port off the internet. It does not keep the records inside the building after an agent reads them. Grok Build sends the conversation, including tool results, to xAI. Cursor and Grok Bot send them to the model behind that product. A View key on sales is a decision to let that model see sales data, including prices and controlled technical data you ask it to read."
  },
  {
    q: "Can I connect from a private network?",
    a: "Yes, with Grok Build or Cursor running on a computer that can already open this Carbon origin — the same machine, the LAN, or the VPN. Use HTTPS when the request leaves the machine. Loopback HTTP stays on that computer. Grok Bot and Cursor Cloud Agents run elsewhere. They are for an origin that is already public."
  },
  {
    q: "How do Cursor and Grok Bot connect?",
    a: "Both install the Carbon plugin from the Cursor Marketplace. Cursor: Customize → Marketplace. Grok Bot: Settings → Plugins. One submission at cursor.com/marketplace/publish lists it for both. The plugin talks to Carbon Cloud at https://app.carbon.ms/api/mcp and signs in with OAuth. It does not reach a private, self-hosted, EU Cloud, or ITAR origin. The package in this repository is plugins/carbon."
  },
  {
    q: "Is an API key limited to MCP?",
    a: "No. The same secret calls the Carbon API at POST /api/v1/{module}/{operation} and the Data API. Scopes are the limit on all three. Deleting the key revokes all of them on the next request."
  },
  {
    q: "Is the Carbon API available on my plan?",
    a: "On Carbon Cloud, API and MCP access is a Business-plan feature. An API key from a Starter company is rejected with 403 during sign-in. An OAuth request from a Starter company reaches MCP and returns 402. Self-hosted, it's one of the Business features, which Enterprise Edition (EE) unlocks with a commercial license. See Licensing for the full picture."
  },
  {
    q: "Is there a rate limit?",
    a: "Each key has its own limit and window — 60 requests per minute by default. It's platform-controlled: the Rate Limit column in Settings → API Keys shows the limit in force, but there's no field to change it. Go over it and calls return 429 with X-RateLimit-* and Retry-After headers telling the client when to retry."
  },
  {
    q: "I'm getting 401 Unauthorized",
    a: "Key clients: the key is missing, malformed, expired, or deleted — recreate it in Settings → API Keys and update the Authorization header. Connector clients: re-authorize the connection from your client."
  },
  {
    q: "I'm getting 403 Forbidden",
    a: "An API key from a Starter company is rejected with 403 during sign-in, before MCP runs. A key that is signed in but missing a module scope does not get HTTP 403: the tool result says `API key lacks the required scope`. An OAuth request from a Starter company returns 402."
  },
  {
    q: "How do I manage or revoke a key?",
    a: "Each key in Settings → API Keys shows its scopes, rate limit, expiry, and who created it. Delete a key to revoke it instantly; nothing else breaks if you key each client separately."
  }
];

/** Render the public Connect over MCP page. */
export default async function ConnectOverMcpPage() {
  const [code, grok, cursor] = await Promise.all([
    highlight(CLAUDE_CODE, "curl"),
    highlight(GROK_BUILD, "curl"),
    highlight(CURSOR, "json")
  ]);

  return (
    <DocPage>
      <DocEyebrow>Carbon API</DocEyebrow>
      <DocTitle>Connect over MCP</DocTitle>
      <Lead>
        Carbon runs an MCP server. On Carbon Cloud, Cursor and Grok Bot install
        the same marketplace plugin. On a private network, Grok Build and
        Cursor run on a computer that can already open this origin.
      </Lead>
      <P>
        The server lives at <McpEndpoint />. It exposes three tools,{" "}
        <Code>search_tools</Code>, <Code>describe_tool</Code>, and{" "}
        <Code>call_tool</Code>. The agent finds an operation, reads its schema,
        then calls it.
      </P>

      <H2 id="private-network">Private network and local compute</H2>
      <P>
        Grok Build and Cursor belong on a computer that can already open this
        origin: the same machine, the LAN, or the VPN. Loopback HTTP stays on
        that machine. A request that crosses the network uses HTTPS, so the
        bearer is not cleartext on the wire.
      </P>
      <P>
        Give each client its own key from <strong>Settings → API Keys</strong>,
        named for the client, with View on only the modules it may read. The
        key does not inherit your role. A key with no scopes can sign in and
        can do nothing. Create, Update, and Delete stay off until a write is a
        task you have accepted, and then they go on a separate key. The same
        secret also calls the Carbon API and the Data API. Scopes are the
        limit on all three.
      </P>
      <P>
        Keep the key in the user config, owner-read-only, and out of the
        repository. The Grok Build command reads <Code>CARBON_API_KEY</Code>{" "}
        from the environment so the secret never lands in shell history. One
        operating-system account per person.
      </P>
      <CodeBlock
        html={grok}
        code={GROK_BUILD}
        label="Terminal · Grok Build"
      />
      <P>
        When this origin is not Carbon Cloud in the US, Cursor uses the user
        file <Code>~/.cursor/mcp.json</Code>, not a file committed with the
        project. In <strong>Settings → MCP</strong> the server should list the
        three tools. Add a user rule: discover with <Code>search_tools</Code>,
        read the schema with <Code>describe_tool</Code>, call with{" "}
        <Code>call_tool</Code>, and ask before any <Code>WRITE</Code> or{" "}
        <Code>DESTRUCTIVE</Code> operation. Stop on <Code>401</Code> (new key),{" "}
        <Code>403</Code> (Starter plan, during sign-in), and <Code>429</Code>{" "}
        (wait for <Code>Retry-After</Code>). A missing module scope is an MCP
        tool error, not HTTP 403. A Cursor Cloud Agent stays unused for a
        private or controlled origin.
      </P>
      <CodeBlock html={cursor} code={CURSOR} label="~/.cursor/mcp.json" />

      <H2 id="marketplace">Cursor and Grok Bot</H2>
      <P>
        Cursor and Grok Bot share one connector, the <strong>Carbon</strong>{" "}
        plugin in <Code>plugins/carbon</Code>. Submitting{" "}
        <Code>https://github.com/crbnos/carbon</Code> at{" "}
        <DocLink href="https://cursor.com/marketplace/publish">
          cursor.com/marketplace/publish
        </DocLink>{" "}
        lists it in both catalogs. There is no second form for Cursor. Cursor
        reviews the plugin before either product shows it.
      </P>
      <P>
        The plugin's server is <Code>https://app.carbon.ms/api/mcp</Code>. There
        is no key in it. The first tool call opens Carbon's sign-in, and you
        pick the company. The agent then acts as you, inside your role and
        row-level security. The plugin carries the working loop as a Cursor
        rule and as a Grok Bot skill.
      </P>
      <P>
        After the review accepts it, install <strong>Carbon</strong> in either
        place:
      </P>
      <P>
        <strong>Cursor:</strong> Customize → Marketplace → <strong>Carbon</strong>{" "}
        → Install.
      </P>
      <P>
        <strong>Grok Bot:</strong> Settings → Plugins → <strong>Carbon</strong>{" "}
        → Add.
      </P>
      <P>
        The listing is Carbon Cloud in the US. EU Cloud (
        <Code>app.eu.carbon.ms</Code>), a private network, a self-hosted host,
        and an ITAR environment use Grok Build or the local Cursor file above.
        Leave a private origin unpublished.
      </P>

      <H2 id="connect">Other clients</H2>
      <P>
        <strong>Connector clients</strong> — Claude.ai, Claude Desktop, ChatGPT
        — add the URL and authorize in the browser. The computer or service
        that runs the client has to be able to open this origin.
      </P>
      <P>
        <strong>Command and key clients</strong> — Claude Code, VS Code, Codex
        — use a scoped key, one per client.
      </P>
      <CodeBlock
        html={code}
        code={CLAUDE_CODE}
        label="Terminal · Claude Code"
      />

      <H2 id="security">What the agent is allowed to do</H2>
      <P>
        <Code>companyId</Code> and <Code>userId</Code> come from the credential.
        Tool arguments cannot switch company. OAuth acts as the person who
        approved the screen, in the company they picked. An API key acts as its
        own scopes, and only those.
      </P>
      <P>
        The catalog leaves out tenant create and delete, the service-role
        supplier-approval helper, the ungated schedule trigger, and the
        user-scoped note and favorite mutations that cannot succeed under an
        API key. <Code>search_tools</Code> labels what remains{" "}
        <Code>READ</Code>, <Code>WRITE</Code>, or <Code>DESTRUCTIVE</Code>. The
        agent shows that label and waits before a write.
      </P>
      <P>
        Each key, and each OAuth user, is limited to 60 requests a minute by
        default. On Carbon Cloud this surface is a Business-plan feature. An
        OAuth request from a Starter company returns <Code>402</Code> from the
        MCP entitlement gate. An API-key request from a Starter company is
        rejected with <Code>403</Code> during authentication. A missing module
        scope is an MCP tool error,{" "}
        <Code>API key lacks the required scope</Code>, not HTTP 403.
      </P>

      <H2 id="discovery">Discovery</H2>
      <P>
        The server does not register all{" "}
        {toolCounts().total.toLocaleString()} operations as tools — that
        would flood a model's context. It exposes three meta-tools instead, and
        the model loads only what a task needs:
      </P>
      <Table>
        <Row head cols="150px 1fr" cells={["Meta-tool", "What it does"]} />
        <Row
          cols="150px 1fr"
          cells={[
            <Code key="s">search_tools</Code>,
            "Find operations by query, module, or classification."
          ]}
        />
        <Row
          cols="150px 1fr"
          cells={[
            <Code key="d">describe_tool</Code>,
            "Get an operation's input schema and description."
          ]}
        />
        <Row
          cols="150px 1fr"
          cells={[
            <Code key="c">call_tool</Code>,
            "Invoke an operation by name with its arguments."
          ]}
        />
      </Table>
      <P>
        A typical flow is <Code>search_tools</Code> → <Code>describe_tool</Code>{" "}
        → <Code>call_tool</Code>, which keeps the model's context lean no matter
        how large the catalog grows. The same operations are also plain HTTP
        endpoints — every one has a page of its own, listed by module in the
        sidebar.
      </P>

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
        Next: <DocLink href="/api/authentication">Authentication</DocLink> for
        the auth flows, and <DocLink href="/api/sdks">Client SDKs</DocLink> for
        calling the same operations from your own code.
      </P>

      <H2 id="faq">FAQ</H2>
      <Faq items={FAQ} />

      <ContentFooter
        prev={{ label: "Overview", url: "/api" }}
        next={{ label: "Authentication", url: "/api/authentication" }}
      />
    </DocPage>
  );
}
