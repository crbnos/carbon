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
        {MODULE_COUNT} modules — reached through one lean discovery pattern, so
        an assistant never has to load them all at once.
      </Lead>

      <H2 id="discovery">Discovery</H2>
      <P>
        Rather than list every operation, the server presents three meta-tools.
        The model uses them to find and load only what a task needs:
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
        how large the catalog grows.
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
