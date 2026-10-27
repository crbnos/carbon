// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { SeasonalTheme } from "./themes";

// Seasonal theme: from October 27 to 31 it replaces every theme inside the
// signed-in app, for everyone who has not picked another one since, and the
// app decorations come with it (packages/react/src/Halloween/). Sign-in,
// shared links and onboarding keep the brand theme. To change the days, edit
// `available`; nothing else is needed. The removal checklist is
// at the top of packages/react/src/Halloween/HalloweenLayer.tsx.

export const halloweenTheme = {
  name: "halloween",
  label: "Halloween",
  available: {
    from: { month: 10, day: 27 },
    to: { month: 10, day: 31 }
  },
  mesh: {
    light: ["#fdf0e4", "#f6f0fa", "#fffaf5", "#fbefe6"],
    dark: ["#2d1205", "#14081f", "#0D0D0D", "#050505"]
  },
  activeColor: {
    light: "25 95% 50%",
    dark: "25 95% 53%"
  },
  cssVars: {
    light: {
      background: "30 30% 95%",
      foreground: "270 30% 8%",
      card: "0 0% 100%",
      "card-foreground": "270 30% 8%",
      popover: "0 0% 100%",
      "popover-foreground": "270 30% 8%",
      primary: "25 95% 50%",
      "primary-foreground": "270 30% 6%",
      active: "270 40% 92%",
      "active-foreground": "270 60% 40%",
      secondary: "30 20% 92%",
      "secondary-foreground": "270 30% 10%",
      muted: "30 15% 90%",
      "muted-foreground": "270 8% 42%",
      accent: "30 20% 92%",
      "accent-foreground": "270 30% 10%",
      destructive: "0 74% 42%",
      "destructive-foreground": "0 0% 98%",
      border: "30 15% 86%",
      input: "30 15% 86%",
      ring: "25 95% 50%",
      success: "142 70% 45%",
      "success-foreground": "0 0% 98%"
    },
    dark: {
      background: "270 20% 6%",
      foreground: "30 20% 96%",
      card: "270 25% 3%",
      "card-foreground": "30 20% 96%",
      popover: "270 20% 9%",
      "popover-foreground": "30 20% 96%",
      primary: "25 95% 53%",
      "primary-foreground": "270 30% 6%",
      active: "270 35% 18%",
      "active-foreground": "270 80% 78%",
      secondary: "270 15% 14%",
      "secondary-foreground": "30 20% 96%",
      muted: "270 15% 10%",
      "muted-foreground": "270 8% 64%",
      accent: "270 15% 14%",
      "accent-foreground": "30 20% 96%",
      destructive: "0 100% 64%",
      "destructive-foreground": "0 0% 0%",
      border: "270 15% 15%",
      input: "270 15% 15%",
      ring: "25 95% 53%",
      success: "142 70% 45%",
      "success-foreground": "0 0% 98%"
    }
  }
} as const satisfies SeasonalTheme;
