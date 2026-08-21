import type { TotpEnrollment } from "@carbon/auth/mfa.server";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@carbon/react";
import { useState } from "react";

/**
 * Shared pieces of the TOTP enrollment ceremony.
 *
 * Both the account settings card and the enforced-enrollment gate run the same
 * enroll → scan → verify flow against the same two endpoints. Keeping the state
 * machine, the copy, and the code input in one place means a change to any of
 * them lands in both surfaces instead of drifting.
 */

/** Shown whenever GoTrue rejects a code — same wording everywhere it can happen. */
export const INVALID_CODE_MESSAGE =
  "That code isn't right. Check your authenticator app and try again.";

const OTP_LENGTH = 6;

type OtpInputProps = {
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
};

/** The 6-slot code input, so the slot markup exists once. */
export const OtpInput = ({
  value,
  onChange,
  autoFocus = false
}: OtpInputProps) => (
  <InputOTP
    maxLength={OTP_LENGTH}
    value={value}
    onChange={onChange}
    autoFocus={autoFocus}
  >
    <InputOTPGroup>
      {Array.from({ length: OTP_LENGTH }, (_, index) => (
        // Index IS the identity here — slots are positional and never reorder.
        <InputOTPSlot key={index} index={index} />
      ))}
    </InputOTPGroup>
  </InputOTP>
);

type UseTotpEnrollmentArgs = {
  enrollAction: string;
  verifyAction: string;
  /** Called after the factor is verified; the caller decides how to refresh. */
  onVerified: () => void;
};

export function useTotpEnrollment({
  enrollAction,
  verifyAction,
  onVerified
}: UseTotpEnrollmentArgs) {
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [starting, setStarting] = useState(false);
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setEnrollment(null);
    setCode("");
    setError(null);
  };

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch(enrollAction, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? "Failed to start setup");
      }
      setCode("");
      setEnrollment(await res.json());
    } catch (e) {
      setError((e as Error).message ?? "Failed to start setup");
    } finally {
      setStarting(false);
    }
  };

  const verify = async () => {
    if (!enrollment) return;
    setVerifying(true);
    setError(null);
    try {
      const res = await fetch(verifyAction, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ factorId: enrollment.factorId, code })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? INVALID_CODE_MESSAGE);
      }
      onVerified();
    } catch (e) {
      // Clear the code so the next attempt starts from an empty input.
      setError((e as Error).message ?? INVALID_CODE_MESSAGE);
      setCode("");
    } finally {
      setVerifying(false);
    }
  };

  return {
    enrollment,
    starting,
    verifying,
    error,
    code,
    setCode: (value: string) => {
      setCode(value);
      if (error) setError(null);
    },
    setError,
    start,
    verify,
    reset
  };
}
