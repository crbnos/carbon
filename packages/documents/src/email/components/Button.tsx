// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type React from "react";
import { Button as ReactEmailButton } from "react-email";
import { emailTheme } from "./Theme";

// Every email's call to action: solid ink on light, and `.email-button` in
// the theme's dark CSS flips it to white on dark.
export function Button({
  href,
  children,
  className = ""
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <ReactEmailButton
      href={href}
      className={`email-button ${className}`}
      style={{
        backgroundColor: emailTheme.light.accent,
        borderColor: emailTheme.light.accent,
        borderRadius: 10,
        borderStyle: "solid",
        borderWidth: 1,
        color: emailTheme.light.background,
        display: "inline-block",
        fontSize: 14,
        fontWeight: 500,
        padding: "13px 24px",
        textAlign: "center",
        textDecoration: "none"
      }}
    >
      {children}
    </ReactEmailButton>
  );
}
