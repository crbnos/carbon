import { RAMP_CLIENT_ID } from "@carbon/auth";
import { Copy, Input, InputGroup, InputRightElement } from "@carbon/react";
import { isBrowser } from "@carbon/utils";
import type { ComponentProps } from "react";
import { z } from "zod";
import { defineIntegration } from "../fns";

/**
 * OAuth "Connect to Ramp" authorization-code flow (production). Declared inline
 * (not imported from `./lib/client`, which pulls `node:crypto` into the
 * client bundle). Sandbox / self-hosted use the client-credentials fields below.
 * `offline_access` requests a refresh token; the app must have the Refresh Token
 * grant enabled. IntegrationCard builds the authorize redirect from this block.
 */
const RAMP_AUTHORIZE_URL = "https://api.ramp.com/v1/authorize";
const RAMP_TOKEN_URL = "https://api.ramp.com/developer/v1/token";
const RAMP_OAUTH_SCOPES = [
  "accounting:read",
  "accounting:write",
  "transactions:read",
  "bills:read",
  "bills:write",
  "vendors:read",
  "vendors:write",
  "reimbursements:read",
  "purchase_orders:read",
  "purchase_orders:write",
  "transfers:read",
  "statements:read",
  "cashbacks:read",
  "receipts:read",
  "entities:read",
  "business:read",
  "offline_access"
];

/**
 * Ramp settings form schema. The credentials (clientId/clientSecret/
 * environment) are entered flat here and folded into `metadata.credentials`
 * by the settings route; the account-mapping and sync-toggle fields stay flat
 * at the metadata root. `clientSecret` is optional so an empty submit means
 * "keep the existing vaulted secret" (D4a anti-overwrite in splitSecrets).
 */
const RampSettingsSchema = z.object({
  // Optional: OAuth-connected installs get their credentials from the Connect
  // flow, so the client-credentials fields are only for the advanced /
  // self-hosted / sandbox path. The install hook's `getBusiness()` is the real
  // credential gate. Empty clientSecret means "keep the existing vaulted secret".
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  environment: z.enum(["production", "sandbox"]).default("production"),
  entityId: z.string().optional(),
  // Required non-empty (the card liability + statement bank accounts back every
  // card journal); populated by the loader's dynamicOptions.
  cardLiabilityAccountId: z.string().min(1),
  statementBankAccountId: z.string().min(1),
  cashbackIncomeAccountId: z.string().optional(),
  reimbursementBankAccountId: z.string().optional(),
  // SwitchField posts a literal "true"/"false" string; stored flat as-is.
  pullTransactions: z.string().optional(),
  pullBills: z.string().optional(),
  pullReimbursements: z.string().optional(),
  pushPurchaseOrders: z.string().optional(),
  pushInvoices: z.string().optional()
});

export const Ramp = defineIntegration({
  name: "Ramp",
  id: "ramp",
  active: true,
  category: "Spend Management",
  logo: Logo,
  setupInstructions: SetupInstructions,
  description:
    "Integrating Carbon with Ramp pulls your card transactions, bills, and employee reimbursements into Carbon's general ledger, pushes your chart of accounts and cost centers to Ramp for coding, and keeps purchase orders and vendor bills in sync.",
  shortDescription:
    "Pull card transactions, bills, and reimbursements; push your chart of accounts.",
  images: [],
  // One-click "Connect to Ramp" (production OAuth). When present, Install opens
  // this authorize URL; the callback (`/api/integrations/ramp/oauth`) exchanges
  // the code, and account mapping happens afterwards in the Details drawer.
  oauth: {
    authUrl: RAMP_AUTHORIZE_URL,
    clientId: RAMP_CLIENT_ID ?? "",
    redirectUri: "/api/integrations/ramp/oauth",
    scopes: RAMP_OAUTH_SCOPES,
    tokenUrl: RAMP_TOKEN_URL
  },
  settingGroups: [
    {
      name: "Connection",
      description: "API access to your Ramp business"
    },
    {
      name: "Accounts",
      description: "GL accounts Ramp activity posts against"
    },
    {
      name: "Sync",
      description: "Which Ramp data flows into and out of Carbon"
    }
  ],
  settings: [
    {
      name: "clientId",
      label: "Client ID (advanced)",
      description:
        "Optional — most customers connect via the Connect to Ramp button. For a self-hosted or sandbox client-credentials setup, create an API client in Ramp under Settings → Developer API and paste its Client ID here.",
      group: "Connection",
      type: "text" as const,
      required: false,
      value: ""
    },
    {
      name: "clientSecret",
      label: "Client secret (advanced)",
      description:
        "The Client Secret paired with the Client ID above. Leave blank to keep the stored secret.",
      group: "Connection",
      type: "secret" as const,
      required: false,
      value: ""
    },
    {
      name: "environment",
      label: "Environment",
      group: "Connection",
      type: "options" as const,
      listOptions: [
        {
          value: "production",
          label: "Production",
          description: "api.ramp.com"
        },
        {
          value: "sandbox",
          label: "Sandbox",
          description: "demo-api.ramp.com"
        }
      ],
      required: true,
      value: "production"
    },
    {
      name: "entityId",
      label: "Entity ID",
      description: "Limit sync to one Ramp entity (leave blank for all)",
      group: "Connection",
      type: "text" as const,
      required: false,
      value: ""
    },
    {
      name: "cardLiabilityAccountId",
      label: "Card liability account",
      description:
        "The liability account Ramp card charges credit (your Ramp card balance).",
      group: "Accounts",
      type: "options" as const,
      listOptions: [],
      required: true,
      value: ""
    },
    {
      name: "statementBankAccountId",
      label: "Statement bank account",
      description:
        "The bank/asset account statement payments and transfers draw from.",
      group: "Accounts",
      type: "options" as const,
      listOptions: [],
      required: true,
      value: ""
    },
    {
      name: "cashbackIncomeAccountId",
      label: "Cashback income account",
      description:
        "The revenue account Ramp cashback posts to. Leave blank to skip cashback sync.",
      group: "Accounts",
      type: "options" as const,
      listOptions: [],
      required: false,
      value: ""
    },
    {
      name: "reimbursementBankAccountId",
      label: "Reimbursement bank account",
      description:
        "The bank/asset account employee reimbursements are paid from. Defaults to the statement bank account.",
      group: "Accounts",
      type: "options" as const,
      listOptions: [],
      required: false,
      value: ""
    },
    {
      name: "pullTransactions",
      label: "Card transactions",
      description: "Pull Ramp card transactions into Carbon.",
      group: "Sync",
      type: "switch" as const,
      required: false,
      value: "true"
    },
    {
      name: "pullBills",
      label: "Bills",
      description: "Pull Ramp bills into Carbon as purchase invoices.",
      group: "Sync",
      type: "switch" as const,
      required: false,
      value: "true"
    },
    {
      name: "pullReimbursements",
      label: "Reimbursements",
      description: "Pull Ramp employee reimbursements into Carbon.",
      group: "Sync",
      type: "switch" as const,
      required: false,
      value: "true"
    },
    {
      name: "pushPurchaseOrders",
      label: "Purchase orders",
      description: "Push Carbon purchase orders to Ramp.",
      group: "Sync",
      type: "switch" as const,
      required: false,
      value: "true"
    },
    {
      name: "pushInvoices",
      label: "Invoices",
      description: "Push Carbon invoices to Ramp as draft bills.",
      group: "Sync",
      type: "switch" as const,
      required: false,
      value: "true"
    }
  ],
  schema: RampSettingsSchema
});

function SetupInstructions({ companyId }: { companyId: string }) {
  const origin = isBrowser ? window.location.origin : "";
  const webhookUrl = origin ? `${origin}/api/webhook/ramp/${companyId}` : "";
  return (
    <div className="text-sm text-muted-foreground">
      <ol className="list-decimal space-y-3 pl-4">
        <li>
          <span className="font-medium text-foreground">
            Create a Ramp API client.
          </span>{" "}
          In Ramp go to Settings → Developer API → Create app and choose the{" "}
          <span className="font-medium">
            server-to-server (client credentials)
          </span>{" "}
          grant. Under Set scopes, enable the accounting, transactions, bills,
          reimbursements, transfers, cashbacks, receipts, statements, entities,
          vendors, purchase-orders, and business scopes (read, plus write for
          accounting, bills, vendors, and purchase orders) — the simplest is to
          use <span className="font-medium">Enable all</span>.
        </li>
        <li>
          <span className="font-medium text-foreground">
            Connect the client.
          </span>{" "}
          Paste the Client ID and Client Secret into the fields below and set{" "}
          <span className="font-medium">Environment</span> to match your Ramp
          app (Sandbox → demo-api.ramp.com, Production → api.ramp.com). Carbon
          connects <span className="font-medium">server-to-server</span> (client
          credentials), so Ramp's{" "}
          <span className="font-medium">Redirect URI</span> isn't used — leave
          it blank, or set it to this Carbon URL if the form requires a value.
          If Ramp asks for <span className="font-medium">Allowed origins</span>{" "}
          or to verify a domain, use this Carbon URL.
        </li>
        <li>
          <span className="font-medium text-foreground">
            Map the GL accounts
          </span>{" "}
          under Accounts so card charges, statement payments, cashback, and
          reimbursements post to the right places.
        </li>
        <li>
          <span className="font-medium text-foreground">
            Webhook (registered automatically).
          </span>{" "}
          On connect, Carbon registers the endpoint below with Ramp so new
          activity syncs in near-real-time. Ramp must be able to reach it over
          the public internet — for local development, expose Carbon with a
          tunnel (e.g. ngrok) and point your app URL at that tunnel. If the URL
          isn't publicly reachable, the hourly sync still keeps everything up to
          date.
        </li>
      </ol>
      <InputGroup className="mb-8 mt-4">
        <Input value={webhookUrl} readOnly />
        <InputRightElement>
          <Copy text={webhookUrl} />
        </InputRightElement>
      </InputGroup>
    </div>
  );
}

function Logo(props: ComponentProps<"svg">) {
  return (
    <svg
      {...props}
      viewBox="0 0 75 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      // The official Ramp wordmark. The shared render sites size logos by
      // height; clamp to a modest height and let the width follow so it never
      // overflows the drawer's icon box. `currentColor` keeps it theme-aware.
      style={{
        ...props.style,
        height: "1.25rem",
        width: "auto",
        maxWidth: "100%"
      }}
    >
      <g clipPath="url(#ramp-logo-clip)" fill="currentColor">
        <path d="M5.19 6.76c-1.79 0-2.667 1.576-2.667 3.681v5.275H0V4.585h2.478v2.888h.043c.53-1.776 1.585-3.21 3.212-3.21 1.144 0 1.627.399 1.627.399L6.22 6.955c0-.002-.363-.195-1.031-.195Zm30.496 1.528v7.427h-2.458V9.192c0-1.872-.587-2.864-2.088-2.864-1.553 0-2.305 1.254-2.305 3.66v5.726H26.4V9.192c0-1.8-.58-2.864-2.066-2.864-1.695 0-2.348 1.486-2.348 3.66v5.726h-2.478V4.584h2.478v2.521h.022c.386-1.744 1.44-2.82 3.218-2.82 1.764 0 2.913.947 3.349 2.627.415-1.617 1.52-2.628 3.218-2.628 2.37 0 3.893 1.486 3.893 4.004ZM12.318 4.262c-2.28 0-3.773 1.071-4.453 3.005l2.099.763c.382-1.166 1.18-1.83 2.398-1.83 1.37 0 2.175.603 2.175 1.528 0 .947-.64 1.145-2.088 1.379-1.61.259-5.437.344-5.437 3.573 0 1.892 1.582 3.315 3.958 3.315 1.786 0 3.003-.73 3.566-2.089h.022v1.81h2.457V8.868c0-2.995-1.508-4.607-4.697-4.607Zm2.283 6.214c0 2.334-1.155 3.833-3 3.833-1.306 0-2.088-.732-2.088-1.788 0-.99.804-1.678 2.348-1.961 1.58-.29 2.375-.648 2.74-1.507v1.423Zm29.826-6.192c-1.88 0-3.121 1.033-3.653 2.585V4.585h-2.61V20h2.588v-6.568h.022c.576 1.681 1.775 2.606 3.653 2.606 2.979 0 5.11-2.454 5.11-5.921 0-3.443-2.131-5.833-5.11-5.833Zm-.642 9.688c-2.063 0-3.207-1.497-3.207-3.822s1.28-3.822 3.207-3.822c1.926 0 3.208 1.57 3.208 3.822 0 2.253-1.28 3.822-3.208 3.822ZM75.172 15.665v.07l-10.1.003v-.073c1.457-.823 2.462-1.66 3.367-2.536h4.147l2.586 2.536ZM72.67 2.51 70.11 0h-.075s.043 4.68-4.255 8.936c-4.206 4.166-9.152 4.175-9.152 4.175v.073l2.608 2.555s4.874.048 9.18-4.175c4.29-4.21 4.254-9.053 4.254-9.053Z" />
      </g>
      <defs>
        <clipPath id="ramp-logo-clip">
          <path fill="#fff" d="M0 0h75v20H0z" />
        </clipPath>
      </defs>
    </svg>
  );
}
