// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type React from "react";
// credit: pontus@midday.ai
import { Font, Head, Html, pixelBasedPreset, Tailwind } from "react-email";

// Re-export Button component for convenience
export { Button } from "./Button";

// Email-optimized theme colors (avoiding pure white/black for better email client compatibility)
export const emailTheme = {
  light: {
    background: "#ffffff",
    foreground: "#0e0e0e", // Slightly off-black to prevent auto-inversion
    muted: "#6b7280",
    border: "#e5e7eb",
    // A raised box inside the card: a code, a document's details.
    panel: "#f8f9fa",
    accent: "#0e0e0e",
    secondary: "#9ca3af"
  },
  // What Gmail's apps make of the light palette when they recolour an email
  // for dark mode (measured), so a client that runs this theme's dark CSS
  // (Apple Mail, Outlook) shows the same email as one that inverts it.
  dark: {
    background: "#131314",
    foreground: "#fefefe", // Slightly off-white to prevent auto-inversion
    muted: "#9fa7b6",
    border: "#2e2f33",
    panel: "#242527",
    accent: "#f3f3f3",
    accentForeground: "#202124",
    secondary: "#6b7280"
  }
} as const;

/**
 * A `prefers-color-scheme: dark` block that skips Outlook.com and the new
 * Outlook. Those run the query from the operating system's theme, not their
 * own: on a dark OS, a message on Outlook's light reading pane took every dark
 * rule, so a purchase order's panel went dark and its heading turned white on
 * white (HTeuMeuLeu, "Making Emails React to Outlook.com's Dark Mode"; Can I
 * email, `@media (prefers-color-scheme)`). Outlook prefixes every class with
 * `x_`, in the markup and the CSS alike, so `:not([class^="x_"])` on each
 * selector's first class matches everywhere but there, and Outlook does its
 * own dark mode. Outlook.com also drops any rule containing `:not()` (Can I
 * email, `:not()`: not supported, tested 2024-01, on a test where stripping
 * only the `:not()` would have shown), so the rule never reaches it either
 * way. A selector with no class would still reach Outlook, so it is refused.
 */
export function darkModeMedia(rules: string) {
  const scoped = rules
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/([^{}]+)\{/g, (_, selectors: string) => {
      const list = selectors.split(",").map((selector) => {
        if (!/\.[A-Za-z]/.test(selector)) {
          throw new Error(`darkModeMedia: "${selector.trim()}" has no class`);
        }
        return selector.replace(/\.([A-Za-z][\w-]*)/, '.$1:not([class^="x_"])');
      });
      return `${list.join(",")}{`;
    });
  return `@media (prefers-color-scheme: dark) {${scoped}}`;
}

// Industry-standard dark mode CSS for email clients
export const getEmailDarkModeCSS = () => {
  return `
    /* Root CSS for email dark mode support */
    :root {
      color-scheme: light dark;
      supported-color-schemes: light dark;
    }

    /* Apple Mail, iOS Mail and other clients that run the theme's dark CSS */
    ${darkModeMedia(`
      .email-body,
      .email-body > table > tbody > tr > td {
        background-color: ${emailTheme.dark.background} !important;
        color: ${emailTheme.dark.foreground} !important;
      }
      .email-container {
        border-color: ${emailTheme.dark.border} !important;
      }
      .email-text {
        color: ${emailTheme.dark.foreground} !important;
      }
      .email-muted {
        color: ${emailTheme.dark.muted} !important;
      }
      .email-secondary {
        color: ${emailTheme.dark.secondary} !important;
      }
      .email-accent {
        color: ${emailTheme.dark.accent} !important;
        border-color: ${emailTheme.dark.accent} !important;
      }
      .email-border {
        border-color: ${emailTheme.dark.border} !important;
      }
      .email-panel {
        background-color: ${emailTheme.dark.panel} !important;
        border-color: ${emailTheme.dark.border} !important;
      }
      .email-panel-text {
        color: ${emailTheme.dark.foreground} !important;
      }
      .email-button {
        background-color: ${emailTheme.dark.accent} !important;
        border-color: ${emailTheme.dark.accent} !important;
        color: ${emailTheme.dark.accentForeground} !important;
      }
      
      /* Image swapping for dark mode */
      .dark-mode-hide {
        display: none !important;
      }
      .dark-mode-show {
        display: block !important;
      }
    `)}
  `;
};

/**
 * A stylesheet for an email's <head>, written as it is. As a text child,
 * React escapes it: `>` becomes `&gt;` and `"` becomes `&quot;`, and a rule
 * with either in its selector (`.email-body > table`, `div[style*="…"]`) is
 * invalid and dropped whole. The CSS is always our own constant.
 */
export function HeadStyle({ css }: { css: string }) {
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}

// Comprehensive email theme provider that wraps everything
interface EmailThemeProviderProps {
  children: React.ReactNode;
  preview?: React.ReactNode;
  additionalHeadContent?: React.ReactNode;
  disableDarkMode?: boolean;
}

export function EmailThemeProvider({
  children,
  preview,
  additionalHeadContent,
  disableDarkMode = false
}: EmailThemeProviderProps) {
  return (
    <Html className={disableDarkMode ? "disable-dark-mode" : ""}>
      {/* px, not rem: classic Outlook for Windows drops every rem
          size, and the email loses its spacing and type scale. */}
      <Tailwind config={{ presets: [pixelBasedPreset] }}>
        <Head>
          {/* Essential meta tags for email dark mode support */}
          {!disableDarkMode && (
            <>
              <meta name="color-scheme" content="light dark" />
              <meta name="supported-color-schemes" content="light dark" />

              {/* Additional Gmail dark mode hints */}
              <meta
                name="theme-color"
                content={emailTheme.dark.background}
                media="(prefers-color-scheme: dark)"
              />
              <meta
                name="theme-color"
                content="#ffffff"
                media="(prefers-color-scheme: light)"
              />
              <meta
                name="msapplication-navbutton-color"
                content={emailTheme.dark.background}
              />

              {/* Dark mode styles */}
              <HeadStyle css={getEmailDarkModeCSS()} />
            </>
          )}

          {/* Force light mode when dark mode is disabled */}
          {disableDarkMode && (
            <>
              <meta name="color-scheme" content="light only" />
              <meta name="supported-color-schemes" content="light" />
              <meta name="theme-color" content="#ffffff" />
              <HeadStyle
                css={`
                  :root { color-scheme: light only; supported-color-schemes: light; }
                  * { color-scheme: light !important; }
                `}
              />
            </>
          )}

          {/* Default fonts for all emails */}
          <Font
            fontFamily="Geist"
            fallbackFontFamily="Helvetica"
            webFont={{
              url: "https://cdn.jsdelivr.net/npm/@fontsource/geist-sans@5.0.1/files/geist-sans-latin-400-normal.woff2",
              format: "woff2"
            }}
            fontWeight={400}
            fontStyle="normal"
          />

          <Font
            fontFamily="Geist"
            fallbackFontFamily="Helvetica"
            webFont={{
              url: "https://cdn.jsdelivr.net/npm/@fontsource/geist-sans@5.0.1/files/geist-sans-latin-500-normal.woff2",
              format: "woff2"
            }}
            fontWeight={500}
            fontStyle="normal"
          />

          {/* Additional head content */}
          {additionalHeadContent}
        </Head>
        {preview}
        {children}
      </Tailwind>
    </Html>
  );
}

// Email-optimized theme classes (no Tailwind dependencies)
export function getEmailThemeClasses() {
  return {
    // Base classes that work across email clients
    body: "email-body",
    container: "email-container",
    heading: "email-text",
    text: "email-text",
    mutedText: "email-muted",
    secondaryText: "email-secondary",
    button: "email-accent",
    border: "email-border",
    link: "email-text",
    mutedLink: "email-muted",

    // Dark mode image control
    hideInDark: "dark-mode-hide",
    showInDark: "dark-mode-show"
  };
}

// Utility to get inline styles (fallback for older email clients)
export function getEmailInlineStyles(mode: "light" | "dark" = "light") {
  const theme = emailTheme[mode];
  return {
    body: {
      backgroundColor: theme.background,
      color: theme.foreground
    },
    container: {
      borderColor: theme.border
    },
    text: {
      color: theme.foreground
    },
    mutedText: {
      color: theme.muted
    },
    secondaryText: {
      color: theme.secondary
    },
    button: {
      color: theme.accent,
      borderColor: theme.accent
    }
  };
}

// Simplified theme hook
export function useEmailTheme() {
  return {
    classes: getEmailThemeClasses(),
    lightStyles: getEmailInlineStyles("light"),
    darkStyles: getEmailInlineStyles("dark")
  };
}
