import type { McpCatalog } from "../catalog";
import { ToolBrowser } from "./ToolBrowser";

export function Tools({ catalog }: { catalog: McpCatalog }) {
  return (
    <>
      <p className="text-muted-foreground max-w-[64ch] mb-6 text-[0.95rem] [text-wrap:pretty]">
        {catalog.total.toLocaleString()} tools across {catalog.moduleCount}{" "}
        modules. Filter by module, or search the full catalog.
      </p>
      <ToolBrowser tools={catalog.tools} modules={catalog.modules} />
    </>
  );
}
