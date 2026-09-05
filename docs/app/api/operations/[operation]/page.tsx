import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumb } from "@/components/api/breadcrumb";
import { CodeBlock } from "@/components/api/code-block";
import { Code, DocPage, H2, P } from "@/components/api/doc";
import { OperationPanel } from "@/components/api/operation-panel";
import { SchemaTable } from "@/components/api/schema-table";
import { highlight } from "@/lib/highlight";
import {
  buildOperationSamples,
  operationPath,
  SAMPLE_GRAMMAR,
  SAMPLE_KEYS,
  type SampleKey
} from "@/lib/operation-samples";
import { pageSeo } from "@/lib/seo";
import {
  allToolParams,
  getTool,
  operationLabel,
  type ToolClass
} from "@/lib/tools-data";

type Params = { params: Promise<{ operation: string }> };

export function generateStaticParams() {
  return allToolParams().map((p) => ({ operation: p.tool }));
}

export async function generateMetadata(props: Params): Promise<Metadata> {
  const { operation } = await props.params;
  const found = getTool(operation);
  // The full, callable name stays in the page title — that is the string a reader
  // pastes into a search box — while the heading drops the module prefix the
  // breadcrumb already carries.
  return pageSeo({
    title: found ? `${found.tool.name} — Carbon API` : "Carbon API",
    ogTitle: found?.tool.name ?? "Carbon API",
    description: found?.tool.description,
    path: `/api/operations/${operation}`,
    eyebrow: found ? `Carbon API · ${found.module.name}` : "Carbon API"
  });
}

const BADGE: Record<ToolClass, string> = {
  READ: "bg-ed-green-bg text-ed-green-strong border-ed-green-border",
  WRITE: "bg-ed-blue-bg text-ed-brand-ink border-ed-blue-border",
  DESTRUCTIVE: "bg-ed-red-bg text-ed-red border-ed-red-border"
};

export default async function OperationPage(props: Params) {
  const { operation } = await props.params;
  const found = getTool(operation);
  if (!found) notFound();
  const { module: mod, tool: t } = found;

  const samples = buildOperationSamples(t.name, mod.slug, t.schema);
  const httpPath = operationPath(t.name, mod.slug);
  const schemaJson = JSON.stringify(t.schema, null, 2);

  const [schemaHtml, ...sampleHtml] = await Promise.all([
    highlight(schemaJson, "json"),
    ...SAMPLE_KEYS.map((k) => highlight(samples[k], SAMPLE_GRAMMAR[k]))
  ]);
  const highlighted = Object.fromEntries(
    SAMPLE_KEYS.map((k, i) => [k, sampleHtml[i]])
  ) as Record<SampleKey, string>;

  const description = t.description
    ? t.description.charAt(0).toUpperCase() + t.description.slice(1)
    : "";

  return (
    <DocPage>
      <Breadcrumb
        items={[
          { label: "Operations", href: "/api/operations" },
          { label: mod.name }
        ]}
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="m-0 break-all font-mono text-ed-24 font-semibold tracking-tight leading-[120%] text-ed-ink">
          {operationLabel(t.name, mod.slug)}
        </h1>
        <span
          className={`inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 font-mono text-ed-11 font-semibold ${BADGE[t.classification]}`}
        >
          {t.classification}
        </span>
      </div>
      {description && <P>{description}.</P>}

      <H2 id="request">Request</H2>
      <P>
        Call it over HTTP, or through the <Code>call_tool</Code> meta-tool over MCP —
        both reach the same operation.
      </P>
      <OperationPanel
        samples={samples}
        highlighted={highlighted}
        httpPath={httpPath}
      />

      <H2 id="parameters">Parameters</H2>
      <SchemaTable schema={t.schema} />

      <H2 id="schema">Input schema</H2>
      <P>The raw JSON Schema the operation validates its arguments against.</P>
      <CodeBlock html={schemaHtml} code={schemaJson} label="schema" />
    </DocPage>
  );
}
