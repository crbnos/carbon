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
import { pageSeo, SEO } from "@/lib/seo";

export const metadata = pageSeo({
  title: `${SEO.mcp.tools.title} — Carbon`,
  ogTitle: SEO.mcp.tools.title,
  description: SEO.mcp.tools.description,
  path: "/mcp/tools",
  eyebrow: "MCP"
});

const MODULES: [string, number][] = [
  ["Sales", 181],
  ["Items", 147],
  ["Production", 132],
  ["Inventory", 113],
  ["Purchasing", 109],
  ["Resources", 96],
  ["Quality", 85],
  ["Settings", 83],
  ["Accounting", 81],
  ["Shared", 50],
  ["People", 46],
  ["Invoicing", 34],
  ["Users", 26],
  ["Documents", 14],
  ["Account", 10]
];

export default function McpToolsPage() {
  return (
    <DocPage>
      <DocEyebrow>MCP</DocEyebrow>
      <DocTitle>Tools</DocTitle>
      <Lead>
        Carbon's MCP server exposes more than 1,200 tools across 15 modules —
        without flooding the assistant's context with all of them at once.
      </Lead>

      <H2 id="discovery">Tool discovery</H2>
      <P>
        Rather than list every tool, the server presents three meta-tools. The
        model uses them to find and load only the tools a task needs:
      </P>
      <Table>
        <Row head cols="150px 1fr" cells={["Meta-tool", "What it does"]} />
        <Row
          cols="150px 1fr"
          cells={[
            <Code key="s">search_tools</Code>,
            "Find tools by query, module, or classification."
          ]}
        />
        <Row
          cols="150px 1fr"
          cells={[
            <Code key="d">describe_tool</Code>,
            "Get a tool's input schema and description."
          ]}
        />
        <Row
          cols="150px 1fr"
          cells={[
            <Code key="c">call_tool</Code>,
            "Invoke a tool by name with its arguments."
          ]}
        />
      </Table>
      <P>
        A typical flow is <Code>search_tools</Code> → <Code>describe_tool</Code>{" "}
        → <Code>call_tool</Code>, which keeps the model's context lean no matter
        how large the catalog grows.
      </P>

      <H2 id="classification">Classification</H2>
      <P>Every tool is classified, so a client can gate actions by risk:</P>
      <Table>
        <Row head cols="130px 1fr 72px" cells={["Class", "Grants", "Count"]} />
        <Row
          cols="130px 1fr 72px"
          cells={[<Code key="r">READ</Code>, "Read rows", "617"]}
        />
        <Row
          cols="130px 1fr 72px"
          cells={[<Code key="w">WRITE</Code>, "Create & update rows", "438"]}
        />
        <Row
          cols="130px 1fr 72px"
          cells={[<Code key="x">DESTRUCTIVE</Code>, "Delete rows", "152"]}
        />
      </Table>

      <H2 id="modules">Modules</H2>
      <P>
        The catalog is grouped into 15 modules — browse them in the sidebar:
      </P>
      <Table>
        <Row head cols="1fr 72px" cells={["Module", "Tools"]} />
        {MODULES.map(([name, count]) => (
          <Row key={name} cols="1fr 72px" cells={[name, String(count)]} />
        ))}
      </Table>
    </DocPage>
  );
}
