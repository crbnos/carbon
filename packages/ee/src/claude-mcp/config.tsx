import type { ComponentProps } from "react";

export type QuickInstallConnector = {
  id: string;
  name: string;
  description: string;
  badge: string;
  installUrl: string;
  logo: React.FC<ComponentProps<"svg">>;
};

export const ClaudeMCP: QuickInstallConnector = {
  id: "claude-mcp",
  name: "Claude",
  badge: "Preset link",
  description:
    "Open Claude with the Carbon connector name and MCP URL prefilled.",
  installUrl:
    "https://claude.ai/settings/connectors?action=add_custom&name=Carbon&url=https%3A%2F%2Fapp.carbon.ms%2Fapi%2Fmcp",
  logo: ClaudeLogo
};

function ClaudeLogo(props: ComponentProps<"svg">) {
  // Anthropic's official Claude logomark (from claude.ai/anthropic.com)
  return (
    <svg
      {...props}
      viewBox="0 0 46 46"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M29.04 7.5H22.96L14 38.5H19.48L21.56 31.5H24.44L26.52 38.5H32L29.04 7.5Z"
        fill="currentColor"
      />
      <path
        d="M21.56 31.5L23 26.5L24.44 31.5H21.56Z"
        fill="currentColor"
        fillOpacity="0.4"
      />
    </svg>
  );
}
