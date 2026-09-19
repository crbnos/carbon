import { Resend } from "resend";

/**
 * Resend is no longer the email transport (see email.server.ts) — this
 * client exists only for the marketing-contacts/audience API, which has no
 * SMTP equivalent. Built lazily so an install without a key never evaluates
 * the constructor (it throws on a missing key).
 */
let client: Resend | undefined;

export const getResend = (): Resend | undefined => {
  const key = process.env.RESEND_API_KEY;
  if (!key) return undefined;
  if (!client) client = new Resend(key);
  return client;
};
