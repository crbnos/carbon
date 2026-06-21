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
  READ: "bg-[#E4F8DA] text-[#3F9142] border-[#A8DB91]",
  WRITE: "bg-[#DFF5FF] text-[#1E84B0] border-[#A9DAF3]",
  DESTRUCTIVE: "bg-[#FCE8E6] text-[#B3261E] border-[#F2C0BC]"
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
    <div className="mt-[10px] divide-y divide-[#E7E7E3] border-t border-[#E7E7E3]">
      {names.map((name) => {
        const p = props[name];
        return (
          <div key={name} className="py-[13px]">
            <div className="flex flex-wrap items-center gap-[8px]">
              <code className="font-[family-name:var(--font-mono)] text-[13.5px] text-[#262323]">
                {name}
              </code>
              <span className="font-[family-name:var(--font-mono)] text-[12px] text-[rgba(38,35,35,0.54)]">
                {propType(p)}
              </span>
              {required.has(name) ? (
                <span className="text-[11px] font-medium text-[#9C7136]">
                  required
                </span>
              ) : (
                <span className="text-[11px] font-medium text-[rgba(38,35,35,0.48)]">
                  optional
                </span>
              )}
            </div>
            {p.description && (
              <p className="m-0 mt-[6px] text-[14.5px] leading-[150%] text-[rgba(38,35,35,0.74)]">
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
      <div className="mt-[8px] flex flex-wrap items-center gap-[12px]">
        <h1 className="m-0 break-all font-[family-name:var(--font-mono)] text-[25px] font-[560] leading-[120%] text-[#262323]">
          {t.name}
        </h1>
        <span
          className={`inline-flex shrink-0 items-center rounded-[6px] border px-[8px] py-[2px] font-[family-name:var(--font-mono)] text-[11px] font-semibold ${BADGE[t.classification]}`}
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
