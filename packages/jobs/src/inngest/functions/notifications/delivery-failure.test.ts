import { NonRetriableError } from "inngest";
import { describe, expect, it } from "vitest";
import {
  emailDeliveryFailure,
  isRetryableEmailFailure,
  isRetryableSlackFailure,
  slackDeliveryFailure
} from "./delivery-failure";

const coded = (code: string, message = "boom") =>
  Object.assign(new Error(message), { code });

describe("email delivery failure", () => {
  // Raised during connect/greet/auth — before a recipient or any DATA is sent,
  // so the relay provably has nothing and a replay cannot duplicate.
  it.each([
    "ECONNECTION",
    "EDNS",
    "EAUTH",
    "ETLS"
  ])("retries %s — nothing reached the relay", (code) => {
    const error = emailDeliveryFailure(coded(code));
    expect(isRetryableEmailFailure(coded(code))).toBe(true);
    expect(error).not.toBeInstanceOf(NonRetriableError);
    expect(error.message).toContain(code);
  });

  // The regression this whole PR exists for: nodemailer raises these at ANY
  // phase, so one can mean "relay accepted it, then the connection dropped".
  // Retrying that is how one quote becomes three copies in an inbox.
  it.each([
    "ETIMEDOUT",
    "ESOCKET"
  ])("does NOT retry %s — delivery is ambiguous", (code) => {
    expect(isRetryableEmailFailure(coded(code))).toBe(false);
    expect(emailDeliveryFailure(coded(code))).toBeInstanceOf(NonRetriableError);
  });

  it("does not retry a rejected envelope — deterministic, never succeeds", () => {
    expect(emailDeliveryFailure(coded("EENVELOPE"))).toBeInstanceOf(
      NonRetriableError
    );
  });

  it("does not retry an error with no code — unclassifiable is not safe", () => {
    expect(isRetryableEmailFailure(new Error("socket hang up"))).toBe(false);
    expect(emailDeliveryFailure(new Error("socket hang up"))).toBeInstanceOf(
      NonRetriableError
    );
  });

  it("keeps the original message, and names the code when there is one", () => {
    expect(emailDeliveryFailure(coded("EAUTH", "bad creds")).message).toBe(
      "Email error (EAUTH): bad creds"
    );
    expect(emailDeliveryFailure(new Error("bad creds")).message).toBe(
      "Email error: bad creds"
    );
  });

  it.each([
    null,
    undefined,
    "a string",
    42,
    {}
  ])("treats a non-Error rejection (%s) as terminal rather than throwing", (thrown) => {
    expect(isRetryableEmailFailure(thrown)).toBe(false);
    expect(emailDeliveryFailure(thrown)).toBeInstanceOf(NonRetriableError);
  });
});

describe("slack delivery failure", () => {
  // Only reachable with `rejectRateLimitedCalls: true` on the client — at the
  // SDK default a 429 sleeps the Retry-After and throws a bare Error with no
  // code, which lands in the ambiguous branch below.
  it("retries a rate limit — Slack provably did not post", () => {
    const rateLimited = coded("slack_webapi_rate_limited_error");
    expect(isRetryableSlackFailure(rateLimited)).toBe(true);
    expect(slackDeliveryFailure(rateLimited)).not.toBeInstanceOf(
      NonRetriableError
    );
  });

  it.each([
    ["slack_webapi_platform_error", "deterministic, e.g. channel_not_found"],
    ["slack_webapi_request_error", "network — may have posted"],
    ["slack_webapi_http_error", "non-200 — may have posted"]
  ])("does NOT retry %s (%s)", (code) => {
    expect(isRetryableSlackFailure(coded(code))).toBe(false);
    expect(slackDeliveryFailure(coded(code))).toBeInstanceOf(NonRetriableError);
  });

  it("does not retry a bare rate-limit error — the SDK default shape", () => {
    const bare = new Error("A rate limit was exceeded (retry-after: 30)");
    expect(isRetryableSlackFailure(bare)).toBe(false);
    expect(slackDeliveryFailure(bare)).toBeInstanceOf(NonRetriableError);
  });

  it("labels Slack errors distinctly from email ones", () => {
    expect(
      slackDeliveryFailure(coded("slack_webapi_platform_error", "nope")).message
    ).toBe("Slack error (slack_webapi_platform_error): nope");
  });
});
