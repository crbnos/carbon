import { VerificationEmail } from "@carbon/documents/email";
import { redis } from "@carbon/kv";
import { sendEmail } from "@carbon/lib/resend.server";
import { render } from "@react-email/components";
import { RESEND_DOMAIN } from "../config/env";

export async function sendVerificationCode(email: string) {
  try {
    // Generate 6-digit verification code
    const verificationCode = Math.floor(
      100000 + Math.random() * 900000
    ).toString();

    // Store in Redis with 10-minute expiration. @carbon/kv (withResilience) fails
    // soft: on a Redis-down condition `set` resolves null instead of "OK". If we
    // can't persist the code we must NOT send an unverifiable email — fail closed.
    const stored = await redis.set(
      `verification:${email.toLowerCase()}`,
      verificationCode,
      "EX",
      600
    );
    if (!stored) {
      console.error(
        "Failed to store verification code (Redis unavailable); not sending email"
      );
      return false;
    }

    // Send email with verification code using React template
    const html = await render(
      VerificationEmail({
        email,
        verificationCode
      })
    );

    const result = await sendEmail({
      from: `Carbon <no-reply@${RESEND_DOMAIN}>`,
      to: email,
      subject: "Verify your email address",
      html
    });
    console.log(result);

    return !result.error;
  } catch (error) {
    console.error("Failed to send verification code:", error);
    return false;
  }
}

export async function verifyEmailCode(email: string, code: string) {
  try {
    const storedCode = await redis.get(`verification:${email.toLowerCase()}`);

    // If Redis is down, @carbon/kv fails soft and `storedCode` is null, so we
    // return false. Blocking verification when the code store is unreachable is
    // the expected/acceptable fail-closed behavior — we cannot confirm the code.
    if (!storedCode || String(storedCode).trim() !== String(code).trim()) {
      return false;
    }

    // Delete the code after successful verification
    await redis.del(`verification:${email.toLowerCase()}`);

    return true;
  } catch (error) {
    console.error("Failed to verify email code:", error);
    return false;
  }
}
