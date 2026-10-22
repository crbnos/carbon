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
