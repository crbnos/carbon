import { Trans } from "@lingui/react/macro";
import { LuKeyRound } from "react-icons/lu";
import {
  UpgradeOverlay,
  UpgradeOverlayActions,
  UpgradeOverlayCard,
  UpgradeOverlayContent,
  UpgradeOverlayDescription,
  UpgradeOverlayIcon,
  UpgradeOverlayPreview,
  UpgradeOverlayTitle,
  UpgradeOverlayUpgradeButton
} from "~/components/UpgradeOverlay";
import type { ApiKey } from "~/modules/settings";
import ApiKeysTable from "./ApiKeysTable";

const mockApiKeys: ApiKey[] = [
  {
    id: "mock-1",
    name: "Production",
    keyHash: "",
    keyPreview: "a1b2",
    scopes: {
      sales: ["read", "write"],
      purchasing: ["read"],
      inventory: ["read", "write"],
      production: ["read"]
    } as any,
    rateLimit: 60,
    rateLimitWindow: "1m",
    expiresAt: null,
    lastUsedAt: new Date().toISOString(),
    createdAt: "2026-01-15T10:00:00Z",
    createdBy: "mock-user-1",
    updatedBy: null,
    companyId: "mock"
  },
  {
    id: "mock-2",
    name: "Staging",
    keyHash: "",
    keyPreview: "9c4e",
    scopes: {
      sales: ["read"],
      inventory: ["read"]
    } as any,
    rateLimit: 60,
    rateLimitWindow: "1m",
    expiresAt: "2026-12-31T23:59:59Z",
    lastUsedAt: "2026-04-30T15:22:00Z",
    createdAt: "2026-02-01T09:30:00Z",
    createdBy: "mock-user-1",
    updatedBy: null,
    companyId: "mock"
  },
  {
    id: "mock-3",
    name: "CI Pipeline",
    keyHash: "",
    keyPreview: "f0a1",
    scopes: {
      production: ["read"]
    } as any,
    rateLimit: 30,
    rateLimitWindow: "1m",
    expiresAt: null,
    lastUsedAt: "2026-05-05T08:10:00Z",
    createdAt: "2026-02-10T11:45:00Z",
    createdBy: "mock-user-2",
    updatedBy: null,
    companyId: "mock"
  },
  {
    id: "mock-4",
    name: "Reporting",
    keyHash: "",
    keyPreview: "7d2b",
    scopes: {
      sales: ["read"],
      purchasing: ["read"]
    } as any,
    rateLimit: 10,
    rateLimitWindow: "1m",
    expiresAt: "2026-06-15T00:00:00Z",
    lastUsedAt: null,
    createdAt: "2026-03-20T14:00:00Z",
    createdBy: "mock-user-2",
    updatedBy: null,
    companyId: "mock"
  }
];

export default function ApiKeysUpgradeOverlay() {
  return (
    <UpgradeOverlay>
      <UpgradeOverlayPreview>
        <ApiKeysTable data={mockApiKeys} count={mockApiKeys.length} />
      </UpgradeOverlayPreview>
      <UpgradeOverlayCard>
        <UpgradeOverlayIcon>
          <LuKeyRound className="size-6 text-muted-foreground" />
        </UpgradeOverlayIcon>
        <UpgradeOverlayContent>
          <UpgradeOverlayTitle>
            <Trans>API Keys</Trans>
          </UpgradeOverlayTitle>
          <UpgradeOverlayDescription>
            <Trans>API keys for programmatic access to your Carbon data.</Trans>
          </UpgradeOverlayDescription>
        </UpgradeOverlayContent>
        <UpgradeOverlayActions>
          <UpgradeOverlayUpgradeButton />
        </UpgradeOverlayActions>
      </UpgradeOverlayCard>
    </UpgradeOverlay>
  );
}
