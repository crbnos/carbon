// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { datetime } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";

export type InviteRefresh =
  | { code: string; createdBy: string }
  | {
      failure: "notFound" | "accepted" | "revoked" | "internal";
      message: string;
    };

/**
 * Gives an invite that is sent again a new code, clears its acceptance and
 * revocation, and restarts its `createdAt` (the controlled-environment
 * expiry), only while its person has no membership in the company: a pending
 * invite, or a deactivated account. The invite is read before the
 * membership, and the write matches the `acceptedAt` it read. An acceptance
 * writes the membership and `acceptedAt` in one transaction, so one that
 * lands after either read changes `acceptedAt` and the write matches nothing.
 * The write also matches `revokedAt` as it was when the resend was requested
 * (`args.revokedAt`; when absent, as read here): a resend clears the
 * revocation it was asked to clear, never one saved after it.
 * The caller sends no email unless this returns a code.
 */
export async function refreshResentInvite(
  serviceRole: SupabaseClient<Database>,
  args: {
    userId: string;
    email: string;
    companyId: string;
    revokedAt?: string | null;
  }
): Promise<InviteRefresh> {
  const invite = await serviceRole
    .from("invite")
    .select("createdBy, acceptedAt, revokedAt")
    .eq("email", args.email)
    .eq("companyId", args.companyId)
    .maybeSingle();
  if (invite.error) {
    return { failure: "internal", message: "Failed to read the invite" };
  }
  if (!invite.data) {
    return { failure: "notFound", message: "No invite record found for user" };
  }

  const isMember = async () => {
    const member = await serviceRole
      .from("userToCompany")
      .select("userId")
      .eq("userId", args.userId)
      .eq("companyId", args.companyId)
      .maybeSingle();
    return member.error ? null : member.data !== null;
  };
  const membershipUnread = {
    failure: "internal" as const,
    message: "Failed to read the membership"
  };
  const accepted = {
    failure: "accepted" as const,
    message: `${args.email} accepted the invite: they have an active account in the company.`
  };
  const memberBefore = await isMember();
  if (memberBefore === null) return membershipUnread;
  if (memberBefore) return accepted;

  const revokedAt =
    args.revokedAt === undefined ? invite.data.revokedAt : args.revokedAt;
  const update = serviceRole
    .from("invite")
    .update({
      code: nanoid(),
      acceptedAt: null,
      revokedAt: null,
      createdAt: datetime.timestamp()
    })
    .eq("email", args.email)
    .eq("companyId", args.companyId);
  const sinceAccepted =
    invite.data.acceptedAt === null
      ? update.is("acceptedAt", null)
      : update.eq("acceptedAt", invite.data.acceptedAt);
  const refreshed = await (revokedAt === null
    ? sinceAccepted.is("revokedAt", null)
    : sinceAccepted.eq("revokedAt", revokedAt)
  )
    .select("code")
    .maybeSingle();
  if (refreshed.error) {
    return { failure: "internal", message: "Failed to refresh invite" };
  }
  if (!refreshed.data) {
    // An acceptance adds the membership; a revoke or a deactivation does not.
    const memberAfter = await isMember();
    if (memberAfter === null) return membershipUnread;
    if (memberAfter) return accepted;
    return {
      failure: "revoked",
      message: `${args.email}'s invite was revoked after this resend was requested.`
    };
  }
  return { code: refreshed.data.code, createdBy: invite.data.createdBy };
}
