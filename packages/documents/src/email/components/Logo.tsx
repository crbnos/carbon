// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getAppUrl } from "@carbon/env";
import { Img, Section } from "react-email";

const baseUrl = getAppUrl();

// One image for every client and mode: the white mark on its own dark tile.
// Gmail's apps and classic Outlook recolour an email in dark mode themselves
// and never run the theme's dark CSS, so a light/dark logo swap reaches only
// some clients. They never recolour an image, so a tile with its background
// baked in reads the same on a white card and on a dark one.
// carbon-word-dark-outline.png, the old fallback, stays in public/: emails
// already sent still load it.
export function Logo() {
  return (
    <Section className="mt-[32px]">
      <Img
        src={`${baseUrl}/carbon-email-mark.png`}
        width="80"
        height="80"
        alt="Carbon"
        className="mb-4 mx-auto block"
      />
    </Section>
  );
}
