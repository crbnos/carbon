import type { ReactNode } from "react";
import { CodeBlock } from "@/components/api/code-block";
import {
  Code,
  DocEyebrow,
  DocLink,
  DocPage,
  DocTitle,
  H2,
  Lead,
  P,
  Warn
} from "@/components/api/doc";
import { ContentFooter } from "@/components/api/page-footer";
import { highlight } from "@/lib/highlight";
import { pageSeo, SEO } from "@/lib/seo";

export const metadata = pageSeo({
  title: `${SEO.api.auth.title} — Carbon`,
  ogTitle: SEO.api.auth.title,
  description: SEO.api.auth.description,
  path: "/api-reference/authentication",
  eyebrow: "API reference"
});

const REQUEST = `curl 'https://rest.carbon.ms/item?limit=1' \\
  -H "Authorization: Bearer <api-key>"`;

function Row({
  cells,
  cols,
  head = false
}: {
  cells: ReactNode[];
  cols: string;
  head?: boolean;
}) {
  return (
    <div
      className="grid border-t border-ed-warm-300 first:border-t-0"
      style={{ gridTemplateColumns: cols }}
    >
      {cells.map((c, i) => (
        <div
          key={i}
          className={`px-3 py-[9px] text-ed-14 leading-normal ${
            head ? "font-semi text-ed-ink" : "text-ed-ink/82"
          } ${i > 0 ? "border-l border-ed-warm-300" : ""}`}
        >
          {c}
        </div>
      ))}
    </div>
  );
}

function Table({ children }: { children: ReactNode }) {
  return (
    <div className="my-[18px] overflow-hidden rounded-[10px] border border-ed-warm-300">
      {children}
    </div>
  );
}

export default async function AuthenticationPage() {
  const html = await highlight(REQUEST, "curl");
  return (
    <DocPage>
      <DocEyebrow>REST API</DocEyebrow>
      <DocTitle>Authentication</DocTitle>
      <Lead>
        Carbon authenticates public API requests with a scoped, optionally
        expiring API key.
      </Lead>
      <P>
        Create a key in{" "}
        <DocLink href="https://app.carbon.ms/x/settings/api-keys">
          Settings → API Keys
        </DocLink>
        , then send it on every request as a bearer token:{" "}
        <Code>Authorization: Bearer &lt;api-key&gt;</Code>.
      </P>
      <CodeBlock html={html} code={REQUEST} label="Example request" />

      <H2 id="creating-a-key">Creating a key</H2>
      <P>
        Choosing <strong>New API Key</strong> opens a dialog with three fields:
      </P>
      <Table>
        <Row
          head
          cols="120px 1fr 84px"
          cells={["Field", "Description", "Required"]}
        />
        <Row
          cols="120px 1fr 84px"
          cells={[
            "Name",
            "A label to identify the key in your list. Not sent with requests.",
            "Yes"
          ]}
        />
        <Row
          cols="120px 1fr 84px"
          cells={[
            "Expires At",
            "Date the key stops working. Leave blank for a key that never expires.",
            "No"
          ]}
        />
        <Row
          cols="120px 1fr 84px"
          cells={[
            "Permissions",
            "A grid of every module against View / Create / Update / Delete. The key can only perform the actions you check.",
            "Yes"
          ]}
        />
      </Table>
      <Warn title="The key is shown only once">
        Copy the <Code>crbn_…</Code> token when it is generated — Carbon stores
        only a hash and cannot show it again. Keep it server-side; it carries
        every permission you grant. Lost a key? Delete it and create a new one.
      </Warn>

      <H2 id="permissions">Permissions</H2>
      <P>
        Each checkbox grants one action on one module. The action maps to the
        HTTP method of the request:
      </P>
      <Table>
        <Row
          head
          cols="110px 1fr 96px"
          cells={["Action", "Grants", "Method"]}
        />
        <Row
          cols="110px 1fr 96px"
          cells={["View", "Read rows", <Code key="g">GET</Code>]}
        />
        <Row
          cols="110px 1fr 96px"
          cells={["Create", "Insert rows", <Code key="p">POST</Code>]}
        />
        <Row
          cols="110px 1fr 96px"
          cells={["Update", "Modify rows", <Code key="pa">PATCH</Code>]}
        />
        <Row
          cols="110px 1fr 96px"
          cells={["Delete", "Remove rows", <Code key="d">DELETE</Code>]}
        />
      </Table>
      <P>
        Reading from <Code>/item</Code>, for example, needs{" "}
        <strong>Parts → View</strong>. A request for an action the key does not
        hold returns <Code>403</Code>. Some modules omit actions they do not
        support (Accounting has no Delete, shown as <Code>--</Code>).
      </P>

      <H2 id="expiration">Expiration & errors</H2>
      <P>
        If a key is past its <strong>Expires At</strong> date, requests fail
        with <Code>401</Code> before anything runs. Other authentication
        failures:
      </P>
      <Table>
        <Row head cols="72px 1fr" cells={["Status", "When it happens"]} />
        <Row
          cols="72px 1fr"
          cells={[
            <Code key="a">401</Code>,
            "Missing or invalid key, or the key has expired."
          ]}
        />
        <Row
          cols="72px 1fr"
          cells={[
            <Code key="b">403</Code>,
            "The key lacks the required module permission (or the company is on the Starter plan)."
          ]}
        />
        <Row
          cols="72px 1fr"
          cells={[
            <Code key="c">429</Code>,
            "Rate limit exceeded — back off and retry per the X-RateLimit-* response headers."
          ]}
        />
      </Table>

      <ContentFooter prev={{ label: "Overview", url: "/api-reference" }} />
    </DocPage>
  );
}
