import { Copy, cn, Input, InputGroup, InputRightElement } from "@carbon/react";
import { isBrowser } from "@carbon/utils";
import type { SVGProps } from "react";
import { z } from "zod";
import { defineIntegration } from "../fns";

export const McMasterCarr = defineIntegration({
  name: "McMaster-Carr",
  id: "mcmaster-carr",
  active: true,
  category: "Purchasing",
  logo: Logo,
  description:
    "Shop McMaster-Carr's catalog directly from Carbon with your account pricing, return your cart as a draft purchase order, and exchange cXML documents (purchase orders, order confirmations, ship notices, and invoices) server-to-server. Confirmations update promised dates automatically, ship notices attach tracking numbers, and invoices are staged for review.",
  shortDescription:
    "Punchout catalog and cXML purchase orders, confirmations, ship notices, and invoices.",
  setupInstructions: SetupInstructions,
  images: [],

  settings: [
    {
      name: "supplierId",
      label: "Supplier",
      type: "supplier",
      required: true,
      value: "",
      description: "Which Carbon supplier is McMaster-Carr."
    },
    {
      name: "environment",
      label: "Environment",
      type: "options",
      listOptions: ["Test", "Production"],
      required: true,
      value: "Test"
    },
    {
      name: "punchoutUrl",
      label: "Punchout URL",
      type: "text",
      required: true,
      value: "",
      description:
        "The PunchOutSetupRequest endpoint from your onboarding packet."
    },
    {
      name: "orderUrlTest",
      label: "Order URL (Test)",
      type: "text",
      required: true,
      value: ""
    },
    {
      name: "orderUrlProduction",
      label: "Order URL (Production)",
      type: "text",
      required: false,
      value: ""
    },
    {
      name: "fromIdentity",
      label: "From/Sender Identity (NetworkID)",
      type: "text",
      required: true,
      value: ""
    },
    {
      name: "fromDomain",
      label: "From/Sender Domain",
      type: "text",
      required: true,
      value: "NetworkID"
    },
    {
      name: "toIdentity",
      label: "To Identity",
      type: "text",
      required: true,
      value: "006931349"
    },
    {
      name: "toDomain",
      label: "To Domain",
      type: "text",
      required: true,
      value: "DUNS"
    },
    {
      name: "sharedSecret",
      label: "Shared Secret",
      type: "secret",
      required: true,
      value: "",
      description: "Outbound credential (POSR + OrderRequest)."
    },
    {
      name: "inboundSharedSecret",
      label: "Inbound Shared Secret",
      type: "secret",
      required: true,
      value: "",
      description: "Verifies documents McMaster posts back to Carbon."
    },
    {
      name: "defaultExpenseAccountId",
      label: "Default expense account for unmatched items",
      type: "account",
      required: true,
      value: ""
    }
  ],
  schema: z.object({
    supplierId: z.string(),
    environment: z.enum(["Test", "Production"]),
    punchoutUrl: z.string(),
    orderUrlTest: z.string(),
    orderUrlProduction: z.string().optional(),
    fromIdentity: z.string(),
    fromDomain: z.string(),
    toIdentity: z.string(),
    toDomain: z.string(),
    // Empty means "keep the existing vaulted secret" (see splitSecrets).
    sharedSecret: z.string(),
    inboundSharedSecret: z.string(),
    defaultExpenseAccountId: z.string()
  })
});

function SetupInstructions({ companyId }: { companyId: string }) {
  const webhookUrl = isBrowser
    ? `${window.location.origin}/api/webhook/mcmaster-carr/${companyId}`
    : "";
  const origin = isBrowser ? window.location.origin : "";
  return (
    <>
      <p className="text-sm text-muted-foreground">
        McMaster-Carr provisions punchout during a ~30-day onboarding. Email{" "}
        <span className="font-medium">eProcurement@mcmaster.com</span> from the
        account holder with your McMaster account number to start. They issue
        separate punchout and order-posting URLs plus your shared secrets — note
        that enabling punchout changes your payment options (credit card vs AP
        billing), so confirm the payment model with your rep.
      </p>
      <p className="text-sm text-muted-foreground mt-4">
        Give McMaster this webhook URL for order confirmations, ship notices,
        and invoices:
      </p>
      <InputGroup className="mb-4">
        <Input value={webhookUrl} />
        <InputRightElement>
          <Copy text={webhookUrl} />
        </InputRightElement>
      </InputGroup>
      <p className="text-sm text-muted-foreground">
        The punchout return posts come back to this origin
        {origin ? ` (${origin})` : ""} — allow-list it as your BrowserFormPost
        origin.
      </p>
      <p className="text-sm text-muted-foreground mt-4">
        <span className="font-medium">Heads up:</span> McMaster ships the same
        or next day. Cancelling a purchase order in Carbon does not cancel the
        order with McMaster — call them to cancel.
      </p>
    </>
  );
}

export function Logo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="300"
      height="40"
      viewBox="0 0 300 40"
      fill="none"
      className={cn("text-foreground", props.className)}
    >
      <text
        x="0"
        y="30"
        fill="currentColor"
        fontSize="32"
        fontWeight="700"
        fontFamily="Georgia, 'Times New Roman', serif"
      >
        McMaster-Carr
      </text>
    </svg>
  );
}
