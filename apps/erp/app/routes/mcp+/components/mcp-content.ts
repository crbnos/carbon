export const ENDPOINT = "https://app.carbon.ms/api/mcp";

export const PROMPTS: string[] = [
  "Show all open sales orders due to ship this week.",
  "Create a job for 50 units of SKU-1042 on the CNC work center.",
  "Which purchase orders are past their promised receipt date?",
  "What's the on-hand quantity and reorder point for BRACKET-200 across locations?",
  "Draft a quote for Acme for 200 aluminum housings.",
  "List every job behind schedule and who's assigned."
];

export const SPECIFICITY = {
  broad: "“Sort out my late orders.”",
  specific: "“Release every sales order stuck in Needs Approval for 3+ days.”"
};

export const FAQ: { q: string; a: string }[] = [
  {
    q: "Do I need an API key?",
    a: "Not for connector clients — add the URL and authorize in your browser. Keys are for CLI/config clients and headless or CI use."
  },
  {
    q: "Does it respect my Carbon permissions?",
    a: "Yes. A connector inherits the role and company of whoever authorizes it; an API key carries its own scopes. The assistant can only do what that identity can."
  },
  {
    q: "I'm getting 401 Unauthorized",
    a: "Key clients: the key is missing, malformed, expired, or deleted — recreate it in Settings → API Keys and update the Authorization header. Connector clients: re-authorize the connection from your client."
  },
  {
    q: "How do I manage or revoke a key?",
    a: "Each key in Settings → API Keys shows its scopes, rate limit, expiry, and who created it. Delete a key to revoke it; use a separate key per client so revoking one doesn't break the rest."
  },
  {
    q: "Which clients are supported?",
    a: "Any MCP client that speaks HTTP. Claude.ai, Claude Desktop, and ChatGPT authorize over OAuth; Claude Code, Cursor, VS Code, and Codex send a key header; stdio-only clients bridge through mcp-remote."
  },
  {
    q: "Why can't the assistant see every tool at once?",
    a: "By design. Three discovery meta-tools — search_tools, describe_tool, and call_tool — let the model find and load only the tools a task needs, keeping its context lean."
  }
];

export const TOC = [
  { id: "whatis", label: "What is MCP?" },
  { id: "ask", label: "What you can ask" },
  { id: "quickstart", label: "Quickstart" },
  { id: "discovery", label: "Tool discovery" },
  { id: "tools", label: "Tools" },
  { id: "auth", label: "Authentication" },
  { id: "safety", label: "Safety" },
  { id: "faq", label: "FAQ" }
];

// Connector clients authorize via OAuth (no key); command clients paste a snippet
// carrying a scoped key. `code`/`target`/`action` describe step 2 of the command flow.
export type Client =
  | { name: string; slug: string; flow: "connector"; where: string }
  | {
      name: string;
      slug: string;
      flow: "command";
      target: string;
      action: string;
      code: string;
    };

// The major clients only — everything else follows one of these two patterns
// (see the Authentication section / the note below the pipeline).
export const CLIENTS: Client[] = [
  {
    name: "Claude Code",
    slug: "claude-code",
    flow: "command",
    target: "Terminal · Claude Code",
    action: "Run the command",
    code: `claude mcp add --transport http \\\n  carbon ${ENDPOINT} \\\n  --header "Authorization: Bearer crbn_…"`
  },
  {
    name: "Claude Desktop & Web",
    slug: "claude-ai",
    flow: "connector",
    where: "Settings → Connectors"
  },
  {
    name: "Cursor",
    slug: "cursor",
    flow: "command",
    target: ".cursor/mcp.json",
    action: "Add to your config",
    code: `{\n  "mcpServers": {\n    "carbon": {\n      "url": "${ENDPOINT}",\n      "headers": { "Authorization": "Bearer crbn_…" }\n    }\n  }\n}`
  }
];
