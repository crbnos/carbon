// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { darkModeMedia, emailTheme } from "./Theme";

const dark = emailTheme.dark;

/**
 * On a phone the card is the whole screen: no border, corners or outer
 * margin, and less padding. A rounded border hugging the screen's edges
 * reads as a mistake.
 */
export function flatCardOnPhones(card: string, padding = "32px 20px") {
  return `
  @media only screen and (max-width: 600px) {
    .${card} {
      border-width: 0 !important;
      border-radius: 0 !important;
      margin-top: 0 !important;
      margin-bottom: 0 !important;
    }
    .${card} > tbody > tr > td {
      padding: ${padding} !important;
    }
  }
`;
}

// Dark-mode-aware styles shared by every card-style email (notifications and
// the standalone lifecycle emails). Backgrounds are intentionally set via CSS
// classes (not inline styles) so `!important` overrides in dark-mode media
// queries can flip them — inline `style` wins against non-important CSS, but
// loses to `!important`. Most modern clients (Apple Mail, iOS Mail, Gmail
// web/iOS, Outlook web/mobile) honor this; Outlook desktop renders light-mode
// only, matching the rest of the system.
//
// Flat colours only, and no page colour in light mode. Gmail's iOS app ignores
// these media queries and inverts the email's colours itself, but it never
// inverts a background image: a gradient kept the card white while the text
// on it turned white. With no page colour the light card sits on the mail
// app's own background, and the inverted card matches the dark app around it.
// The dark colours (`emailTheme.dark`) are what Gmail's inversion produces,
// so the dark card is the page's colour too, set off by its border.
export const notificationStyles = `
  .nf-card {
    border-color: #e5e7eb;
  }
  .nf-divider {
    border-color: #ececef !important;
  }
  .nf-eyebrow {
    color: #6b7280 !important;
  }
  .nf-callout {
    background-color: #fafafa !important;
    border-color: #ececef !important;
  }
  .nf-callout-accent {
    background-color: #0e0e0e !important;
  }
  .nf-fallback {
    color: #6b7280 !important;
  }

  ${darkModeMedia(`
    .nf-body,
    .nf-body > table > tbody > tr > td {
      background-color: ${dark.background} !important;
    }
    .nf-card {
      background-color: ${dark.background} !important;
      border-color: ${dark.border} !important;
    }
    .nf-divider {
      border-color: ${dark.border} !important;
    }
    .nf-eyebrow {
      color: ${dark.muted} !important;
    }
    .nf-callout {
      background-color: ${dark.panel} !important;
      border-color: ${dark.border} !important;
    }
    .nf-callout-accent {
      background-color: #fefefe !important;
    }
    .nf-fallback {
      color: ${dark.muted} !important;
    }
  `)}
${flatCardOnPhones("nf-card")}`;
