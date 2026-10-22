// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

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
