import { Copy, Input, InputGroup, InputRightElement } from "@carbon/react";
import { isBrowser } from "@carbon/utils";
import type { ComponentProps } from "react";
import { z } from "zod";
import { defineIntegration } from "../fns";

const RilletSettingsSchema = z.object({
  apiKey: z.string().min(1, { message: "API key is required" }),
  environment: z.enum(["production", "sandbox"]).default("production"),
  subsidiaryId: z.string().optional(),
  webhookToken: z.string().optional()
});

export const Rillet = defineIntegration({
  name: "Rillet",
  id: "rillet",
  active: true,
  category: "Accounting",
  logo: Logo,
  setupInstructions: SetupInstructions,
  description:
    "Integrating Carbon with Rillet posts your production and inventory journal entries, sales invoices, and bills into Rillet's multi-entity general ledger, keeps customers and vendors in sync, and applies invoice payments recorded in Rillet back to Carbon.",
  shortDescription:
    "Post journals, invoices, and bills to Rillet; pull payments back.",
  images: [],
  settingGroups: [
    {
      name: "Connection",
      description: "API access to your Rillet organization"
    },
    {
      name: "Webhooks",
      description:
        "Lets Rillet notify Carbon when invoice payments are recorded"
    }
  ],
  settings: [
    {
      name: "apiKey",
      label: "API key",
      description:
        "Create one in Rillet under Organization Settings → API access. Keys are environment-specific.",
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
          description: "api.rillet.com"
        },
        {
          value: "sandbox",
          label: "Sandbox",
          description: "sandbox.api.rillet.com"
        }
      ],
      required: true,
      value: "production"
    },
    {
      name: "subsidiaryId",
      label: "Subsidiary ID",
      description:
        "Optional Rillet subsidiary (UUID) that journal entries, invoices, and bills post into. Leave blank for single-entity organizations.",
      group: "Connection",
      type: "text" as const,
      required: false,
      value: ""
    },
    {
      name: "webhookToken",
      label: "Webhook token",
      description:
        "The per-webhook token from step 3. Inbound payments stay off until this is set.",
      group: "Webhooks",
      type: "secret" as const,
      required: false,
      value: ""
    }
  ],
  schema: RilletSettingsSchema
});

function SetupInstructions({ companyId }: { companyId: string }) {
  const webhookUrl = isBrowser
    ? `${window.location.origin}/api/webhook/rillet/${companyId}`
    : "";
  return (
    <>
      <p className="text-sm text-muted-foreground">
        1. Create an API key in Rillet under Organization Settings → API access
        (keys are environment-specific) and paste it below.
      </p>
      <p className="mt-3 text-sm text-muted-foreground">
        2. In Rillet under Settings → External References, add two reference
        types with the slugs <span className="font-mono">carbon</span> and{" "}
        <span className="font-mono">carbon-company</span>. Rillet has no API for
        this step. It is required before invoices can post (Rillet mandates
        external references on AR-only invoices); without it, customers,
        vendors, products, and bills still sync but are not tagged with their
        Carbon ids.
      </p>
      <p className="mt-3 text-sm text-muted-foreground">
        3. To pull invoice payments back into Carbon, create a webhook in Rillet
        under Organization Settings → Webhooks pointed at the URL below,
        subscribed to invoice payment events, and paste its Webhook Token into
        the field at the bottom of this form.
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
      viewBox="0 0 124 27"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      // Rillet's wordmark is a wide 124x27 (~4.6:1). The shared render
      // sites size logos by height (h-10 / h-full), which is right for the
      // square Xero/QBO marks but blows this one out horizontally. Size it
      // by a modest height and clamp width to the container so it stays a
      // balanced wordmark and never overflows the drawer's icon box.
      style={{
        ...props.style,
        height: "1.25rem",
        width: "auto",
        maxWidth: "100%"
      }}
    >
      <path
        d="M0.69312 26.5771V1.44136H8.91611C10.8791 1.44136 12.495 1.7765 13.7637 2.44679C15.0564 3.11708 16.014 4.02675 16.6364 5.17582C17.2827 6.30095 17.6059 7.58167 17.6059 9.018C17.6059 10.6458 17.187 12.0941 16.3491 13.3629C15.5352 14.6077 14.2784 15.5174 12.5788 16.0919L17.8573 26.5771H13.4406L8.62885 16.6306H4.4994V26.5771H0.69312ZM4.4994 13.1834H8.70066C10.4243 13.1834 11.6811 12.8003 12.471 12.0343C13.285 11.2683 13.6919 10.2628 13.6919 9.018C13.6919 7.74925 13.2969 6.74381 12.5069 6.00171C11.717 5.23567 10.4362 4.85265 8.66476 4.85265H4.4994V13.1834ZM29.9443 6.03762C29.1065 6.03762 28.4003 5.77429 27.8257 5.24764C27.2752 4.69704 26.9999 4.02675 26.9999 3.23677C26.9999 2.44679 27.2752 1.78847 27.8257 1.26182C28.4003 0.735163 29.1065 0.471836 29.9443 0.471836C30.8061 0.471836 31.5123 0.735163 32.0629 1.26182C32.6375 1.78847 32.9247 2.44679 32.9247 3.23677C32.9247 4.02675 32.6375 4.69704 32.0629 5.24764C31.5123 5.77429 30.8061 6.03762 29.9443 6.03762ZM22.7986 26.5771V23.2736H28.4003V13.2552C28.4003 12.4652 28.0173 12.0702 27.2512 12.0702H23.3013V8.76665H27.9335C29.4177 8.76665 30.4949 9.11376 31.1652 9.80799C31.8594 10.4783 32.2066 11.5555 32.2066 13.0397V23.2736H37.8082V26.5771H22.7986ZM43.5036 26.5771V23.2736H49.4644V5.21173C49.4644 4.42175 49.0814 4.02676 48.3153 4.02676H44.0063V0.723194H48.9976C50.386 0.723194 51.4394 1.09425 52.1575 1.83635C52.8996 2.55452 53.2707 3.60783 53.2707 4.99628V23.2736H59.2674V26.5771H43.5036ZM65.0346 26.5771V23.2736H70.9953V5.21173C70.9953 4.42175 70.6123 4.02676 69.8463 4.02676H65.5373V0.723194H70.5285C71.917 0.723194 72.9703 1.09425 73.6885 1.83635C74.4306 2.55452 74.8016 3.60783 74.8016 4.99628V23.2736H80.7983V26.5771H65.0346ZM95.1117 27.008C93.3881 27.008 91.868 26.625 90.5513 25.859C89.2347 25.069 88.2053 23.9798 87.4632 22.5913C86.7211 21.2029 86.35 19.587 86.35 17.7437C86.35 15.8765 86.7091 14.2367 87.4273 12.8243C88.1694 11.4119 89.1988 10.3107 90.5154 9.52072C91.856 8.73074 93.4 8.33575 95.1476 8.33575C96.8712 8.33575 98.3554 8.73074 99.6002 9.52072C100.845 10.2868 101.803 11.3161 102.473 12.6088C103.167 13.9015 103.514 15.3259 103.514 16.8819C103.514 17.1213 103.514 17.3846 103.514 17.6719C103.514 17.9352 103.502 18.2345 103.478 18.5696H90.0845C90.2042 20.2214 90.7428 21.4782 91.7004 22.34C92.6579 23.1778 93.7831 23.5968 95.0758 23.5968C96.2009 23.5968 97.0866 23.3693 97.733 22.9145C98.4033 22.4357 98.894 21.7894 99.2052 20.9755H103.047C102.616 22.6751 101.719 24.1114 100.354 25.2845C98.9898 26.4335 97.2422 27.008 95.1117 27.008ZM95.1117 11.6393C93.9387 11.6393 92.8973 11.9984 91.9876 12.7166C91.078 13.4108 90.4915 14.3923 90.2281 15.661H99.7079C99.6122 14.4641 99.1454 13.4946 98.3075 12.7525C97.4696 12.0104 96.4044 11.6393 95.1117 11.6393ZM118.366 26.5771C116.619 26.5771 115.23 26.1582 114.201 25.3204C113.171 24.4586 112.657 22.9384 112.657 20.76V11.9984H108.168V8.76665H110.825C112.046 8.76665 112.765 8.16818 112.98 6.97123L113.519 4.09857H116.463V8.76665H123.501V11.9984H116.463V20.6882C116.463 21.6218 116.667 22.2801 117.073 22.6631C117.504 23.0222 118.235 23.2018 119.264 23.2018H123.429V26.5771H118.366Z"
        fill="currentColor"
      ></path>
    </svg>
  );
}
