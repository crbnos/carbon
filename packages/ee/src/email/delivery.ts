// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { Email } from "./config";

export type EmailDelivery = {
  provider: "server" | "resend" | "smtp";
  /** The company's sender address; unset means the server's default. */
  fromEmail?: string;
};

/**
 * How a company's documents are emailed, or null when they cannot be.
 *
 * An installed Email integration wins. A company without one sends through
 * this server's mail settings when the server has them, so server-wide mail
 * works without every company entering the same credentials again. Server
 * mail chosen on a server without mail settings cannot send, so it is null.
 * Legacy installs without a `provider` are Resend, as they always were.
 */
export function resolveEmailDelivery(
  integration: { active: boolean; metadata: unknown } | null | undefined,
  serverMailConfigured: boolean
): EmailDelivery | null {
  if (!integration?.active) {
    return serverMailConfigured ? { provider: "server" } : null;
  }
  const metadata = (integration.metadata ?? {}) as Record<string, unknown>;
  const provider = (metadata.provider ?? "resend") as EmailDelivery["provider"];
  if (provider === "server" && !serverMailConfigured) return null;
  const fromEmail =
    typeof metadata.fromEmail === "string" && metadata.fromEmail.trim()
      ? metadata.fromEmail.trim()
      : undefined;
  return { provider, fromEmail };
}

/**
 * The From and Reply-To of a document email (quote, order, invoice, purchase
 * order, RFQ) under a company's delivery settings. Every other email —
 * sign-in, security, notifications — always goes from the server's address.
 *
 * On server mail the From address is always the server's own: one server can
 * host many companies, and none may send as another's mailbox or the server's
 * own on the same domain. The company is named in the From's display name
 * instead (the server's name when the company has none), and its address, if
 * set, is the Reply-To.
 */
export function documentSender(
  delivery: EmailDelivery | null,
  companyName: string | null | undefined,
  serverFrom: string
): { from?: { name: string; address: string }; replyTo?: string } {
  if (delivery?.provider !== "server") return {};
  const server = serverFrom.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  const address = server?.[2] ?? serverFrom.trim();
  const name = companyName?.trim() || server?.[1]?.trim();
  return {
    from: name ? { name, address } : undefined,
    replyTo: delivery.fromEmail
  };
}

/**
 * A company's integrations as the ERP shell offers them, with Email settled
 * for every `integrations.has("email")`: a company without the Email
 * integration sends through this server's mail settings when the server has
 * them, and one whose delivery cannot send is not offered Email at all.
 */
export function withEmailDelivery<
  T extends { id: string; active: boolean; metadata: unknown }
>(integrations: T[], companyId: string, serverMailConfigured: boolean) {
  const installed = integrations.find((i) => i.id === Email.id);
  const active = resolveEmailDelivery(installed, serverMailConfigured) !== null;
  const others = integrations.filter((i) => i.id !== Email.id);
  if (!installed && !active) return others;
  return [
    ...others,
    {
      id: Email.id,
      companyId,
      metadata: { provider: "server" },
      secretRef: null,
      updatedAt: "",
      updatedBy: null,
      ...installed,
      active
    }
  ];
}

/**
 * The Email settings form on this server, or null for another integration.
 * Server mail is offered, and is where a fresh install starts, only when the
 * server has mail settings.
 */
export function emailSettingsForm(
  integrationId: string,
  serverMailConfigured: boolean
) {
  if (integrationId !== Email.id) return null;
  if (serverMailConfigured) {
    return {
      providerOptions: undefined,
      initialMetadata: { provider: "server" } as Record<string, unknown>
    };
  }
  return {
    providerOptions:
      Email.settings
        .find((setting) => setting.name === "provider")
        ?.listOptions?.filter((option) => option.value !== "server") ?? [],
    initialMetadata: {} as Record<string, unknown>
  };
}

/** Whether an integration's settings pick Email's Server mail. */
export function picksServerMail(
  integrationId: string,
  metadata: Record<string, unknown>
): boolean {
  return integrationId === Email.id && metadata.provider === "server";
}
