import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import McpStyle from "~/styles/mcp-docs.css?url";
import { MCP_BLOCKED_TOOL_NAMES } from "../api+/mcp+/lib/mcp-blocked-tools";
import toolMetadata from "../api+/mcp+/lib/tool-metadata.json";
import { buildMcpCatalog, type RawToolMeta } from "./catalog";
import { McpPage } from "./components/McpPage";

export const meta: MetaFunction = () => [
  { title: "Carbon MCP server — Developer docs" },
  {
    name: "description",
    content: "Connect any MCP-compatible AI assistant to Carbon."
  }
];

export function links() {
  return [{ rel: "stylesheet", href: McpStyle }];
}

// PUBLIC: deliberately no requireAuthSession / requirePermissions here.
export async function loader(_args: LoaderFunctionArgs) {
  const catalog = buildMcpCatalog(
    toolMetadata as RawToolMeta,
    MCP_BLOCKED_TOOL_NAMES
  );
  return { catalog };
}

export default function McpRoute() {
  const { catalog } = useLoaderData<typeof loader>();
  return <McpPage catalog={catalog} />;
}
