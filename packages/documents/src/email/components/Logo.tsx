// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getAppUrl } from "@carbon/env";
import type React from "react";
import { Img, Section } from "react-email";

const baseUrl = getAppUrl();

// Two wordmarks. The outlined dark one reads on either background, so it
// is what a client shows when it inverts colours on its own (Gmail, classic
// Outlook). A client that runs the theme's dark CSS swaps it for the white
// one: `.dark-mode-hide` hides the first, `.dark-mode-show` reveals the
// second, which stays hidden everywhere else. Classic Outlook can still paint
// an image inside a hidden div, so a non-MSO conditional keeps it out there.
export function Logo() {
  return (
    <Section className="mt-[32px]">
      <Img
        src={`${baseUrl}/carbon-word-dark-outline.png`}
        width="auto"
        height="45"
        alt="Carbon"
        className="mb-4 mx-auto block dark-mode-hide"
      />
      <span dangerouslySetInnerHTML={{ __html: "<!--[if !mso]><!-->" }} />
      <div
        className="dark-mode-show"
        style={{ display: "none", msoHide: "all" } as React.CSSProperties}
      >
        <Img
          src={`${baseUrl}/carbon-word-dark.png`}
          width="auto"
          height="44"
          alt="Carbon"
          className="mb-4 mx-auto block"
        />
      </div>
      <span dangerouslySetInnerHTML={{ __html: "<!--<![endif]-->" }} />
    </Section>
  );
}
