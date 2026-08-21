import { Copy, Input, InputGroup, InputRightElement } from "@carbon/react";
import { isBrowser } from "@carbon/utils";
import type { ComponentProps } from "react";
import { z } from "zod";
import { defineIntegration } from "../fns";

/**
 * Ramp settings form schema. The credentials (clientId/clientSecret/
 * environment) are entered flat here and folded into `metadata.credentials`
 * by the settings route; the account-mapping and sync-toggle fields stay flat
 * at the metadata root. `clientSecret` is optional so an empty submit means
 * "keep the existing vaulted secret" (D4a anti-overwrite in splitSecrets).
 */
const RampSettingsSchema = z.object({
  clientId: z.string().min(1),
  // Empty means "keep the existing vaulted secret"; presence enforced at install.
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
      label: "Client ID",
      description:
        "Create an API client in Ramp under Settings → Developer API and paste its Client ID here.",
      group: "Connection",
      type: "text" as const,
      required: true,
      value: ""
    },
    {
      name: "clientSecret",
      label: "Client secret",
      description:
        "The Client Secret paired with the Client ID above. Leave blank to keep the stored secret.",
      group: "Connection",
      type: "secret" as const,
      required: true,
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
  const webhookUrl = isBrowser
    ? `${window.location.origin}/api/webhook/ramp/${companyId}`
    : "";
  return (
    <>
      <p className="text-sm text-muted-foreground">
        1. In Ramp under Settings → Developer API, create an API client with the
        accounting, transactions, bills, reimbursements, and vendors scopes.
        Paste its Client ID and Client Secret below and choose the matching
        environment.
      </p>
      <p className="mt-3 text-sm text-muted-foreground">
        2. Map the GL accounts under Accounts so card charges, statement
        payments, cashback, and reimbursements post to the right places.
      </p>
      <p className="mt-3 text-sm text-muted-foreground">
        3. Ramp notifies Carbon of new activity through a webhook pointed at the
        URL below. It is registered automatically when you connect.
      </p>
      <InputGroup className="mb-8">
        <Input value={webhookUrl} />
        <InputRightElement>
          <Copy text={webhookUrl} />
        </InputRightElement>
      </InputGroup>
    </>
  );
}

function Logo(props: ComponentProps<"svg">) {
  return (
    <svg
      {...props}
      viewBox="0 0 48 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      // A simple text-free "ramp" mark: an ascending wedge. The shared render
      // sites size logos by height; clamp to a modest height and let the width
      // follow so it never overflows the drawer's icon box.
      style={{
        ...props.style,
        height: "1.25rem",
        width: "auto",
        maxWidth: "100%"
      }}
    >
      <path
        d="M2 22L46 22L46 16L14 16L14 2L2 2L2 22Z"
        fill="currentColor"
        fillOpacity="0.9"
      />
      <path d="M18 22L46 2L46 22L18 22Z" fill="currentColor" />
    </svg>
  );
}
