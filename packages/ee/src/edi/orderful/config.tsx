import { Copy, Input, InputGroup, InputRightElement } from "@carbon/react";
import { isBrowser } from "@carbon/utils";
import type { SVGProps } from "react";
import { z } from "zod";
import { defineIntegration } from "../../fns";

export const Orderful = defineIntegration({
  name: "Orderful",
  id: "orderful",
  active: true,
  category: "EDI",
  logo: Logo,
  description:
    "Orderful is an API-first EDI network. Carbon owns your trading-partner records, the document review queue, and ASN generation from real shipments; Orderful translates X12, validates against partner implementation guides, manages envelopes/control numbers and 997s, and handles AS2/SFTP/VAN connectivity.",
  shortDescription: "Exchange EDI orders, acknowledgments, ASNs, and invoices.",
  setupInstructions: SetupInstructions,
  images: [],
  settings: [
    {
      name: "apiKey",
      label: "API Key",
      type: "password",
      required: true,
      value: ""
    },
    {
      name: "webhookSecret",
      label: "Webhook Secret",
      type: "password",
      required: true,
      value: ""
    },
    {
      name: "environment",
      label: "Environment",
      type: "options",
      listOptions: ["sandbox", "production"],
      required: false,
      value: "sandbox"
    }
  ],
  schema: z.object({
    // Empty means "keep the existing vaulted secret" (the field loads masked and
    // is not sent to the browser). Presence is enforced at install-time in the
    // settings action (FORM_SECRET_INTEGRATIONS).
    apiKey: z.string(),
    webhookSecret: z.string(),
    environment: z.enum(["sandbox", "production"]).optional()
  })
});

function SetupInstructions({ companyId }: { companyId: string }) {
  const webhookUrl = isBrowser
    ? `${window.location.origin}/api/webhook/edi/${companyId}`
    : "";

  return (
    <>
      <p className="text-sm text-muted-foreground">
        To connect Orderful, create a webhook in your Orderful account that
        delivers inbound transactions and acknowledgments to the URL below.
      </p>
      <InputGroup className="mb-8">
        <Input value={webhookUrl} />
        <InputRightElement>
          <Copy text={webhookUrl} />
        </InputRightElement>
      </InputGroup>

      <p className="text-sm text-muted-foreground">
        Then generate an API key and a webhook signing secret in Orderful and
        paste them into the fields below. Keep the environment on "sandbox"
        until your trading partners are certified.
      </p>
    </>
  );
}

export function Logo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={200}
      height={200}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M4 7h13l-4-4" />
      <path d="M20 17H7l4 4" />
    </svg>
  );
}
