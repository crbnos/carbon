import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumb } from "@/components/api/breadcrumb";
import { CodeBlock } from "@/components/api/code-block";
import { DocPage, H2, P } from "@/components/api/doc";
import { OperationPanel } from "@/components/api/operation-panel";
import {
  type JsonSchemaNode,
  SchemaTable
} from "@/components/api/schema-table";
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

/**
 * A representative value for a reflected response schema. Enums use their first
 * real value and nullables show the non-null form — a sample exists to be read.
 * Anything the schema genuinely doesn't describe — a depth-capped branch, an
 * `any` — renders as the "…" marker, never as `null`: null reads as a real value
 * a caller might receive, while "…" reads as what it is, an omission. Arrays
 * render a single element; one row shows the shape.
 */
const OMITTED = "…";

function exampleFromSchema(schema: unknown, depth = 0): unknown {
  if (!schema || typeof schema !== "object") return OMITTED;
  const s = schema as JsonSchemaNode;

  if (Array.isArray(s.enum) && s.enum.length > 0) return s.enum[0];
  // Past the reflected schemas' own depth — nothing real left to show.
  if (depth > 8) return OMITTED;

  const types = Array.isArray(s.type) ? s.type : s.type ? [s.type] : [];
  const primary = types.find((t) => t !== "null") ?? types[0];

  switch (primary) {
    case "array":
      return [s.items ? exampleFromSchema(s.items, depth + 1) : OMITTED];
    case "object": {
      if (s.properties) {
        const out: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(s.properties)) {
          out[key] = exampleFromSchema(value, depth + 1);
        }
        return out;
      }
      if (s.additionalProperties && typeof s.additionalProperties === "object") {
        return { [OMITTED]: exampleFromSchema(s.additionalProperties, depth + 1) };
      }
      // A bare `{type:"object"}` is the walker's own truncation (cycle or cap).
      return OMITTED;
    }
    case "number":
    case "integer":
      return 0;
    case "boolean":
      return true;
    case "string":
      return "string";
    case "null":
      return null;
    default:
      return OMITTED;
  }
}

/**
 * The success envelope from the dispatcher (`api+/v1+/lib/dispatch.server.ts`):
 * a Supabase result unwrapped to `data` plus an optional `count`, with `data`
 * filled from the operation's reflected response shape.
 */
function responseEnvelope(responseSchema: unknown): string {
  const data = responseSchema ? exampleFromSchema(responseSchema) : {};
  return JSON.stringify({ data, count: null }, null, 2);
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

  const responseJson = responseEnvelope(t.responseSchema);
  const [schemaHtml, responseHtml, ...sampleHtml] = await Promise.all([
    highlight(schemaJson, "json"),
    highlight(responseJson, "json"),
    ...SAMPLE_KEYS.map((k) => highlight(samples[k], SAMPLE_GRAMMAR[k]))
  ]);
  const highlighted = Object.fromEntries(
    SAMPLE_KEYS.map((k, i) => [k, sampleHtml[i]])
  ) as Record<SampleKey, string>;

  const description = t.description
    ? t.description.charAt(0).toUpperCase() + t.description.slice(1)
    : "";

  return (
    <DocPage wide>
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

      {/* The request sample runs full width: in a half column the Python and
          JavaScript samples had to wrap so hard they broke mid-token. Below it the
          parameter table and the raw schema sit side by side — the same contract in
          its human and machine forms. */}
      <div className="mt-7">
        <OperationPanel
          samples={samples}
          highlighted={highlighted}
          httpPath={httpPath}
          responseHtml={responseHtml}
        />
      </div>

      <div className="mt-2 grid grid-cols-1 items-start gap-x-12 gap-y-8 lg:grid-cols-2">
        <div className="min-w-0">
          <H2 id="parameters">Parameters</H2>
          <SchemaTable schema={t.schema} />
        </div>
        <div className="min-w-0">
          <H2 id="schema">Input schema</H2>
          <CodeBlock html={schemaHtml} code={schemaJson} label="schema" />
        </div>
      </div>

    </DocPage>
  );
}
