// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import {
  companyTransport,
  emailSettingsForm,
  parseEmailSettings,
  picksCredentialFreeEmail,
  picksServerMail,
  resolveEmailDelivery,
  sharedMailHeaders,
  withEmailDelivery
} from "./delivery";

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

  it("keeps a Gmail delivery with its account", () => {
    expect(
      resolveEmailDelivery(
        installed({ provider: "gmail", gmailConnectionId: "conn_1" }),
        false
      )
    ).toEqual({ provider: "gmail" });
  });

  it("cannot send through Gmail with no account picked", () => {
    expect(
      resolveEmailDelivery(
        installed({ provider: "gmail", gmailConnectionId: "" }),
        true
      )
    ).toBeNull();
  });
});

describe("withEmailDelivery", () => {
  const slack = { id: "slack", active: true, metadata: {} };

  it("gives a company without Email server mail when the server has it", () => {
    const shell = withEmailDelivery([slack], "c1", true);
    expect(shell.find((i) => i.id === "email")).toMatchObject({
      active: true,
      companyId: "c1",
      metadata: { provider: "server" }
    });
  });

  it("offers no Email when nothing can send", () => {
    expect(withEmailDelivery([slack], "c1", false)).toEqual([slack]);
  });

  it("keeps an installed Email, inactive when its server mail cannot send", () => {
    const email = {
      id: "email",
      active: true,
      metadata: { provider: "server" }
    };
    const shell = withEmailDelivery([slack, email], "c1", false);
    expect(shell.find((i) => i.id === "email")).toMatchObject({
      active: false,
      metadata: { provider: "server" }
    });
  });
});

describe("Email settings form", () => {
  it("offers and starts on server mail only where the server has it", () => {
    expect(emailSettingsForm("email", true)?.initialMetadata).toEqual({
      provider: "server"
    });
    const without = emailSettingsForm("email", false);
    expect(without?.providerOptions?.map((o) => o.value)).not.toContain(
      "server"
    );
    expect(emailSettingsForm("slack", true)).toBeNull();
  });

  it("offers only Active Gmail accounts, by their address", () => {
    const form = emailSettingsForm("email", false, [
      {
        id: "c1",
        name: "Sales",
        accountLabel: "sales@acme.co",
        status: "Active"
      },
      { id: "c2", name: "Old", accountLabel: "old@acme.co", status: "Expired" },
      { id: "c3", name: "Ops", accountLabel: null, status: "Active" }
    ]);
    expect(form?.gmailConnectionOptions).toEqual([
      { value: "c1", label: "sales@acme.co" },
      { value: "c3", label: "Ops" }
    ]);
  });

  it("knows a save that picks server mail", () => {
    expect(picksServerMail("email", { provider: "server" })).toBe(true);
    expect(picksServerMail("email", { provider: "smtp" })).toBe(false);
    expect(picksServerMail("slack", { provider: "server" })).toBe(false);
  });

  it("saves server mail and Gmail without a credential, never Resend or SMTP", () => {
    expect(picksCredentialFreeEmail("email", { provider: "server" })).toBe(
      true
    );
    expect(picksCredentialFreeEmail("email", { provider: "gmail" })).toBe(true);
    expect(picksCredentialFreeEmail("email", { provider: "resend" })).toBe(
      false
    );
    expect(picksCredentialFreeEmail("email", { provider: "smtp" })).toBe(false);
    // A legacy install has no provider and is Resend, which keeps a key.
    expect(picksCredentialFreeEmail("email", { fromEmail: "a@b.co" })).toBe(
      false
    );
    expect(picksCredentialFreeEmail("slack", { provider: "gmail" })).toBe(
      false
    );
  });
});

describe("parseEmailSettings", () => {
  it("reads a legacy install without a provider as Resend", () => {
    const parsed = parseEmailSettings({
      fromEmail: "sales@acme.co",
      apiKey: "re_123"
    });
    expect(parsed.success && parsed.data.provider).toBe("resend");
  });

  it("refuses Gmail with no account picked", () => {
    expect(
      parseEmailSettings({ provider: "gmail", gmailConnectionId: "" }).success
    ).toBe(false);
  });
});

describe("companyTransport", () => {
  it("sends Gmail through the picked account", () => {
    expect(
      companyTransport({ provider: "gmail", gmailConnectionId: "conn_1" })
    ).toEqual({ kind: "gmail", connectionId: "conn_1" });
  });

  it("sends Resend through its relay with the company's key", () => {
    expect(
      companyTransport({
        provider: "resend",
        fromEmail: "sales@acme.co",
        apiKey: "re_123"
      })
    ).toEqual({
      kind: "smtp",
      host: "smtp.resend.com",
      port: 465,
      secure: true,
      user: "resend",
      pass: "re_123",
      fromEmail: "sales@acme.co"
    });
  });

  it("sends SMTP through the company's own server", () => {
    expect(
      companyTransport({
        provider: "smtp",
        fromEmail: "sales@acme.co",
        host: "mail.acme.co",
        port: 587,
        username: "sales",
        password: "pw",
        secure: false
      })
    ).toEqual({
      kind: "smtp",
      host: "mail.acme.co",
      port: 587,
      secure: false,
      user: "sales",
      pass: "pw",
      fromEmail: "sales@acme.co"
    });
  });

  it("refuses a Resend install whose key is missing", () => {
    expect(() =>
      companyTransport({
        provider: "resend",
        fromEmail: "sales@acme.co",
        apiKey: ""
      })
    ).toThrow("The Resend API key is missing");
  });

  it("refuses server mail, which is not the company's own account", () => {
    expect(() => companyTransport({ provider: "server" })).toThrow();
  });
});

describe("sharedMailHeaders", () => {
  const SERVER = "Carbon <no-reply@acme.co>";
  const doc = (
    over: Partial<Parameters<typeof sharedMailHeaders>[0]> = {}
  ): Parameters<typeof sharedMailHeaders>[0] => ({
    document: true,
    companyName: "Acme",
    ...over
  });

  it("never sends a document from the company's address, even on the server's domain", () => {
    expect(
      sharedMailHeaders(
        doc({ replyTo: "rep@acme.co", companyAddress: "sales@acme.co" }),
        SERVER
      )
    ).toEqual({
      from: { name: "Acme", address: "no-reply@acme.co" },
      replyTo: "rep@acme.co, sales@acme.co"
    });
    expect(
      sharedMailHeaders(doc({ companyAddress: "ceo@bank.com" }), SERVER)
    ).toEqual({
      from: { name: "Acme", address: "no-reply@acme.co" },
      replyTo: "ceo@bank.com"
    });
  });

  it("keeps a name with quotes or brackets as data, not address syntax", () => {
    expect(
      sharedMailHeaders(doc({ companyName: 'Acme "Evil" <x@y.z>' }), SERVER)
        .from
    ).toEqual({ name: 'Acme "Evil" <x@y.z>', address: "no-reply@acme.co" });
  });

  it("falls back to the server's name without a company name", () => {
    expect(sharedMailHeaders(doc({ companyName: null }), SERVER).from).toEqual({
      name: "Carbon",
      address: "no-reply@acme.co"
    });
    expect(
      sharedMailHeaders(
        doc({ companyName: "  " }),
        '"Carbon" <no-reply@acme.co>'
      ).from
    ).toEqual({ name: "Carbon", address: "no-reply@acme.co" });
    // A bare server address has no name to borrow: the server's From stands.
    expect(
      sharedMailHeaders(doc({ companyName: null }), "no-reply@acme.co")
    ).toEqual({ from: undefined, replyTo: undefined });
  });

  it("sends other mail as the server, replying only to the caller", () => {
    expect(
      sharedMailHeaders(
        {
          document: false,
          companyName: "Acme",
          replyTo: "rep@acme.co",
          companyAddress: "sales@acme.co"
        },
        SERVER
      )
    ).toEqual({ from: undefined, replyTo: "rep@acme.co" });
  });
});
