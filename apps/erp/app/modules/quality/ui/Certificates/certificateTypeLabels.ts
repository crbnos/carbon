// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { certificateTypes } from "../../quality.models";

// Message descriptors, resolved by the caller's `t` from `useLingui()`. A
// helper that took `t` as an argument and used `` t`...` `` rendered blank:
// the macro only rewrites a `t` that comes from `useLingui()` in scope.
const CERTIFICATE_TYPE_LABELS: Record<
  (typeof certificateTypes)[number],
  MessageDescriptor
> = {
  Material: msg`Material`,
  "Special Process": msg`Special Process`,
  "Functional Test": msg`Functional Test`,
  Other: msg`Other`
};

export function getCertificateTypeLabel(
  type: (typeof certificateTypes)[number]
): MessageDescriptor {
  return CERTIFICATE_TYPE_LABELS[type] ?? { id: type, message: type };
}
