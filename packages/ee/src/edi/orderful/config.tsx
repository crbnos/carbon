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
      width={136}
      height={21}
      viewBox="0 0 136 21"
      fill="none"
      {...props}
    >
      <path
        fill="currentColor"
        d="M136 8.73855L128.709 8.18818L131.819 1.49387L129.264 0L125.308 6.02039L121.357 0L118.796 1.49387L121.906 8.18818L114.615 8.73855V11.7488L121.802 12.2935L118.687 18.9934L121.242 20.4817L125.308 14.2928L129.374 20.4817L131.934 18.9934L128.813 12.2935L136 11.7488V8.73855Z"
      />
      <path
        fill="currentColor"
        d="M10.2458 21C2.80228 21 0 16.1674 0 10.7782C0 5.47699 2.80228 0.527197 10.2458 0.527197C17.6894 0.527197 20.4625 5.50628 20.4625 10.7782C20.4625 16.1381 17.6894 21 10.2458 21ZM4.64127 10.7782C4.64127 15.0251 5.98403 17.3389 10.2458 17.3389C14.5076 17.3389 15.8504 15.0251 15.8504 10.7782C15.8504 6.4728 14.5076 4.159 10.2458 4.159C5.98403 4.159 4.64127 6.4728 4.64127 10.7782Z"
      />
      <path
        fill="currentColor"
        d="M30.423 5.62343H31.3863V9.841H29.956C27.0661 9.841 26.0736 11.4226 26.0736 14.7322V20.5021H21.7535V5.85774H25.9569V8.99163C26.6575 6.91213 27.971 5.62343 30.423 5.62343Z"
      />
      <path
        fill="currentColor"
        d="M44.1831 0H48.5033V20.5021H44.1831V18.3347C43.1614 20.0042 41.4684 20.9707 38.958 20.9707C34.2 20.9707 32.2442 17.3975 32.2442 13.1506C32.2442 8.99163 34.2 5.38912 38.958 5.38912C41.4684 5.38912 43.1614 6.38494 44.1831 8.05439V0ZM40.3008 17.5732C43.0155 17.5732 44.1831 16.1674 44.1831 13.1799C44.1831 10.1925 43.0155 8.78661 40.3008 8.78661C37.5569 8.78661 36.5644 10.1339 36.5644 13.1799C36.5644 16.1967 37.5569 17.5732 40.3008 17.5732Z"
      />
      <path
        fill="currentColor"
        d="M57.8374 17.9833C59.7347 17.9833 60.7272 17.1632 61.1359 16.0795H65.2809C64.8722 18.4226 63.0041 20.9707 57.7498 20.9707C52.0577 20.9707 49.8976 17.2803 49.8976 13.1506C49.8976 8.90377 52.3496 5.38912 57.7498 5.38912C63.2668 5.38912 65.3101 8.99163 65.3101 13.1213C65.3101 13.5607 65.3101 13.9707 65.2517 14.2929H54.1302C54.3929 17.0753 55.7648 17.9833 57.8374 17.9833ZM57.8082 8.31799C55.7357 8.31799 54.5097 9.16736 54.1594 11.6569H61.1943C61.0483 9.43096 59.9683 8.31799 57.8082 8.31799Z"
      />
      <path
        fill="currentColor"
        d="M75.4937 5.62343H76.457V9.841H75.0266C72.1368 9.841 71.1443 11.4226 71.1443 14.7322V20.5021H66.8241V5.85774H71.0275V8.99163C71.7281 6.91213 73.0417 5.62343 75.4937 5.62343Z"
      />
      <path
        fill="currentColor"
        d="M80.0289 20.5021V9.13808H77.431V7.05858L80.0289 5.79916V4.45188C80.0289 1.69875 81.4009 0 85.0205 0H88.7568V3.13389H83.7361V5.85774H87.9687V9.13808H84.3491V20.5021H80.0289Z"
      />
      <path
        fill="currentColor"
        d="M100.031 5.85774H104.351V20.5021H100.031V17.6904C99.126 19.6527 97.4914 20.9707 94.8643 20.9707C91.0403 20.9707 89.3473 18.6569 89.3473 14.8201V5.85774H93.6674V14.1757C93.6674 16.4895 94.6891 17.4268 96.5281 17.4268C98.6882 17.4268 100.031 15.8159 100.031 12.5063V5.85774Z"
      />
      <path
        fill="currentColor"
        d="M105.987 20.5021V0H110.307V20.5021H105.987Z"
      />
    </svg>
  );
}
