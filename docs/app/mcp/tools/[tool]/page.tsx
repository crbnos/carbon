import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumb } from "@/components/api/breadcrumb";
import { CodeBlock } from "@/components/api/code-block";
import { Code, DocPage, H2, P } from "@/components/api/doc";
import { highlight } from "@/lib/highlight";
import { pageSeo } from "@/lib/seo";
import { allToolParams, getTool, type ToolClass } from "@/lib/tools-data";

type Params = { params: Promise<{ tool: string }> };

export function generateStaticParams() {
  return allToolParams();
}

export async function generateMetadata(props: Params): Promise<Metadata> {
  const { tool } = await props.params;
  const found = getTool(tool);
  return pageSeo({
    title: found ? `${found.tool.name} — Carbon MCP` : "Carbon MCP",
    ogTitle: found?.tool.name ?? "Carbon MCP",
    description: found?.tool.description,
    path: `/mcp/tools/${tool}`,
    eyebrow: found ? `MCP · ${found.module.name}` : "MCP"
  });
}

const BADGE: Record<ToolClass, string> = {
  READ: "bg-ed-green-bg text-ed-green-strong border-ed-green-border",
  WRITE: "bg-ed-blue-bg text-ed-brand-ink border-ed-blue-border",
  DESTRUCTIVE: "bg-ed-red-bg text-ed-red border-ed-red-border"
};

type JsonProp = {
  type?: string;
  description?: string;
  enum?: unknown[];
  format?: string;
  items?: { type?: string };
};
type JsonSchema = {
  properties?: Record<string, JsonProp>;
  required?: string[];
};

function propType(p: JsonProp): string {
  if (Array.isArray(p.enum) && p.enum.length) return "enum";
  if (p.type === "array") return `${p.items?.type ?? "any"}[]`;
  return p.format ?? p.type ?? "any";
}

/** Render a tool's input schema as a readable parameter list (required first). */
function Parameters({ schema }: { schema: unknown }) {
  const s = (schema ?? {}) as JsonSchema;
  const props = s.properties ?? {};
  const required = new Set(s.required ?? []);
  const names = Object.keys(props).sort(
    (a, b) => Number(required.has(b)) - Number(required.has(a))
  );
  if (names.length === 0) return <P>This tool takes no arguments.</P>;

  return (
    <div className="mt-2.5 divide-y divide-ed-hairline border-t border-ed-hairline">
      {names.map((name) => {
        const p = props[name];
        return (
          <div key={name} className="py-[13px]">
            <div className="flex flex-wrap items-center gap-2">
              <code className="font-mono text-ed-13 text-ed-ink">
                {name}
              </code>
              <span className="font-mono text-ed-12 text-ed-ink/54">
                {propType(p)}
              </span>
              {required.has(name) ? (
                <span className="text-ed-11 font-medium text-ed-amber-text">
                  required
                </span>
              ) : (
                <span className="text-ed-11 font-medium text-ed-ink/48">
                  optional
                </span>
              )}
            </div>
            {p.description && (
              <p className="m-0 mt-1.5 text-ed-14 leading-normal text-ed-ink/74">
                {p.description}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function exampleArg(prop: unknown): unknown {
  if (!prop || typeof prop !== "object") return "string";
  switch ((prop as { type?: string }).type) {
    case "number":
    case "integer":
      return 0;
    case "boolean":
      return true;
    case "array":
      return [];
    case "object":
      return {};
    default:
      return "string";
  }
}

function exampleArgs(schema: unknown): Record<string, unknown> {
  const s = (schema ?? {}) as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
  const props = s.properties ?? {};
  const required = s.required ?? Object.keys(props);
  const out: Record<string, unknown> = {};
  for (const key of required) out[key] = exampleArg(props[key]);
  return out;
}

export default async function ToolPage(props: Params) {
  const { tool } = await props.params;
  const found = getTool(tool);
  if (!found) notFound();
  const { module: mod, tool: t } = found;

  const schemaJson = JSON.stringify(t.schema, null, 2);
  const callSnippet = `call_tool(${JSON.stringify({ name: t.name, arguments: exampleArgs(t.schema) }, null, 2)})`;
  const [callHtml, schemaHtml] = await Promise.all([
    highlight(callSnippet, "javascript"),
    highlight(schemaJson, "json")
  ]);

  const description = t.description
    ? t.description.charAt(0).toUpperCase() + t.description.slice(1)
    : "";

  return (
    <DocPage>
      <Breadcrumb
        items={[{ label: "MCP", href: "/mcp" }, { label: mod.name }]}
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="m-0 break-all font-mono text-ed-24 font-semi leading-[120%] text-ed-ink">
          {t.name}
        </h1>
        <span
          className={`inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 font-mono text-ed-11 font-semibold ${BADGE[t.classification]}`}
        >
          {t.classification}
        </span>
      </div>
      {description && <P>{description}.</P>}

      <H2 id="parameters">Parameters</H2>
      <Parameters schema={t.schema} />

      <H2 id="call">Call it</H2>
      <P>
        Invoke it through the <Code>call_tool</Code> meta-tool with its
        arguments:
      </P>
      <CodeBlock html={callHtml} code={callSnippet} label="call_tool" />

      <H2 id="schema">Input schema</H2>
      <P>The raw JSON Schema the tool validates its arguments against.</P>
      <CodeBlock html={schemaHtml} code={schemaJson} label="schema" />
    </DocPage>
  );
}
