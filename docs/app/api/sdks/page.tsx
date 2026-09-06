import {
  siGo,
  siOpenjdk,
  siPhp,
  siPython,
  siRuby,
  siSharp,
  siTypescript
} from "simple-icons";
import { CodeBlock } from "@/components/api/code-block";
import { ApiKeysLink } from "@/components/api/config-inline";
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
import { ContentFooter } from "@/components/api/page-footer";
import { Brand, type SdkCard, SdkCardGrid } from "@/components/api/sdk-cards";
import { highlight } from "@/lib/highlight";
import { pageSeo, SEO } from "@/lib/seo";
import { toolCounts } from "@/lib/tools-data";

export const metadata = pageSeo({
  title: `${SEO.carbonApi.sdks.title} — Carbon`,
  ogTitle: SEO.carbonApi.sdks.title,
  description: SEO.carbonApi.sdks.description,
  path: "/api/sdks",
  eyebrow: "Carbon API"
});

/* Samples hardcode the DEFAULT origin so applyConfig() rewrites them to whatever
 * instance the reader configured — a divergent literal would never substitute. */
const SPEC_URL = "https://app.carbon.ms/api/v1/openapi.json";

const FETCH_SPEC = `curl ${SPEC_URL} -o openapi.json`;

const HEY_API_CONFIG = `// openapi-ts.config.ts
import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "${SPEC_URL}",
  output: "src/client",
  plugins: [
    "@hey-api/client-fetch",
    {
      name: "@hey-api/sdk",
      operations: {
        // One class per Carbon module: Sales.getQuotes, Production.insertJob, …
        strategy: "byTags",
        container: "class",
        nestingDelimiters: /(?!)/,
        methodName: (name) => name.split(".").pop() ?? name
      }
    }
  ]
});`;

const HEY_API = `npm install -D @hey-api/openapi-ts typescript
npx openapi-ts`;

const PYTHON_CLIENT = `pipx install openapi-python-client --include-deps
openapi-python-client generate --url ${SPEC_URL}`;

const OPENAPI_GENERATOR = `npx openapi-generator-cli generate \\
  -i ${SPEC_URL} \\
  -g go \\
  -o ./carbon-client`;

const HEY_API_AUTH = `import { client } from "./src/client/client.gen";

client.setConfig({
  auth: "<api-key>"
});`;

/* The generator languages. Every card lands on the section that generates its
 * client; the five openapi-generator languages share one section and differ only
 * by the -g value named on the card. */
const CARDS: SdkCard[] = [
  {
    glyph: <Brand path={siTypescript.path} />,
    tone: "bg-[#E8F0FB] text-[#3178C6]",
    name: "TypeScript",
    desc: "A fully typed client from @hey-api/openapi-ts — request and response types included.",
    href: "#typescript",
    cta: "Generate"
  },
  {
    glyph: <Brand path={siPython.path} />,
    tone: "bg-[#EAF1F8] text-[#3776AB]",
    name: "Python",
    desc: "A modern typed client with openapi-python-client — attrs models and httpx under the hood.",
    href: "#python",
    cta: "Generate"
  },
  {
    glyph: <Brand path={siGo.path} />,
    tone: "bg-[#E5F4F9] text-[#00ADD8]",
    name: "Go",
    desc: "openapi-generator with -g go.",
    href: "#any-language",
    cta: "Generate"
  },
  {
    glyph: <Brand path={siSharp.path} />,
    tone: "bg-[#EEEAF6] text-[#512BD4]",
    name: "C#",
    desc: "openapi-generator with -g csharp.",
    href: "#any-language",
    cta: "Generate"
  },
  {
    glyph: <Brand path={siOpenjdk.path} />,
    tone: "bg-ed-warm-100 text-ed-ink/70",
    name: "Java",
    desc: "openapi-generator with -g java.",
    href: "#any-language",
    cta: "Generate"
  },
  {
    glyph: <Brand path={siPhp.path} />,
    tone: "bg-[#EBECF3] text-[#777BB4]",
    name: "PHP",
    desc: "openapi-generator with -g php.",
    href: "#any-language",
    cta: "Generate"
  },
  {
    glyph: <Brand path={siRuby.path} />,
    tone: "bg-ed-red-bg text-[#CC342D]",
    name: "Ruby",
    desc: "openapi-generator with -g ruby.",
    href: "#any-language",
    cta: "Generate"
  }
];

export default async function ApiSdksPage() {
  const counts = toolCounts();
  const [fetchSpec, heyApiConfig, heyApi, pythonClient, openapiGenerator, heyApiAuth] =
    await Promise.all([
      highlight(FETCH_SPEC, "curl"),
      highlight(HEY_API_CONFIG, "javascript"),
      highlight(HEY_API, "curl"),
      highlight(PYTHON_CLIENT, "curl"),
      highlight(OPENAPI_GENERATOR, "curl"),
      highlight(HEY_API_AUTH, "javascript")
    ]);

  return (
    <DocPage>
      <DocEyebrow>Carbon API</DocEyebrow>
      <DocTitle>Client SDKs</DocTitle>
      <Lead>
        Carbon publishes an OpenAPI spec for all{" "}
        {counts.total.toLocaleString()} operations, so a typed client in your
        language is one generator command away — nothing hand-maintained to fall
        behind.
      </Lead>
      <SdkCardGrid cards={CARDS} />

      <H2 id="spec">The spec</H2>
      <P>
        The spec is public — no key needed to fetch it, so it works in CI and
        codegen pipelines:
      </P>
      <CodeBlock html={fetchSpec} code={FETCH_SPEC} label="Terminal" />
      <P>
        Inside are all {counts.total.toLocaleString()} operations, each a{" "}
        <Code>POST</Code> tagged by its module, with input schemas taken from
        the same validators the server runs and response shapes on ~95% of
        operations — so a generated client is typed in both directions.
      </P>

      <H2 id="typescript">TypeScript</H2>
      <P>
        <DocLink href="https://heyapi.dev/openapi-ts/get-started">
          @hey-api/openapi-ts
        </DocLink>{" "}
        generates a typed fetch client plus request/response types, grouped one
        class per Carbon module:
      </P>
      <CodeBlock
        html={heyApiConfig}
        code={HEY_API_CONFIG}
        label="openapi-ts.config.ts"
      />
      <CodeBlock html={heyApi} code={HEY_API} label="Terminal" />

      <H2 id="python">Python</H2>
      <P>
        <DocLink href="https://github.com/openapi-generators/openapi-python-client">
          openapi-python-client
        </DocLink>{" "}
        generates a modern client with typed models:
      </P>
      <CodeBlock html={pythonClient} code={PYTHON_CLIENT} label="Terminal" />

      <H2 id="any-language">Go, C#, Java, PHP, Ruby — any language</H2>
      <P>
        <DocLink href="https://github.com/OpenAPITools/openapi-generator">
          openapi-generator
        </DocLink>{" "}
        covers 50+ languages (it needs a Java 11+ runtime). Swap{" "}
        <Code>-g go</Code> for <Code>csharp</Code>, <Code>java</Code>,{" "}
        <Code>php</Code>, <Code>ruby</Code>, or any other generator:
      </P>
      <CodeBlock
        html={openapiGenerator}
        code={OPENAPI_GENERATOR}
        label="Terminal"
      />

      <H2 id="auth">Authenticate the client</H2>
      <P>
        One way in: the spec declares a single Bearer scheme, so every generated
        client sends a scoped API key from{" "}
        <ApiKeysLink>Settings → API Keys</ApiKeysLink> as{" "}
        <Code>Authorization: Bearer crbn_…</Code>. For the TypeScript client
        that is one config line:
      </P>
      <CodeBlock html={heyApiAuth} code={HEY_API_AUTH} label="src/api.ts" />

      <H2 id="responses">What comes back</H2>
      <P>
        Single results are the response body itself — no envelope to unwrap.
        List results come as <Code>{"{ results, count }"}</Code>, since a total
        only means something on a paginated read. Both shapes are in the spec,
        so generated return types already carry them. Failures return an error
        body with an HTTP status:
      </P>
      <Table>
        <Row head cols="90px 1fr" cells={["Status", "Meaning"]} />
        <Row
          cols="90px 1fr"
          cells={[
            <Code key="s">400</Code>,
            "The write failed — the message carries the database error"
          ]}
        />
        <Row
          cols="90px 1fr"
          cells={[
            <Code key="s">403</Code>,
            "The key lacks the operation's required scope"
          ]}
        />
        <Row
          cols="90px 1fr"
          cells={[<Code key="s">404</Code>, "No such operation"]}
        />
        <Row
          cols="90px 1fr"
          cells={[
            <Code key="s">429</Code>,
            "Rate limited — respect Retry-After"
          ]}
        />
      </Table>
      <P>
        Key-level failures (an expired or missing key) return{" "}
        <Code>401</Code> before the operation runs — see{" "}
        <DocLink href="/api/authentication">Authentication</DocLink>.
      </P>

      <ContentFooter
        prev={{ label: "Operations", url: "/api/operations" }}
        editPath="docs/app/api/sdks/page.tsx"
      />
    </DocPage>
  );
}
