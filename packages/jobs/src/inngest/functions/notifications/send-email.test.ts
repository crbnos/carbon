// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { beforeEach, describe, expect, it, vi } from "vitest";

const sendEmail = vi.fn();
const integration = vi.fn();
const company = vi.fn();

vi.mock("@carbon/lib/email.server", () => ({
  DEFAULT_FROM: "Carbon <no-reply@acme.co>",
  SERVER_MAIL_CONFIGURED: true,
  sendEmail
}));

vi.mock("@carbon/auth/client.server", () => {
  const query = (maybeSingle: () => unknown) => {
    const q = { select: () => q, eq: () => q, maybeSingle };
    return q;
  };
  return {
    getCarbonServiceRole: () => ({
      from: (table: string) =>
        query(table === "company" ? company : integration)
    })
  };
});

// The real delivery rules, without the rest of @carbon/ee (it opens clients).
vi.mock("@carbon/ee", () => import("../../../../../ee/src/email/delivery"));

// The handler is all this test needs from the Inngest function.
vi.mock("../../client", () => ({
  inngest: {
    createFunction: (_config: unknown, _trigger: unknown, handler: unknown) =>
      handler
  }
}));

const { sendEmailFunction } = await import("./send-email");
const handler = sendEmailFunction as unknown as (ctx: unknown) => Promise<void>;

const send = (data: Record<string, unknown>) =>
  handler({
    event: {
      data: {
        to: "c@customer.com",
        subject: "s",
        html: "h",
        text: "t",
        ...data
      }
    },
    step: { run: (_id: string, fn: () => unknown) => fn() },
    logger: { info: vi.fn(), error: vi.fn() }
  });

const companyFrom = (fromEmail: string, name: string | null = "Acme") => {
  integration.mockResolvedValue({
    data: { active: true, metadata: { provider: "server", fromEmail } },
    error: null
  });
  company.mockResolvedValue({ data: { name }, error: null });
};

const serverAs = (name: string) => ({ name, address: "no-reply@acme.co" });

describe("send-email From and Reply-To", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendEmail.mockResolvedValue({ data: { id: "m1" }, error: null });
  });

  it("never sends a document from the company's address on the server's domain", async () => {
    companyFrom("sales@acme.co");
    await send({ companyId: "c1", document: true, from: "rep@acme.co" });
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: serverAs("Acme"),
        replyTo: "rep@acme.co, sales@acme.co"
      })
    );
  });

  it("replies to the company's address on another domain too", async () => {
    companyFrom("ceo@bank.com");
    await send({ companyId: "c1", document: true, from: "rep@acme.co" });
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: serverAs("Acme"),
        replyTo: "rep@acme.co, ceo@bank.com"
      })
    );
  });

  it("falls back to the server's name when the company has none", async () => {
    companyFrom("", null);
    await send({ companyId: "c1", document: true, from: "rep@acme.co" });
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: serverAs("Carbon"),
        replyTo: "rep@acme.co"
      })
    );
  });

  it("sends system mail from the server whatever the company sets", async () => {
    companyFrom("sales@acme.co");
    await send({ companyId: "c1" });
    expect(integration).not.toHaveBeenCalled();
    expect(company).not.toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ from: undefined, replyTo: undefined })
    );
  });
});
