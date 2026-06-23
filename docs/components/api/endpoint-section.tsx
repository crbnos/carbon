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
      className="grid scroll-mt-22 grid-cols-1 gap-x-14 gap-y-6 border-t border-ed-hairline py-11 lg:grid-cols-2"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          <MethodBadge method={endpoint.method} />
          <code className="font-mono text-ed-13 text-ed-ink/63">
            {endpoint.path}
          </code>
        </div>
        <h2 className="m-0 mt-3.5 text-ed-24 font-semi leading-[130%] text-ed-ink">
          {endpoint.title}
        </h2>
        <p className="m-0 mt-2.5 text-ed-15 leading-[160%] text-ed-ink/80">
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
