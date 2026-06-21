import { ApiKeysLink, AuthHeader } from "@/components/api/config-inline";
import {
  Code,
  DocEyebrow,
  DocPage,
  DocTitle,
  H2,
  Lead,
  P,
  Row,
  Table
} from "@/components/api/doc";
import { ContentFooter } from "@/components/api/page-footer";
import { pageSeo, SEO } from "@/lib/seo";

export const metadata = pageSeo({
  title: `${SEO.mcp.auth.title} — Carbon`,
  ogTitle: SEO.mcp.auth.title,
  description: SEO.mcp.auth.description,
  path: "/mcp/authentication",
  eyebrow: "MCP"
});

export default function McpAuthenticationPage() {
  return (
    <DocPage>
      <DocEyebrow>MCP</DocEyebrow>
      <DocTitle>Authentication</DocTitle>
      <Lead>
        An MCP client inherits exactly the identity it authenticates as — and
        can only do what that identity can. There are two flows, by client type.
      </Lead>

      <H2 id="connector">Connector (OAuth)</H2>
      <P>
        Claude.ai, Claude Desktop, and ChatGPT authorize over OAuth — add the
        server URL and approve the connection in your browser. There's no key to
        manage. The connection inherits the <strong>role and company</strong> of
        whoever authorized it.
      </P>

      <H2 id="api-key">API key</H2>
      <P>
        Claude Code, Cursor, VS Code, Codex, and any headless or CI client send
        a scoped key as a bearer token: <AuthHeader />. Create one in{" "}
        <ApiKeysLink>Settings → API Keys</ApiKeysLink>; the key carries its own
        scopes. stdio-only clients bridge through <Code>mcp-remote</Code>.
      </P>

      <H2 id="permissions">Permissions</H2>
      <P>
        Either way, the assistant can only do what that identity can — a
        connector inherits your role and company, a key carries the scopes you
        granted it. Use a separate key per client, so revoking one doesn't break
        the rest.
      </P>

      <H2 id="errors">Errors</H2>
      <Table>
        <Row head cols="72px 1fr" cells={["Status", "When it happens"]} />
        <Row
          cols="72px 1fr"
          cells={[
            <Code key="a">401</Code>,
            "Connector: re-authorize from your client. Key: it's missing, malformed, expired, or deleted — recreate it and update the Authorization header."
          ]}
        />
        <Row
          cols="72px 1fr"
          cells={[
            <Code key="b">403</Code>,
            "The identity lacks the required module permission (or the company is on the Starter plan)."
          ]}
        />
      </Table>

      <ContentFooter prev={{ label: "Overview", url: "/mcp" }} />
    </DocPage>
  );
}
