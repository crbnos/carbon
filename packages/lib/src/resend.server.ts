import { getLogger } from "@carbon/logger";
import type {
  CreateEmailOptions,
  CreateEmailRequestOptions,
  CreateEmailResponse
} from "resend";
import { Resend } from "resend";

const log = getLogger("lib", "resend");

export const resend = new Resend(process.env.RESEND_API_KEY!);

export const sendEmail = async (
  payload: CreateEmailOptions,
  options?: CreateEmailRequestOptions
): Promise<CreateEmailResponse> => {
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
