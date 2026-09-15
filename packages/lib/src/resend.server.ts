import { getLogger } from "@carbon/logger";
import type {
  CreateEmailOptions,
  CreateEmailRequestOptions,
  CreateEmailResponse
} from "resend";
import { Resend } from "resend";

const log = getLogger("lib", "resend");

/**
 * Built on first send, not at import.
 *
 * This was `export const resend = new Resend(process.env.RESEND_API_KEY!)`
 * at module scope, and Resend's constructor throws when the key is
 * missing. Every route bundle that imports `sendEmail` therefore evaluated
 * it at boot, so a deployment with no RESEND_API_KEY did not lose email —
 * it lost the whole server, crash-looping on "Missing API key" before it
 * served a request. The `!` was the tell: it asserted a value that
 * genuinely is absent in a self-hosted install.
 *
 * The DISABLE_RESEND guard below could never help, because the throw
 * happened at import time, long before anything called sendEmail.
 */
let client: Resend | undefined;

export const getResend = (): Resend | undefined => {
  const key = process.env.RESEND_API_KEY;
  if (!key) return undefined;
  if (!client) client = new Resend(key);
  return client;
};

export const sendEmail = async (
  payload: CreateEmailOptions,
  options?: CreateEmailRequestOptions
): Promise<CreateEmailResponse> => {
  const resend = getResend();

  // No key configured is the same outcome as DISABLE_RESEND, and
  // deliberately not an error: a self-hosted deployment that never set one
  // has opted out of email, and inviting a user should not fail with a
  // stack trace about someone else's SaaS.
  if (!resend) {
    log.debug("Email send skipped (no RESEND_API_KEY)", {
      to: payload.to,
      subject: payload.subject
    });
    return {
      error: null,
      data: null
    };
  }

  if (process.env.DISABLE_RESEND) {
    // Log only non-sensitive metadata — the full payload carries recipient PII
    // and the rendered HTML body (which can include verification codes).
    log.debug("Email send skipped (DISABLE_RESEND)", {
      to: payload.to,
      subject: payload.subject
    });
    return {
      error: null,
      data: null
    };
  }
  return resend.emails.send(payload, options);
};
