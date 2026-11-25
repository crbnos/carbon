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

/**
 * The Inngest step tools a resend needs: a finished step's output is kept, and
 * a retry of the run gets it back without running the step again. `run`
 * returns `any` because Inngest wraps the result in `Jsonify<T>`; call sites
 * annotate it.
 */
export type InviteSteps = {
  run: (id: string, fn: () => unknown) => Promise<any>;
};

export type ResentInvite = {
  email: string;
  name: string;
  code: string;
  createdBy: string;
};

/** A hash of an invite code: the code is a bearer secret, kept out of step state. */
async function inviteCodeHash(code: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(code)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

/**
 * Sends an invite again as two steps of the `carbon/user-admin` job. The first
 * refreshes the invite and keeps the new code's hash, so a retried delivery
 * never refreshes again: a second refresh would find the revocation it cleared
 * gone and refuse. The second delivers the code the invite holds, only while
 * it is still the refreshed one and the invite is neither accepted nor
 * revoked: a revoke, an acceptance or another resend since then skips it.
 */
export async function resendInvite(
  serviceRole: SupabaseClient<Database>,
  step: InviteSteps,
  args: { userId: string; companyId: string; revokedAt?: string | null },
  deliver: (invite: ResentInvite) => Promise<void>
): Promise<{ success: boolean; message: string }> {
  const readUser = async () => {
    const user = await serviceRole
      .from("user")
      .select("email, fullName")
      .eq("id", args.userId)
      .single();
    if (!user.data) {
      throw new Error("Failed to load the invited user", { cause: user.error });
    }
    return user.data;
  };

  const refreshed: { codeHash: string } | { message: string } = await step.run(
    "refresh-invite",
    async () => {
      const user = await readUser();
      const result = await refreshResentInvite(serviceRole, {
        userId: args.userId,
        email: user.email,
        companyId: args.companyId,
        revokedAt: args.revokedAt
      });
      if ("failure" in result) return { message: result.message };
      return { codeHash: await inviteCodeHash(result.code) };
    }
  );
  if (!("codeHash" in refreshed)) {
    return { success: false, message: refreshed.message };
  }

  return step.run("send-invite", async () => {
    const user = await readUser();
    const invite = await serviceRole
      .from("invite")
      .select("code, createdBy, acceptedAt, revokedAt")
      .eq("email", user.email)
      .eq("companyId", args.companyId)
      .maybeSingle();
    if (invite.error) {
      throw new Error("Failed to read the resent invite", {
        cause: invite.error
      });
    }
    if (
      !invite.data ||
      invite.data.acceptedAt !== null ||
      invite.data.revokedAt !== null ||
      (await inviteCodeHash(invite.data.code)) !== refreshed.codeHash
    ) {
      return {
        success: false,
        message: `${user.email}'s invite was accepted, revoked or sent again after this resend refreshed it.`
      };
    }
    await deliver({
      email: user.email,
      name: user.fullName ?? "",
      code: invite.data.code,
      createdBy: invite.data.createdBy
    });
    return {
      success: true,
      message: `Successfully resent invite for ${args.userId}`
    };
  });
}

/**
 * Whether a deactivation that Revoke Invite queued still applies: the person's
 * invite still carries the revocation that queued it (`revokedAt`) and they
 * have no membership in the company. A resend clears the revocation before
 * the new link exists, and an acceptance adds the membership, so an account
 * accepted after a resend keeps its access. Throws when a read fails.
 */
export async function revocationStands(
  serviceRole: SupabaseClient<Database>,
  args: { userId: string; companyId: string; revokedAt: string }
): Promise<boolean> {
  const user = await serviceRole
    .from("user")
    .select("email")
    .eq("id", args.userId)
    .maybeSingle();
  if (user.error) {
    throw new Error("Failed to read the revoked invite's user", {
      cause: user.error
    });
  }
  if (!user.data) return false;
  const [invite, member] = await Promise.all([
    serviceRole
      .from("invite")
      .select("id")
      .eq("email", user.data.email)
      .eq("companyId", args.companyId)
      .eq("revokedAt", args.revokedAt)
      .is("acceptedAt", null)
      .maybeSingle(),
    serviceRole
      .from("userToCompany")
      .select("userId")
      .eq("userId", args.userId)
      .eq("companyId", args.companyId)
      .maybeSingle()
  ]);
  if (invite.error || member.error) {
    throw new Error("Failed to read the revoked invite", {
      cause: invite.error ?? member.error
    });
  }
  return invite.data !== null && member.data === null;
}
