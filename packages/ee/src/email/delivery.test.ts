// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import { documentSender, emailDomain, resolveEmailDelivery } from "./delivery";

const installed = (metadata: Record<string, unknown>) => ({
  active: true,
  metadata
});

describe("resolveEmailDelivery", () => {
  it("sends a company without the integration through server mail", () => {
    expect(resolveEmailDelivery(null, true)).toEqual({ provider: "server" });
    expect(resolveEmailDelivery({ active: false, metadata: {} }, true)).toEqual(
      { provider: "server" }
    );
  });

  it("cannot send without the integration or server mail", () => {
    expect(resolveEmailDelivery(undefined, false)).toBeNull();
  });

  it("keeps an installed Resend or SMTP provider either way", () => {
    for (const serverMail of [true, false]) {
      expect(
        resolveEmailDelivery(
          installed({ provider: "smtp", fromEmail: "a@b.co" }),
          serverMail
        )
      ).toEqual({ provider: "smtp", fromEmail: "a@b.co" });
    }
  });

  it("reads a legacy install without a provider as Resend", () => {
    expect(
      resolveEmailDelivery(installed({ fromEmail: "a@b.co" }), false)
    ).toEqual({ provider: "resend", fromEmail: "a@b.co" });
  });

  it("uses server mail with the company's From when set", () => {
    expect(
      resolveEmailDelivery(
        installed({ provider: "server", fromEmail: " sales@acme.co " }),
        true
      )
    ).toEqual({ provider: "server", fromEmail: "sales@acme.co" });
  });

  it("falls back to the server's From when the company sets none", () => {
    expect(
      resolveEmailDelivery(
        installed({ provider: "server", fromEmail: "" }),
        true
      )
    ).toEqual({ provider: "server", fromEmail: undefined });
  });

  it("cannot send through server mail the server does not have", () => {
    expect(
      resolveEmailDelivery(installed({ provider: "server" }), false)
    ).toBeNull();
  });
});

describe("documentSender", () => {
  const server = (fromEmail?: string) => ({
    provider: "server" as const,
    fromEmail
  });

  it("sends as the company's address on the server's own domain", () => {
    expect(documentSender(server("Sales@Acme.co"), "acme.co")).toEqual({
      from: "Sales@Acme.co"
    });
  });

  it("moves a company address on another domain to the Reply-To", () => {
    expect(documentSender(server("ceo@bank.com"), "acme.co")).toEqual({
      replyTo: "ceo@bank.com"
    });
    // A subdomain is another domain to the relay.
    expect(documentSender(server("a@mail.acme.co"), "acme.co")).toEqual({
      replyTo: "a@mail.acme.co"
    });
  });

  it("uses the server's sender without a company address", () => {
    expect(documentSender(server(), "acme.co")).toEqual({});
    expect(documentSender(null, "acme.co")).toEqual({});
  });

  it("never sets a sender for Resend or SMTP integrations", () => {
    expect(
      documentSender({ provider: "smtp", fromEmail: "a@acme.co" }, "acme.co")
    ).toEqual({});
  });
});

describe("emailDomain", () => {
  it("reads the domain of a bare or named address", () => {
    expect(emailDomain("a@Acme.co")).toBe("acme.co");
    expect(emailDomain("Acme <a@acme.co>")).toBe("acme.co");
    expect(emailDomain("nobody")).toBeUndefined();
  });
});
