// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { Email } from "./config";

// The Email descriptor, for server code that imports this light module instead
// of the `@carbon/ee` barrel (which validates the server env at import).
export { Email };

export type EmailDelivery = {
  provider: "server" | "resend" | "smtp" | "gmail";
  /** The company's sender address; unset means the server's default. */
  fromEmail?: string;
};

/** Email metadata with a legacy install (no `provider`) read as Resend, as it always was. */
function withLegacyProvider(metadata: unknown): Record<string, unknown> {
  const record =
    metadata && typeof metadata === "object"
      ? (metadata as Record<string, unknown>)
      : {};
  return record.provider == null ? { ...record, provider: "resend" } : record;
}

const nonEmpty = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

/**
 * The company's Email settings, checked against the schema. Pass the metadata
 * with its vaulted secrets resolved: the stored row has them scrubbed.
 */
export function parseEmailSettings(metadata: unknown) {
  return Email.schema.safeParse(withLegacyProvider(metadata));
}

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
  const metadata = withLegacyProvider(integration.metadata);
  const provider = metadata.provider as EmailDelivery["provider"];
  if (provider === "server" && !serverMailConfigured) return null;
  // Gmail with no account picked has nothing to send as.
  if (provider === "gmail") {
    return nonEmpty(metadata.gmailConnectionId) ? { provider } : null;
  }
  return { provider, fromEmail: nonEmpty(metadata.fromEmail) };
}

/**
 * The From and Reply-To of a company's message sent through this server's own
 * transport (server mail, or no Email delivery at all).
 *
 * The From address is always the server's own: one server can host many
 * companies, and none may send as another's mailbox or the server's own on the
 * same domain. A document (quote, order, invoice, PO, RFQ) names the company
 * in the From's display name instead (the server's name when the company has
 * none), and its Reply-To adds the company's address. Other mail goes out as
 * the server.
 */
export function sharedMailHeaders(
  args: {
    document: boolean;
    companyName: string | null | undefined;
    replyTo?: string;
    /** The company's own address (server mail's `fromEmail`). */
    companyAddress?: string;
  },
  serverFrom: string
): { from?: { name: string; address: string }; replyTo?: string } {
  if (!args.document) return { replyTo: args.replyTo || undefined };
  const server = serverFrom.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  const address = server?.[2] ?? serverFrom.trim();
  const name = args.companyName?.trim() || server?.[1]?.trim();
  const replyTo = [...new Set([args.replyTo, args.companyAddress])]
    .filter(Boolean)
    .join(", ");
  return {
    from: name ? { name, address } : undefined,
    replyTo: replyTo || undefined
  };
}

export type CompanyTransport =
  | {
      kind: "smtp";
      host: string;
      port: number;
      secure: boolean;
      user: string;
      pass: string;
      fromEmail: string;
    }
  | { kind: "gmail"; connectionId: string };

/**
 * The transport of a company's own Email account, from its metadata with the
 * vaulted secrets resolved. Resend sends through its SMTP relay with the
 * company's API key as the password, so Resend and SMTP are one kind. Server
 * mail is not the company's account: it goes through `sharedMailHeaders`.
 */
export function companyTransport(resolvedMetadata: unknown): CompanyTransport {
  const parsed = parseEmailSettings(resolvedMetadata);
  if (!parsed.success) {
    throw new Error("The company's Email settings are incomplete");
  }
  const settings = parsed.data;
  switch (settings.provider) {
    case "gmail":
      return { kind: "gmail", connectionId: settings.gmailConnectionId };
    case "resend":
      if (!settings.apiKey) throw new Error("The Resend API key is missing");
      return {
        kind: "smtp",
        host: "smtp.resend.com",
        port: 465,
        secure: true,
        user: "resend",
        pass: settings.apiKey,
        fromEmail: settings.fromEmail
      };
    case "smtp":
      return {
        kind: "smtp",
        host: settings.host,
        port: settings.port,
        secure: settings.secure,
        user: settings.username,
        pass: settings.password,
        fromEmail: settings.fromEmail
      };
    case "server":
      throw new Error("Server mail sends through this server's own transport");
  }
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
  serverMailConfigured: boolean,
  gmailAccounts: GmailAccount[] = []
) {
  if (integrationId !== Email.id) return null;
  // Only an Active account can send; an Expired one needs a reconnect first.
  const gmailConnectionOptions = gmailAccounts
    .filter((account) => account.status === "Active")
    .map((account) => ({
      value: account.id,
      label: account.accountLabel ?? account.name
    }));
  if (serverMailConfigured) {
    return {
      providerOptions: undefined,
      gmailConnectionOptions,
      initialMetadata: { provider: "server" } as Record<string, unknown>
    };
  }
  return {
    providerOptions:
      Email.settings
        .find((setting) => setting.name === "provider")
        ?.listOptions?.filter((option) => option.value !== "server") ?? [],
    gmailConnectionOptions,
    initialMetadata: {} as Record<string, unknown>
  };
}

/** A connected Gmail account, as `readConnections` returns it. */
export type GmailAccount = {
  id: string;
  name: string;
  accountLabel: string | null;
  status: string;
};

/** Whether an integration's settings pick Email's Server mail. */
export function picksServerMail(
  integrationId: string,
  metadata: Record<string, unknown>
): boolean {
  return integrationId === Email.id && metadata.provider === "server";
}

/**
 * Server mail and Gmail hold no credential: they save without one and must skip
 * the vault, which refuses a row with no secret.
 */
export function picksCredentialFreeEmail(
  integrationId: string,
  metadata: unknown
): boolean {
  const { provider } = withLegacyProvider(metadata);
  return (
    integrationId === Email.id &&
    (provider === "server" || provider === "gmail")
  );
}
