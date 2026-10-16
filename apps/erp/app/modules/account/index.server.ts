// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  deleteAttributeValue,
  setOwnFlag,
  updateOwnAvatar,
  upsertAttributeValue
} from "./account.server";

/** The account module's operations, by entity. */
export const account = {
  avatar: { update: updateOwnAvatar },
  attributeValue: {
    upsert: upsertAttributeValue,
    delete: deleteAttributeValue
  },
  flag: { set: setOwnFlag }
};
