// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getAppUrl } from "@carbon/env";
import { Img, Section } from "@react-email/components";

const baseUrl = getAppUrl();

export function Logo() {
  return (
    <Section className="mt-[32px]">
      <Img
        src={`${baseUrl}/carbon-word-dark-outline.png`}
        width="auto"
        height="45"
        alt="Carbon"
        className="mb-4 mx-auto block"
      />
    </Section>
  );
}
