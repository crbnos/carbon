import type { ApiEndpoint } from "@/lib/api-types";
import { highlight } from "@/lib/highlight";
import { CodePanel } from "./code-panel";
import { Fields } from "./fields";
import { MethodBadge } from "./method-badge";

export async function EndpointSection({ endpoint, base }: { endpoint: ApiEndpoint; base: string }) {
  const [curl, javascript, python, go, responseHtml] = await Promise.all([
    highlight(endpoint.samples.curl, "curl"),
    highlight(endpoint.samples.javascript, "javascript"),
    highlight(endpoint.samples.python, "python"),
    highlight(endpoint.samples.go, "go"),
    highlight(endpoint.response, "json"),
  ]);

  const bodyTitle =
    endpoint.kind === "create" || endpoint.kind === "update" ? "Body parameters" : "Attributes";

  return (
    <section
      id={endpoint.id}
      className="grid scroll-mt-[88px] grid-cols-1 gap-x-[56px] gap-y-[24px] border-t border-[#E7E7E3] py-[44px] lg:grid-cols-2"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-[10px]">
          <MethodBadge method={endpoint.method} />
          <code className="font-[family-name:var(--font-mono)] text-[13.5px] text-[rgba(38,35,35,0.63)]">
            {endpoint.path}
          </code>
        </div>
        <h2 className="m-0 mt-[14px] text-[24px] font-[560] leading-[130%] text-[#262323]">
          {endpoint.title}
        </h2>
        <p className="m-0 mt-[10px] text-[15.5px] leading-[160%] text-[rgba(38,35,35,0.8)]">
          {endpoint.description}
        </p>
        <Fields title="Query parameters" query={endpoint.query} />
        <Fields title={bodyTitle} attributes={endpoint.attributes} />
      </div>

      <div className="min-w-0">
        <CodePanel
          samples={endpoint.samples}
          highlighted={{ curl, javascript, python, go }}
          method={endpoint.method}
          fullPath={`${base}${endpoint.path}`}
          response={endpoint.response}
          responseHtml={responseHtml}
        />
      </div>
    </section>
  );
}
