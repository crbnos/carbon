// Dark-mode-aware styles shared by every card-style email (notifications and
// the standalone lifecycle emails). Backgrounds are intentionally set via CSS
// classes (not inline styles) so `!important` overrides in dark-mode media
// queries can flip them — inline `style` wins against non-important CSS, but
// loses to `!important`. Most modern clients (Apple Mail, iOS Mail, Gmail
// web/iOS, Outlook web/mobile) honor this; Outlook desktop renders light-mode
// only, matching the rest of the system.
export const notificationStyles = `
  .nf-body {
    background-color: #f5f5f7;
    background-image: linear-gradient(180deg, #f5f5f7 0%, #ececef 100%);
  }
  .nf-card {
    background-color: #ffffff;
    background-image: linear-gradient(180deg, #ffffff 0%, #fbfbfc 100%);
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
  .nf-cta {
    background-color: #0e0e0e !important;
    color: #ffffff !important;
    border-color: #0e0e0e !important;
  }
  .nf-fallback {
    color: #6b7280 !important;
  }

  @media (prefers-color-scheme: dark) {
    .nf-body {
      background-color: #0C0C0C !important;
      background-image: linear-gradient(180deg, #0C0C0C 0%, #161618 100%) !important;
    }
    .nf-card {
      background-color: #161618 !important;
      background-image: linear-gradient(180deg, #161618 0%, #0F0F10 100%) !important;
      border-color: #1D1D1D !important;
    }
    .nf-divider {
      border-color: #1D1D1D !important;
    }
    .nf-eyebrow {
      color: #a1a1aa !important;
    }
    .nf-callout {
      background-color: #0F0F10 !important;
      border-color: #1D1D1D !important;
    }
    .nf-callout-accent {
      background-color: #fefefe !important;
    }
    .nf-cta {
      background-color: #fefefe !important;
      color: #0C0C0C !important;
      border-color: #fefefe !important;
    }
    .nf-fallback {
      color: #a1a1aa !important;
    }
  }

  /* Gmail desktop dark mode targeting */
  .gmail_dark .nf-body,
  .gmail_dark_theme .nf-body,
  [data-darkmode="true"] .nf-body {
    background-color: #0C0C0C !important;
    background-image: linear-gradient(180deg, #0C0C0C 0%, #161618 100%) !important;
  }
  .gmail_dark .nf-card,
  .gmail_dark_theme .nf-card,
  [data-darkmode="true"] .nf-card {
    background-color: #161618 !important;
    background-image: linear-gradient(180deg, #161618 0%, #0F0F10 100%) !important;
    border-color: #1D1D1D !important;
  }
  .gmail_dark .nf-divider,
  .gmail_dark_theme .nf-divider,
  [data-darkmode="true"] .nf-divider {
    border-color: #1D1D1D !important;
  }
  .gmail_dark .nf-eyebrow,
  .gmail_dark_theme .nf-eyebrow,
  [data-darkmode="true"] .nf-eyebrow {
    color: #a1a1aa !important;
  }
  .gmail_dark .nf-callout,
  .gmail_dark_theme .nf-callout,
  [data-darkmode="true"] .nf-callout {
    background-color: #0F0F10 !important;
    border-color: #1D1D1D !important;
  }
  .gmail_dark .nf-callout-accent,
  .gmail_dark_theme .nf-callout-accent,
  [data-darkmode="true"] .nf-callout-accent {
    background-color: #fefefe !important;
  }
  .gmail_dark .nf-cta,
  .gmail_dark_theme .nf-cta,
  [data-darkmode="true"] .nf-cta {
    background-color: #fefefe !important;
    color: #0C0C0C !important;
    border-color: #fefefe !important;
  }
  .gmail_dark .nf-fallback,
  .gmail_dark_theme .nf-fallback,
  [data-darkmode="true"] .nf-fallback {
    color: #a1a1aa !important;
  }

  /* Outlook web/mobile dark mode targeting */
  [data-ogsb] .nf-body {
    background-color: #0C0C0C !important;
  }
  [data-ogsb] .nf-card {
    background-color: #161618 !important;
    border-color: #1D1D1D !important;
  }
  [data-ogsb] .nf-callout {
    background-color: #0F0F10 !important;
    border-color: #1D1D1D !important;
  }
  [data-ogsc] .nf-eyebrow {
    color: #a1a1aa !important;
  }
  [data-ogsc] .nf-callout-accent {
    background-color: #fefefe !important;
  }
  [data-ogsc] .nf-cta {
    background-color: #fefefe !important;
    color: #0C0C0C !important;
    border-color: #fefefe !important;
  }
  [data-ogsc] .nf-fallback {
    color: #a1a1aa !important;
  }
`;
