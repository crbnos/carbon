// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { createHash } from "node:crypto";

/**
 * The identity of one logical create at a provider. Every attempt at the same
 * create (a step retry, a stale reclaim, a person's Retry) must send the same
 * key, or a lost response turns into a second remote document. Provider
 * create methods take this type, not a string, so a create cannot be written
 * without one, and only `remoteCreateKey` makes one.
 */
export type RemoteCreateKey = string & {
  readonly __remoteCreateKey: unique symbol;
};

/**
 * sha256 of `companyId:operation:localId`, keyed by the Carbon id and never
 * the payload: a retry after a crash may carry a drifted payload, and a
 * payload-sensitive key would mint a fresh key and duplicate the document.
 * `localId` names one logical create (composite ids for payments,
 * `:reversal`-suffixed ids for reversal journals, batch keys for consolidated
 * journals).
 */
export function remoteCreateKey(args: {
  companyId: string;
  operation: string;
  localId: string;
}): RemoteCreateKey {
  return createHash("sha256")
    .update(`${args.companyId}:${args.operation}:${args.localId}`)
    .digest("hex") as RemoteCreateKey;
}
