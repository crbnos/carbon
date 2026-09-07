import { Copy, Input, InputGroup, InputRightElement } from "@carbon/react";
import { isBrowser } from "@carbon/utils";
import { z } from "zod";
import { defineIntegration } from "../fns";
import { pieceLogo } from "../integrations/piece-logo";
export const Linear = defineIntegration({
  name: "Linear",
  id: "linear",
  active: true,
  category: "Project Management",
  logo: pieceLogo("linear"),
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
