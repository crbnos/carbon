// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { AuthRecoveryEmail } from "../auth";

// Auth fills the {{ . }} placeholders when it sends; the preview shows them raw.
export default function AuthRecoveryEmailPreview() {
  return <AuthRecoveryEmail />;
}
