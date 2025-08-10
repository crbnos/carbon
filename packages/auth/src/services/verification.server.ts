import { VerificationEmail } from "@carbon/documents/email";
import { redis } from "@carbon/kv";
import { resend } from "@carbon/lib/resend.server";
import { render } from "@react-email/components";
import { RESEND_DOMAIN } from "../config/env";

export async function sendVerificationCode(email: string) {
  try {
    // Generate 6-digit verification code
    const verificationCode = Math.floor(
      100000 + Math.random() * 900000
    ).toString();

    // Store in Redis with 10-minute expiration
    await redis.set(`verification:${email.toLowerCase()}`, verificationCode, {
      ex: 600,
    });

    // Send email with verification code using React template
    const html = await render(
      VerificationEmail({
        email,
        verificationCode,
      })
    );

    const result = await resend.emails.send({
      from: `Carbon <no-reply@${RESEND_DOMAIN}>`,
      to: email,
      subject: "Verify your email address",
      html,
    });

    return !result.error;
  } catch (error) {
    console.error("Failed to send verification code:", error);
    return false;
  }
}

export async function verifyEmailCode(email: string, code: string) {
  try {
    const storedCode = await redis.get(`verification:${email.toLowerCase()}`);

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
