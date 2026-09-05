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
import { pageSeo, SEO } from "@/lib/seo";
import { toolCounts } from "@/lib/tools-data";

export const metadata = pageSeo({
  title: `${SEO.carbonApi.operations.title} — Carbon`,
  ogTitle: SEO.carbonApi.operations.title,
  description: SEO.carbonApi.operations.description,
  path: "/api/operations",
  eyebrow: "Carbon API"
});

// Counts are derived from the generated catalog, so they never drift from what the
// server actually exposes.
const { total: OPERATION_COUNT, modules: MODULE_COUNT, byClass: CLASS_COUNT, perModule: MODULES } =
  toolCounts();

export default function ApiOperationsPage() {
  return (
    <DocPage>
      <DocEyebrow>Carbon API</DocEyebrow>
      <DocTitle>Operations</DocTitle>
      <Lead>
        The Carbon API is {OPERATION_COUNT.toLocaleString()} operations across{" "}
        {MODULE_COUNT} modules. Every one is callable two ways — over plain HTTP,
        and as a tool over MCP. Same operation, same arguments, same permissions.
      </Lead>

      <H2 id="calling">Calling an operation</H2>
      <P>
        Over HTTP, each operation is a POST to its module and name, with the
        arguments as the JSON body:
      </P>
      <Table>
        <Row head cols="150px 1fr" cells={["Transport", "How you call it"]} />
        <Row
          cols="150px 1fr"
          cells={[
            "HTTP",
            <Code key="h">POST /api/v1/&#123;module&#125;/&#123;operation&#125;</Code>
          ]}
        />
        <Row
          cols="150px 1fr"
          cells={[
            "MCP",
            <Code key="m">call_tool</Code>
          ]}
        />
      </Table>
      <P>
        Each operation page shows both, with a copyable sample. Connecting an MCP
        client is covered in <DocLink href="/api/mcp">Connect over MCP</DocLink>.
      </P>

      <H2 id="classification">Classification</H2>
      <P>Every operation is classified, so a client can gate actions by risk:</P>
      <Table>
        <Row head cols="130px 1fr 72px" cells={["Class", "Grants", "Count"]} />
        <Row
          cols="130px 1fr 72px"
          cells={[<Code key="r">READ</Code>, "Read rows", String(CLASS_COUNT.READ)]}
        />
        <Row
          cols="130px 1fr 72px"
          cells={[
            <Code key="w">WRITE</Code>,
            "Create & update rows",
            String(CLASS_COUNT.WRITE)
          ]}
        />
        <Row
          cols="130px 1fr 72px"
          cells={[
            <Code key="x">DESTRUCTIVE</Code>,
            "Delete rows",
            String(CLASS_COUNT.DESTRUCTIVE)
          ]}
        />
      </Table>

      <H2 id="modules">Modules</H2>
      <P>
        The catalog is grouped into {MODULE_COUNT} modules — browse them in
        the sidebar:
      </P>
      <Table>
        <Row head cols="1fr 72px" cells={["Module", "Operations"]} />
        {MODULES.map(([name, count]) => (
          <Row key={name} cols="1fr 72px" cells={[name, String(count)]} />
        ))}
      </Table>

      <ContentFooter prev={{ label: "Authentication", url: "/api/authentication" }} />
    </DocPage>
  );
}
