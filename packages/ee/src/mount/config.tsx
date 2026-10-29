// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { ComponentProps } from "react";
import { z } from "zod";
import { defineIntegration } from "../fns";
import {
  MOUNT_DEFAULT_BASE_URL,
  MOUNT_PUBLISH_ACTION_IDS
} from "./lib/constants";

const MountSettingsSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string(),
  // Empty means Mount's own API: the client falls back to the default.
  baseUrl: z
    .literal("")
    .or(
      z
        .string()
        .url()
        .startsWith("https://", { message: "Must be an HTTPS URL" })
    )
    .optional(),
  tenant: z.string().min(1),
  scope: z.string().optional(),
  partDefinitionSlug: z.string().min(1),
  customerTypeTitle: z.string().optional(),
  supplierTypeTitle: z.string().optional()
});

export const Mount = defineIntegration({
  name: "Mount",
  id: "mount",
  active: true,
  category: "Quality",
  logo: Logo,
  setupInstructions: SetupInstructions,
  shortDescription:
    "Publish customers, suppliers, and parts to your Mount quality system.",
  description:
    "Mount is a quality management system, where teams record non-conformances and corrective actions, run audits, and manage risk and compliance. This integration will push data from Carbon to Mount.",
  images: [],
  settingGroups: [
    {
      name: "Connection",
      description: "API access to your Mount tenant"
    },
    {
      name: "Mapping",
      description:
        "Where Carbon records land in Mount. Parts are Objects under a definition you choose; customers and suppliers are Companies distinguished by type."
    }
  ],
  settings: [
    {
      name: "clientId",
      label: "Client ID",
      description:
        "From the API client you created in Mount. Shown at the top of the client, under Client ID.",
      group: "Connection",
      type: "text" as const,
      required: true,
      value: ""
    },
    {
      name: "clientSecret",
      label: "Client secret",
      description:
        "The key Mount showed once when you created the secret. Exchanged for a short-lived access token on every run; never sent as-is.",
      group: "Connection",
      type: "secret" as const,
      required: true,
      value: ""
    },
    {
      name: "tenant",
      label: "Tenant",
      description:
        "Mount configures each tenant separately. A Carbon company connects to exactly one.",
      group: "Connection",
      type: "text" as const,
      required: true,
      value: ""
    },
    {
      name: "scope",
      label: "Domain",
      description:
        "Optional. The domain's identifier or title, e.g. qa or Quality. Selects a domain within the tenant when Mount is partitioned into several.",
      group: "Connection",
      type: "text" as const,
      required: false,
      value: ""
    },
    {
      name: "baseUrl",
      label: "API URL",
      description: `Leave empty to use Mount's API at ${MOUNT_DEFAULT_BASE_URL}. Change it only if Mount gave you a different address.`,
      group: "Connection",
      type: "text" as const,
      required: false,
      value: ""
    },
    {
      name: "partDefinitionSlug",
      label: "Part definition slug",
      description:
        "Mount has no native part entity, so parts are objects under a definition you create. Use its slug — the last part of its settings URL, e.g. parts.",
      group: "Mapping",
      type: "text" as const,
      required: true,
      value: "parts"
    },
    {
      name: "customerTypeTitle",
      label: "Customer company type",
      description:
        "Leave empty to use Mount's Customer type. Enter a type's title or identifier only if your tenant names it differently.",
      group: "Mapping",
      type: "text" as const,
      required: false,
      value: ""
    },
    {
      name: "supplierTypeTitle",
      label: "Supplier company type",
      description:
        "Leave empty to use Mount's Supplier type. Enter a type's title or identifier only if your tenant names it differently.",
      group: "Mapping",
      type: "text" as const,
      required: false,
      value: ""
    }
  ],
  schema: MountSettingsSchema,
  actions: [
    {
      id: MOUNT_PUBLISH_ACTION_IDS.customer,
      label: "Push customers",
      endpoint: "/api/integrations/mount/publish?entityType=customer"
    },
    {
      id: MOUNT_PUBLISH_ACTION_IDS.supplier,
      label: "Push suppliers",
      endpoint: "/api/integrations/mount/publish?entityType=supplier"
    },
    {
      id: MOUNT_PUBLISH_ACTION_IDS.item,
      label: "Push parts",
      endpoint: "/api/integrations/mount/publish?entityType=item"
    }
  ]
});

function SetupInstructions() {
  return (
    <>
      <p className="text-sm text-muted-foreground">
        1. In Mount, go to Settings → API → API Clients and press Create. Give
        the client a name, for example <span className="font-mono">carbon</span>
        .
      </p>
      <p className="mt-3 text-sm text-muted-foreground">
        2. On the client, set <strong>Member ID</strong> to a member allowed to
        view and edit companies and objects — every request acts as that member
        and inherits their permissions — and press Save. Leave{" "}
        <strong>Allow direct key auth</strong> off: it applies to Mount's MCP
        endpoint, not the API Carbon uses.
      </p>
      <p className="mt-3 text-sm text-muted-foreground">
        3. Copy the <strong>Client ID</strong> from the top of the client into
        the field below. Then, under Create secret, name the secret, optionally
        set an expiry, and press Create secret. Copy the key straight away —
        Mount shows it once — and paste it into Client secret.
      </p>
      <p className="mt-3 text-sm text-muted-foreground">
        4. Tenant is the first part of your Mount web address. At{" "}
        <span className="font-mono">acme.mount.cloud</span> the tenant is{" "}
        <span className="font-mono">acme</span>.
      </p>
      <p className="mt-3 text-sm text-muted-foreground">
        5. Domain is only needed when your Mount tenant is split into several
        (quality, ESG, information security) and Carbon should work within one
        of them. Enter the domain's title as Mount shows it, for example{" "}
        <span className="font-mono">Quality</span>, or its identifier from the
        address bar. Leave it empty otherwise.
      </p>
      <p className="mt-3 text-sm text-muted-foreground">
        6. For the part definition, go to Settings → Definitions → Objects.
        Mount has no built-in part entity, so if there is no definition for
        parts, press New to create one. Open it and read the slug from the
        address bar:{" "}
        <span className="font-mono">/settings/definitions/objects/parts</span>{" "}
        means the slug is <span className="font-mono">parts</span>.
      </p>
      <p className="mt-3 text-sm text-muted-foreground">
        7. Customers and suppliers are sent as Companies of Mount's Customer and
        Supplier types. Leave the two company type fields empty unless your
        tenant names those types differently under Settings → Types → Company
        types; then enter its titles there.
      </p>
      <p className="mt-3 text-sm text-muted-foreground">
        If the integration reports unhealthy, hover the Unhealthy badge on its
        card for the reason. A client with no Member ID (step 2) is refused on
        every request. After fixing something in Mount, press Update here to run
        the check again.
      </p>
    </>
  );
}

function Logo(props: ComponentProps<"svg">) {
  return (
    <svg
      {...props}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <title>Mount</title>
      <path
        d="M2 30.5 14.2 9.2a1.6 1.6 0 0 1 2.8 0l6.1 10.6-4.2 7.3-2.6-4.6-4.7 8.2a1.6 1.6 0 0 1-1.4.8H2Z"
        fill="currentColor"
        fillOpacity="0.55"
      />
      <path
        d="M24.6 14.6a1.6 1.6 0 0 1 2.8 0L38 30.5H17.9a1.6 1.6 0 0 1-1.4-2.4l8.1-13.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

export { Logo };
