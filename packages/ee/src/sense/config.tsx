// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { ComponentProps } from "react";
import { z } from "zod";
import { defineIntegration } from "../fns";

const SenseSettingsSchema = z.object({
  // Empty means "keep the existing vaulted secret"; presence enforced at install.
  apiKey: z.string(),
  environment: z.enum(["production", "staging"]).default("production"),
  minimumStateSeconds: z.coerce.number().int().min(0).default(60)
});

export const Sense = defineIntegration({
  name: "Sense",
  id: "sense",
  active: true,
  category: "Machine Monitoring",
  providerRole: "oee" as const,
  logo: Logo,
  setupInstructions: SetupInstructions,
  description:
    "Sense clips a current sensor onto each machine and reports when it runs. Map each Sense station to a work center, and Carbon records machine time on the operation loaded on that work center. Run time with no loaded operation waits on the Unattributed Machine Time list for a supervisor.",
  shortDescription: "Record machine time from Sense machine sensors.",
  images: [],
  settingGroups: [
    {
      name: "Connection",
      description: "API access to your Sense company"
    }
  ],
  settings: [
    {
      name: "apiKey",
      label: "API key",
      description:
        "A company API key from Sense. It gives Carbon read access to your sites and stations.",
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
          description: "bifrost.sensemfg.com"
        },
        {
          value: "staging",
          label: "Staging",
          description: "bifrost-staging.sensemfg.com — testing only, plain HTTP"
        }
      ],
      required: true,
      value: "production"
    },
    {
      name: "minimumStateSeconds",
      label: "Minimum state (seconds)",
      description:
        "A run or a stop shorter than this is ignored, so a brief blip does not split machine time.",
      group: "Connection",
      type: "number" as const,
      required: true,
      value: 60
    }
  ],
  schema: SenseSettingsSchema
});

function SetupInstructions() {
  return (
    <p className="text-sm text-muted-foreground">
      Create a company API key in Sense and paste it below. Then open the
      Devices tab and map each Sense station to the work center it measures.
    </p>
  );
}

// A neutral pulse mark: Sense publishes no logo asset for partners yet.
function Logo(props: ComponentProps<"svg">) {
  return (
    <svg
      {...props}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M3 12h4l3-8 4 16 3-8h4" />
    </svg>
  );
}
