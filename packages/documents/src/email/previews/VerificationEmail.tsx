// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import VerificationEmail from "../VerificationEmail";

export default function VerificationEmailPreview() {
  return (
    <VerificationEmail
      email={"john.doe@tombstone.ms"}
      verificationCode={"482913"}
    />
  );
}
