// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getAppUrl } from "@carbon/env";
import { Img, Section } from "@react-email/components";

const baseUrl = getAppUrl();

// A <picture> swaps to the white wordmark where the client honours
// prefers-color-scheme (Apple Mail, iOS Mail). Everywhere else the <source> is
// ignored and the outlined wordmark renders — Gmail darkens the card without
// swapping the source, and the outline reads on light and dark. Never two
// <img>s toggled by display:none — clients that drop the toggle (Outlook
// desktop) show both.
export function Logo() {
  return (
    <Section className="mt-[32px]">
      <picture>
        <source
          media="(prefers-color-scheme: dark)"
          srcSet={`${baseUrl}/carbon-word-dark.png`}
        />
        <Img
          src={`${baseUrl}/carbon-word-dark-outline.png`}
          width="auto"
          height="45"
          alt="Carbon"
          className="mb-4 mx-auto block"
        />
      </picture>
    </Section>
  );
}
