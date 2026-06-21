import { CodeBlock } from "@/components/api/code-block";
import {
  Code,
  DocEyebrow,
  DocLink,
  DocPage,
  DocTitle,
  H2,
  Lead,
  P
} from "@/components/api/doc";
import { ContentFooter } from "@/components/api/page-footer";
import { SdkCards } from "@/components/api/sdk-cards";
import { apiBase } from "@/lib/api-data";
import { highlight } from "@/lib/highlight";
import { pageSeo, SEO } from "@/lib/seo";

export const metadata = pageSeo({
  title: `${SEO.api.intro.title} — Carbon`,
  ogTitle: SEO.api.intro.title,
  description: SEO.api.intro.description,
  path: "/api-reference",
  eyebrow: "API reference"
});

const ENV = `# .env
CARBON_API_URL=${apiBase}
CARBON_API_KEY=<your-api-key>`;

const INIT = `import { createClient } from '@supabase/supabase-js'

const apiUrl = process.env.CARBON_API_URL
const apiKey = process.env.CARBON_API_KEY

export const carbon = createClient(apiUrl, apiKey)`;

export default async function ApiIntroPage() {
  const [env, init] = await Promise.all([
    highlight(ENV, "curl"),
    highlight(INIT, "javascript")
  ]);

  return (
    <DocPage>
      <DocEyebrow>REST API</DocEyebrow>
      <DocTitle>Overview</DocTitle>
      <Lead>
        The Carbon API is a REST interface over your manufacturing data — every
        table and view is an endpoint, with full read and write access.
      </Lead>
      <P>
        There are three ways to call it: directly over HTTP, through the{" "}
        <DocLink href="#client-libraries">JavaScript SDK</DocLink>, or from the{" "}
        <DocLink href="/mcp">MCP server</DocLink>. Start by creating an{" "}
        <DocLink href="/api-reference/authentication">API key</DocLink>.
      </P>

      <H2 id="client-libraries">Client libraries</H2>
      <P>
        Carbon's API is standard REST, so it works from any language. The
        recommended client is the JavaScript SDK, built on{" "}
        <Code>supabase-js</Code>.
      </P>
      <SdkCards />

      <H2 id="quickstart">Quickstart</H2>
      <P>Save your key and the API URL as environment variables:</P>
      <CodeBlock html={env} code={ENV} label=".env" />
      <P>Then initialize the client:</P>
      <CodeBlock html={init} code={INIT} label="lib/carbon.ts" />
      <P>
        You can now query any resource with <Code>carbon.from('…')</Code>. Pick
        a resource from the sidebar for its endpoints and ready-to-copy samples
        — pointed at your configured instance.
      </P>

      <ContentFooter
        next={{ label: "Authentication", url: "/api-reference/authentication" }}
      />
    </DocPage>
  );
}
