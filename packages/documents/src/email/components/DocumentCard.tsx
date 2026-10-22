// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type React from "react";
import { Container } from "react-email";
import { getEmailInlineStyles, getEmailThemeClasses } from "./Theme";

// The bordered card a document email sits in. Classic Outlook ignores
// max-width, so an MSO-only ghost table holds it to 600px there; every
// other client skips the conditional comments. The spans host the comments
// the way react-email's own Button does, since React cannot render one.
export function DocumentCard({ children }: { children: React.ReactNode }) {
  return (
    <>
      <span
        dangerouslySetInnerHTML={{
          __html:
            '<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px"><tr><td><![endif]-->'
        }}
      />
      <Container
        className={`mx-auto py-5 px-5 w-full max-w-[600px] ${getEmailThemeClasses().container}`}
        style={{
          borderStyle: "solid",
          borderWidth: "1px",
          borderColor: getEmailInlineStyles("light").container.borderColor
        }}
      >
        {children}
      </Container>
      <span
        dangerouslySetInnerHTML={{
          __html: "<!--[if mso]></td></tr></table><![endif]-->"
        }}
      />
    </>
  );
}
