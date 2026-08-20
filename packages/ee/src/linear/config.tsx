import { Copy, Input, InputGroup, InputRightElement } from "@carbon/react";
import { isBrowser } from "@carbon/utils";
import type { SVGProps } from "react";
import { z } from "zod";
import { defineIntegration } from "../fns";
export const Linear = defineIntegration({
  name: "Linear",
  id: "linear",
  active: true,
  category: "Project Management",
  logo: Logo,
  description:
    "Linear is a project management software that allows you to create issues and track project progress seamlessly. With this integration, you can link issues and change notices from Carbon to Linear.",
  shortDescription: "Sync issues and change notices from Carbon to Linear.",
  setupInstructions: SetupInstructions,
  images: [],
  settings: [
    {
      name: "apiKey",
      label: "API Key",
      type: "secret",
      required: true,
      value: ""
    }
  ],
  schema: z.object({
    // Empty means "keep the existing vaulted secret" (the field loads masked and
    // is not sent to the browser). Presence is enforced at install-time in the
    // settings action; a non-empty value must still be a valid Linear key.
    apiKey: z
      .string()
      .refine((val) => val === "" || val.startsWith("lin_api"), {
        message: "Linear API Key must start with 'lin_api'"
      })
  })
});

function SetupInstructions({ companyId }: { companyId: string }) {
  const webhookUrl = isBrowser
    ? `${window.location.origin}/api/webhook/${Linear.id}/${companyId}`
    : "";

  return (
    <>
      <p className="text-sm text-muted-foreground">
        To integrate Linear with Carbon, start by logging into your Linear
        account and navigating to the API settings page.
      </p>
      <p className="text-sm text-muted-foreground">
        Under the "Webhooks" section, click on "New Webhook" and give it a
        descriptive label.
      </p>
      <p className="text-sm text-muted-foreground">
        Copy the webhook URL provided below into the "URL" field.
      </p>
      <InputGroup className="mb-8">
        <Input value={webhookUrl} />
        <InputRightElement>
          <Copy text={webhookUrl} />
        </InputRightElement>
      </InputGroup>

      <p className="text-sm text-muted-foreground">
        Next, from the sidebar go to "Security and access" page and generate a
        new API key. Copy the generated API key and paste it into the "API Key"
        field below.
      </p>
    </>
  );
}

export function Logo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      width={200}
      height={200}
      viewBox="0 0 100 100"
      {...props}
    >
      <path
        fill="currentColor"
        d="M1.225 61.523c-.222-.949.908-1.546 1.597-.857l36.512 36.512c.69.69.092 1.82-.857 1.597-18.425-4.323-32.93-18.827-37.252-37.252M.002 46.889a1 1 0 0 0 .29.76L52.35 99.71c.201.2.478.307.76.29 2.37-.149 4.695-.46 6.963-.927.765-.157 1.03-1.096.478-1.648L2.576 39.448c-.552-.551-1.491-.286-1.648.479a50 50 0 0 0-.926 6.962M4.21 29.705a.99.99 0 0 0 .208 1.1l64.776 64.776a.99.99 0 0 0 1.1.208 50 50 0 0 0 5.185-2.684.98.98 0 0 0 .183-1.54L8.436 24.336a.98.98 0 0 0-1.541.183 50 50 0 0 0-2.684 5.185m8.448-11.631a.986.986 0 0 1-.045-1.354C21.78 6.46 35.111 0 49.952 0 77.592 0 100 22.407 100 50.048c0 14.84-6.46 28.172-16.72 37.338a.986.986 0 0 1-1.354-.045z"
      />
    </svg>
  );
}
