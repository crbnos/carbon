// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Whether the user owns the company: the `ownerId` of its company group. Billing
 * (the subscription, the Stripe portal, ownership itself) is the owner's alone,
 * whatever grants anyone else holds.
 */
export function ownsCompany(
  ownerId: string | null | undefined,
  userId: string | null | undefined
): boolean {
  return Boolean(ownerId) && ownerId === userId;
}

/** Why a transfer of a company group's ownership is refused. */
export type OwnershipTransferRefusal = "notOwner" | "sameOwner" | "notEmployee";

/**
 * Whether the caller may hand the group to `newOwnerId`: only the current owner
 * may, to someone else, who must be an active employee of a company in the group.
 */
export function ownershipTransferRefusal(args: {
  ownerId: string | null | undefined;
  callerId: string | null | undefined;
  newOwnerId: string;
  newOwnerIsGroupEmployee: boolean;
}): OwnershipTransferRefusal | null {
  if (!ownsCompany(args.ownerId, args.callerId)) return "notOwner";
  if (args.newOwnerId === args.ownerId) return "sameOwner";
  if (!args.newOwnerIsGroupEmployee) return "notEmployee";
  return null;
}
