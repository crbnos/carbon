import type { ComponentProps } from "react";
import { z } from "zod";
import { defineIntegration } from "../fns";

const CLAUDE_MCP_URL =
  "https://claude.ai/settings/connectors?action=add_custom&name=Carbon&url=https%3A%2F%2Fapp.carbon.ms%2Fapi%2Fmcp";

export const ClaudeMCP = defineIntegration({
  name: "Claude MCP",
  id: "claude-mcp",
  active: true,
  category: "AI",
  logo: Logo,
  shortDescription: "Use Carbon tools directly inside Claude.",
  description:
    "Connect Carbon to Claude via the Model Context Protocol (MCP). Once installed, Claude can read and act on your Carbon data directly from any conversation.",
  images: [],
  settings: [],
  schema: z.object({}),
  onClientInstall: async () => {
    window.open(CLAUDE_MCP_URL, "_blank", "noopener,noreferrer");
  }
});

function Logo(props: ComponentProps<"svg">) {
  return (
    <svg
      {...props}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Anthropic / Claude logomark — stylized "A" shape */}
      <path d="M23.685 9H28L20 31H16.315L23.685 9Z" fill="currentColor" />
      <path
        d="M12 9H16.315L20 19.5L23.685 9H28L20 31L12 9Z"
        fill="currentColor"
        fillOpacity="0.35"
      />
      <path d="M14.5 23H25.5L24.2 26.5H15.8L14.5 23Z" fill="currentColor" />
    </svg>
  );
}
