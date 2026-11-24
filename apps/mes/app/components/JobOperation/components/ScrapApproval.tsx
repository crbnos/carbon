// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ScrapApprovalPrompt } from "@carbon/ee/approvals";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Avatar,
  InputOTP,
  InputOTPGroup,
  InputOTPSlot
} from "@carbon/react";
import { formatMoney } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { useState } from "react";
import { LuCheck, LuShieldCheck, LuTriangleAlert } from "react-icons/lu";

/** The scrap route's answer when an approval rule applies, if this is one. */
export function scrapApprovalPrompt(data: unknown): ScrapApprovalPrompt | null {
  if (data && typeof data === "object" && "scrapApproval" in data) {
    return (data as { scrapApproval: ScrapApprovalPrompt }).scrapApproval;
  }
  return null;
}

/**
 * The approver's sign-off inside a scrap form: who approves and their PIN.
 * Rendered after the scrap route answered that an approval rule applies; the
 * form is then sent again with `approverId` and `approverPin`.
 */
export function useScrapApproval() {
  const [prompt, setPrompt] = useState<ScrapApprovalPrompt | null>(null);
  const [approverId, setApproverId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  // Counts the prompts answered, so a refused PIN gets a fresh, focused pad.
  const [attempt, setAttempt] = useState(0);

  return {
    prompt,
    approverId,
    pin,
    attempt,
    setApproverId: (id: string | null) => {
      setApproverId(id);
      setPin("");
    },
    setPin,
    /** True while the form may not be sent: a prompt is open and unsigned. */
    isIncomplete: prompt !== null && (!approverId || pin.length !== 4),
    /**
     * Forgets the prompt when what is scrapped changes: the approver signs
     * the value shown, so a new quantity is sent, valued and shown again.
     */
    reset: () => {
      setPrompt(null);
      setPin("");
    },
    /** Reads a finished submission. Returns true when it asked for approval. */
    settle: (data: unknown) => {
      const next = scrapApprovalPrompt(data);
      if (!next) {
        // A refused or finished submission: the PIN is never sent twice.
        setPin("");
        return false;
      }
      setPrompt(next);
      setPin("");
      setAttempt((n) => n + 1);
      if (approverId && !next.approvers.some((a) => a.id === approverId)) {
        setApproverId(null);
      }
      return true;
    }
  };
}

export type ScrapApprovalState = ReturnType<typeof useScrapApproval>;

export function ScrapApprovalStep({
  approval,
  isSubmitting
}: {
  approval: ScrapApprovalState;
  isSubmitting: boolean;
}) {
  const { locale } = useLocale();
  const { prompt, approverId, pin } = approval;
  if (!prompt) return null;

  const value = formatMoney(
    prompt.estimatedValue,
    locale,
    prompt.currencyCode,
    prompt.decimalPlaces
  );
  const approver = prompt.approvers.find((a) => a.id === approverId) ?? null;

  return (
    <div className="flex flex-col gap-3 w-full">
      <input type="hidden" name="approverId" value={approverId ?? ""} />
      <input type="hidden" name="approverPin" value={pin} />
      <input
        type="hidden"
        name="approvedValue"
        value={String(prompt.estimatedValue)}
      />
      <Alert>
        <LuShieldCheck className="h-4 w-4" />
        <AlertTitle>
          <Trans>Approval needed</Trans>
        </AlertTitle>
        <AlertDescription>
          <Trans>
            This scrap is worth about{" "}
            <span className="tabular-nums font-medium">{value}</span> in
            material. An approver must enter their PIN before it is recorded.
          </Trans>
        </AlertDescription>
      </Alert>

      {prompt.approvers.length === 0 ? (
        <Alert variant="destructive">
          <LuTriangleAlert className="h-4 w-4" />
          <AlertTitle>
            <Trans>No approver available</Trans>
          </AlertTitle>
          <AlertDescription>
            <Trans>
              No one who can approve this scrap has a console PIN. Ask an admin
              to set one for an approver.
            </Trans>
          </AlertDescription>
        </Alert>
      ) : (
        <div className="rounded-lg border bg-card max-h-[220px] overflow-y-auto py-1">
          {prompt.approvers.map((person) => {
            const isSelected = person.id === approverId;
            return (
              <button
                key={person.id}
                type="button"
                disabled={isSubmitting}
                onClick={() =>
                  approval.setApproverId(isSelected ? null : person.id)
                }
                className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:scale-[0.98] ${
                  isSelected ? "bg-primary/5" : "hover:bg-muted/50"
                }`}
              >
                <Avatar
                  size="xs"
                  name={person.name}
                  src={person.avatarUrl ?? undefined}
                />
                <span className="text-sm flex-1 truncate">{person.name}</span>
                {isSelected && (
                  <LuCheck className="h-4 w-4 text-primary shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      )}

      {approver && (
        <div className="flex flex-col items-center gap-2 py-1">
          <p className="text-sm text-muted-foreground">
            <Trans>Enter PIN for {approver.name}</Trans>
          </p>
          <InputOTP
            key={approval.attempt}
            maxLength={4}
            value={pin}
            onChange={approval.setPin}
            disabled={isSubmitting}
            autoFocus
            containerClassName="[&_[data-slot=input-otp-slot]]:text-[0px]"
          >
            <InputOTPGroup>
              {[0, 1, 2, 3].map((index) => (
                <InputOTPSlot
                  key={index}
                  index={index}
                  className={
                    pin[index] ? "before:content-['●'] before:text-sm" : ""
                  }
                />
              ))}
            </InputOTPGroup>
          </InputOTP>
        </div>
      )}

      {prompt.error && (
        <p className="text-sm text-destructive text-center">{prompt.error}</p>
      )}
    </div>
  );
}
