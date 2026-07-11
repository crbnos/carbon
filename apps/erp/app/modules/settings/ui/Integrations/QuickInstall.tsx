import type { QuickInstallConnector } from "@carbon/ee";
import { Badge, Button } from "@carbon/react";
import { LuExternalLink } from "react-icons/lu";

type QuickInstallProps = {
  connectors: QuickInstallConnector[];
};

export function QuickInstall({ connectors }: QuickInstallProps) {
  if (connectors.length === 0) return null;

  return (
    <div className="px-4 flex flex-col gap-3">
      <div>
        <p className="text-sm font-medium">Quick install</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Open a prefilled installer for AI clients that support MCP.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        {connectors.map((connector) => (
          <div
            key={connector.id}
            className="flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-3"
          >
            <connector.logo className="h-7 w-7 shrink-0 text-foreground" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{connector.name}</span>
                <Badge variant="secondary" className="text-xs px-1.5 py-0">
                  {connector.badge}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                {connector.description}
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              rightIcon={<LuExternalLink className="size-3.5" />}
              onClick={() =>
                window.open(
                  connector.installUrl,
                  "_blank",
                  "noopener,noreferrer"
                )
              }
            >
              Install
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
