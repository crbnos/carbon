import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createTransport = vi.fn();
const sendMail = vi.fn();

vi.mock("nodemailer", () => ({
  default: { createTransport }
}));

// The real @carbon/env throws at import on unrelated required vars; mirror just
// the SMTP accessors, reading process.env lazily so vi.stubEnv applies.
vi.mock("@carbon/env", () => ({
  get SMTP_FROM() {
    return process.env.SMTP_FROM || undefined;
  },
  get SMTP_HOST() {
    return process.env.SMTP_HOST || undefined;
  },
  get SMTP_PASSWORD() {
    return process.env.SMTP_PASSWORD || undefined;
  },
  get SMTP_PORT() {
    return Number(process.env.SMTP_PORT ?? 587);
  },
  get SMTP_USER() {
    return process.env.SMTP_USER || undefined;
  }
}));

vi.mock("@carbon/logger", () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn()
  })
}));

// @carbon/env reads process.env at import time, so each test stubs env and
// re-imports the module fresh.
const loadMailer = async () => {
  vi.resetModules();
  return import("./email.server");
};

describe("sendEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createTransport.mockReturnValue({ sendMail });
    sendMail.mockResolvedValue({ messageId: "msg-1" });
    for (const key of [
      "SMTP_HOST",
      "SMTP_PORT",
      "SMTP_USER",
      "SMTP_PASSWORD",
      "SMTP_FROM",
      "RESEND_API_KEY",
      "RESEND_DOMAIN"
    ]) {
      vi.stubEnv(key, "");
      Reflect.deleteProperty(process.env, key);
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses implicit TLS on port 465", async () => {
    vi.stubEnv("SMTP_HOST", "mail.example.com");
    vi.stubEnv("SMTP_PORT", "465");
    vi.stubEnv("SMTP_USER", "user");
    vi.stubEnv("SMTP_PASSWORD", "pass");

    const { sendEmail } = await loadMailer();
    await sendEmail({ to: "a@b.com", subject: "hi", text: "hello" });

    expect(createTransport).toHaveBeenCalledWith({
      host: "mail.example.com",
      port: 465,
      secure: true,
      requireTLS: false,
      auth: { user: "user", pass: "pass" }
    });
  });

  it("uses STARTTLS (secure: false) on port 587, required when authenticated", async () => {
    vi.stubEnv("SMTP_HOST", "mail.example.com");
    vi.stubEnv("SMTP_PORT", "587");
    vi.stubEnv("SMTP_USER", "user");
    vi.stubEnv("SMTP_PASSWORD", "pass");

    const { sendEmail } = await loadMailer();
    await sendEmail({ to: "a@b.com", subject: "hi", text: "hello" });

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ port: 587, secure: false, requireTLS: true })
    );
  });

  it("allows plaintext for an unauthenticated relay", async () => {
    vi.stubEnv("SMTP_HOST", "relay.internal");
    vi.stubEnv("SMTP_PORT", "25");

    const { sendEmail } = await loadMailer();
    await sendEmail({ to: "a@b.com", subject: "hi", text: "hello" });

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ requireTLS: false, auth: undefined })
    );
  });

  it("defaults from to SMTP_FROM and returns the message id", async () => {
    vi.stubEnv("SMTP_HOST", "mail.example.com");
    vi.stubEnv("SMTP_FROM", "Acme <mail@acme.com>");

    const { sendEmail } = await loadMailer();
    const result = await sendEmail({
      to: "a@b.com",
      subject: "hi",
      html: "<p/>"
    });

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: "Acme <mail@acme.com>", to: "a@b.com" })
    );
    expect(result).toEqual({ data: { id: "msg-1" }, error: null });
  });

  it("falls back to Resend SMTP when only RESEND_API_KEY is set", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_123");

    const { sendEmail } = await loadMailer();
    await sendEmail({ to: "a@b.com", subject: "hi", text: "hello" });

    expect(createTransport).toHaveBeenCalledWith({
      host: "smtp.resend.com",
      port: 465,
      secure: true,
      auth: { user: "resend", pass: "re_123" }
    });
  });

  it("prefers SMTP_* over the Resend fallback when both are set", async () => {
    vi.stubEnv("SMTP_HOST", "mail.example.com");
    vi.stubEnv("RESEND_API_KEY", "re_123");

    const { sendEmail } = await loadMailer();
    await sendEmail({ to: "a@b.com", subject: "hi", text: "hello" });

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: "mail.example.com" })
    );
  });

  it("no-ops without error when nothing is configured", async () => {
    const { sendEmail } = await loadMailer();
    const result = await sendEmail({ to: "a@b.com", subject: "hi", text: "x" });

    expect(result).toEqual({ data: null, error: null });
    expect(createTransport).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("returns the error instead of throwing when the transport fails", async () => {
    vi.stubEnv("SMTP_HOST", "mail.example.com");
    sendMail.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));

    const { sendEmail } = await loadMailer();
    const result = await sendEmail({ to: "a@b.com", subject: "hi", text: "x" });

    expect(result.data).toBeNull();
    expect(result.error?.message).toBe("connect ECONNREFUSED");
  });

  it("derives EMAIL_DOMAIN from the from-address", async () => {
    vi.stubEnv("SMTP_FROM", "Acme <mail@acme.com>");
    expect((await loadMailer()).EMAIL_DOMAIN).toBe("acme.com");

    vi.stubEnv("SMTP_FROM", "");
    Reflect.deleteProperty(process.env, "SMTP_FROM");
    vi.stubEnv("RESEND_DOMAIN", "legacy.dev");
    expect((await loadMailer()).EMAIL_DOMAIN).toBe("legacy.dev");

    Reflect.deleteProperty(process.env, "RESEND_DOMAIN");
    expect((await loadMailer()).EMAIL_DOMAIN).toBe("carbon.ms");
  });
});
