import template from "lodash.template";

export const themes = [
  {
    name: "zinc",
    label: "Carbon",
    activeColor: {
      light: "220 5.9% 10%",
      dark: "220 5.2% 33.9%",
    },
    cssVars: {
      light: {
        background: "0 0% 100%",
        foreground: "220 10% 3.9%",
        card: "0 0% 100%",
        "card-foreground": "220 10% 3.9%",
        popover: "0 0% 100%",
        "popover-foreground": "220 10% 3.9%",
        active: "222 10% 98%",
        "active-foreground": "222 41 20%",
        primary: "220 5.9% 10%",
        "primary-foreground": "0 0% 98%",
        secondary: "220 4.8% 95.9%",
        "secondary-foreground": "220 5.9% 10%",
        muted: "220 4.8% 95.9%",
        "muted-foreground": "220 3.8% 46.1%",
        accent: "220 4.8% 95.9%",
        "accent-foreground": "220 5.9% 10%",
        destructive: "0 84.2% 60.2%",
        "destructive-foreground": "0 0% 98%",
        border: "220 5.9% 90%",
        input: "220 5.9% 90%",
        ring: "220 5.9% 10%",
      },
      dark: {
        background: "220 10% 6.9%",
        foreground: "0 0% 98%",
        card: "220 10% 8.9%",
        "card-foreground": "0 0% 98%",
        popover: "220 10% 8.9%",
        "popover-foreground": "0 0% 98%",
        primary: "0 0% 98%",
        "primary-foreground": "220 5.9% 10%",
        active: "220 5.2% 13.9%",
        "active-foreground": "0 0% 98%",
        secondary: "220 3.7% 15.9%",
        "secondary-foreground": "0 0% 98%",
        muted: "220 3.7% 15.9%",
        "muted-foreground": "220 5% 64.9%",
        accent: "220 3.7% 15.9%",
        "accent-foreground": "0 0% 98%",
        destructive: "0 62.8% 30.6%",
        "destructive-foreground": "0 0% 98%",
        border: "220 3.7% 15.9%",
        input: "220 3.7% 15.9%",
        ring: "220 4.9% 83.9%",
      },
    },
  },
  {
    name: "neutral",
    label: "Neutral",
    activeColor: {
      light: "0 0% 45.1%",
      dark: "0 0% 32.2%",
    },
    cssVars: {
      light: {
        background: "0 0% 100%",
        foreground: "0 0% 3.9%",
        card: "0 0% 100%",
        "card-foreground": "0 0% 3.9%",
        popover: "0 0% 100%",
        "popover-foreground": "0 0% 3.9%",
        primary: "0 0% 9%",
        "primary-foreground": "0 0% 98%",
        active: "0 0% 98%",
        "active-foreground": "0 0% 20%",
        secondary: "0 0% 96.1%",
        "secondary-foreground": "0 0% 9%",
        muted: "0 0% 96.1%",
        "muted-foreground": "0 0% 45.1%",
        accent: "0 0% 96.1%",
        "accent-foreground": "0 0% 9%",
        destructive: "0 84.2% 60.2%",
        "destructive-foreground": "0 0% 98%",
        border: "0 0% 89.8%",
        input: "0 0% 89.8%",
        ring: "0 0% 3.9%",
      },
      dark: {
        background: "0 0% 6.9%",
        foreground: "0 0% 98%",
        card: "0 0% 8.9%",
        "card-foreground": "0 0% 98%",
        popover: "0 0% 8.9%",
        "popover-foreground": "0 0% 98%",
        primary: "30 24% 81%",
        "primary-foreground": "0 0% 9%",
        active: "0 0% 98%",
        "active-foreground": "0 0 20%",
        secondary: "0 0% 14.9%",
        "secondary-foreground": "0 0% 98%",
        muted: "0 0% 14.9%",
        "muted-foreground": "0 0% 63.9%",
        accent: "0 0% 14.9%",
        "accent-foreground": "0 0% 98%",
        destructive: "0 62.8% 30.6%",
        "destructive-foreground": "0 0% 98%",
        border: "0 0% 14.9%",
        input: "0 0% 14.9%",
        ring: "0 0% 83.1%",
      },
    },
  },
  {
    name: "red",
    label: "Red",
    activeColor: {
      light: "0 72.2% 50.6%",
      dark: "0 72.2% 50.6%",
    },
    cssVars: {
      light: {
        background: "0 0% 100%",
        foreground: "0 0% 3.9%",
        card: "0 0% 100%",
        "card-foreground": "0 0% 3.9%",
        popover: "0 0% 100%",
        "popover-foreground": "0 0% 3.9%",
        primary: "0 72.2% 50.6%",
        "primary-foreground": "0 85.7% 97.3%",
        active: "0 0% 98%",
        "active-foreground": "0 0% 20%",
        secondary: "0 0% 96.1%",
        "secondary-foreground": "0 0% 9%",
        muted: "0 0% 96.1%",
        "muted-foreground": "0 0% 45.1%",
        accent: "0 0% 96.1%",
        "accent-foreground": "0 0% 9%",
        destructive: "0 84.2% 60.2%",
        "destructive-foreground": "0 0% 98%",
        border: "0 0% 89.8%",
        input: "0 0% 89.8%",
        ring: "0 72.2% 50.6%",
      },
      dark: {
        background: "0 0% 6.9%",
        foreground: "0 0% 98%",
        card: "0 0% 8.9%",
        "card-foreground": "0 0% 98%",
        popover: "0 0% 8.9%",
        "popover-foreground": "0 0% 98%",
        primary: "0 72.2% 50.6%",
        "primary-foreground": "0 85.7% 97.3%",
        active: "0 5.2% 13.9%",
        "active-foreground": "0 0% 98%",

        secondary: "0 0% 14.9%",
        "secondary-foreground": "0 0% 98%",
        muted: "0 0% 14.9%",
        "muted-foreground": "0 0% 63.9%",
        accent: "0 0% 14.9%",
        "accent-foreground": "0 0% 98%",
        destructive: "0 62.8% 30.6%",
        "destructive-foreground": "0 0% 98%",
        border: "0 0% 14.9%",
        input: "0 0% 14.9%",
        ring: "0 72.2% 50.6%",
      },
    },
  },
  {
    name: "orange",
    label: "Orange",
    activeColor: {
      light: "24.6 95% 53.1%",
      dark: "20.5 90.2% 48.2%",
    },
    cssVars: {
      light: {
        background: "0 0% 100%",
        foreground: "20 14.3% 4.1%",
        card: "0 0% 100%",
        "card-foreground": "20 14.3% 4.1%",
        popover: "0 0% 100%",
        "popover-foreground": "20 14.3% 4.1%",
        primary: "24.6 95% 53.1%",
        "primary-foreground": "60 9.1% 97.8%",
        active: "20 5% 96%",
        "active-foreground": "20 5.3% 6%",
        secondary: "24 4.8% 95.9%",
        "secondary-foreground": "24 9.8% 10%",
        muted: "24 4.8% 95.9%",
        "muted-foreground": "25 5.3% 44.7%",
        accent: "24 4.8% 95.9%",
        "accent-foreground": "24 9.8% 10%",
        destructive: "0 84.2% 60.2%",
        "destructive-foreground": "60 9.1% 97.8%",
        border: "20 5.9% 90%",
        input: "20 5.9% 90%",
        ring: "24.6 95% 53.1%",
      },
      dark: {
        background: "20 14.3% 6.1%",
        foreground: "60 9.1% 97.8%",
        card: "20 14.3% 8.9%",
        "card-foreground": "60 9.1% 97.8%",
        popover: "20 14.3% 8.9%",
        "popover-foreground": "60 9.1% 97.8%",
        primary: "20.5 90.2% 48.2%",
        "primary-foreground": "60 9.1% 97.8%",
        active: "20 24.3% 14.1%",
        "active-foreground": "0 0% 98%",
        secondary: "12 6.5% 15.1%",
        "secondary-foreground": "60 9.1% 97.8%",
        muted: "12 6.5% 15.1%",
        "muted-foreground": "24 5.4% 63.9%",
        accent: "12 6.5% 15.1%",
        "accent-foreground": "60 9.1% 97.8%",
        destructive: "0 72.2% 50.6%",
        "destructive-foreground": "60 9.1% 97.8%",
        border: "12 6.5% 15.1%",
        input: "12 6.5% 15.1%",
        ring: "20.5 90.2% 48.2%",
      },
    },
  },
  {
    name: "yellow",
    label: "Yellow",
    activeColor: {
      light: "47.9 95.8% 53.1%",
      dark: "61 100% 50%",
    },
    cssVars: {
      light: {
        background: "0 0% 100%",
        foreground: "20 14.3% 4.1%",
        card: "0 0% 100%",
        "card-foreground": "20 14.3% 4.1%",
        popover: "0 0% 100%",
        "popover-foreground": "20 14.3% 4.1%",
        primary: "47.9 95.8% 53.1%",
        "primary-foreground": "26 83.3% 14.1%",
        active: "47.9 0% 96%",
        "active-foreground": "0 0% 4.1%",
        secondary: "47.9 4.8% 95.9%",
        "secondary-foreground": "24 9.8% 10%",
        muted: "47.9 4.8% 95.9%",
        "muted-foreground": "25 5.3% 44.7%",
        accent: "60 4.8% 95.9%",
        "accent-foreground": "24 9.8% 10%",
        destructive: "0 84.2% 60.2%",
        "destructive-foreground": "60 9.1% 97.8%",
        border: "20 5.9% 90%",
        input: "20 5.9% 90%",
        ring: "20 14.3% 4.1%",
      },
      dark: {
        background: "20 14.3% 6.1%",
        foreground: "61 9.1% 97.8%",
        card: "20 14.3% 8.9%",
        "card-foreground": "61 9.1% 97.8%",
        popover: "20 14.3% 4.1%",
        "popover-foreground": "61 9.1% 97.8%",
        primary: "61 100% 53.1%",
        "primary-foreground": "61 83.3% 14.1%",
        active: "61 100% 13.1%",
        "active-foreground": "61 100% 53.1%",
        secondary: "12 6.5% 15.1%",
        "secondary-foreground": "61 9.1% 97.8%",
        muted: "12 6.5% 15.1%",
        "muted-foreground": "24 5.4% 63.9%",
        accent: "12 6.5% 15.1%",
        "accent-foreground": "61 9.1% 97.8%",
        destructive: "0 62.8% 30.6%",
        "destructive-foreground": "61 9.1% 97.8%",
        border: "12 6.5% 15.1%",
        input: "12 6.5% 15.1%",
        ring: "61 91.7% 32.9%",
      },
    },
  },

  {
    name: "green",
    label: "Green",
    activeColor: {
      light: "151 76.2% 36.3%",
      dark: "142.1 70.6% 45.3%",
    },
    cssVars: {
      light: {
        background: "0 0% 100%",
        foreground: "151 10% 3.9%",
        card: "0 0% 100%",
        "card-foreground": "151 10% 3.9%",
        popover: "0 0% 100%",
        "popover-foreground": "151 10% 3.9%",
        primary: "151 47% 40%",
        "primary-foreground": "151 100% 97.3%",
        active: "151 0% 96%",
        "active-foreground": "0 0% 4.1%",
        secondary: "151 4.8% 95.9%",
        "secondary-foreground": "151 5.9% 10%",
        muted: "151 4.8% 95.9%",
        "muted-foreground": "151 3.8% 46.1%",
        accent: "151 4.8% 95.9%",
        "accent-foreground": "151 5.9% 10%",
        destructive: "0 84.2% 60.2%",
        "destructive-foreground": "0 0% 98%",
        border: "151 5.9% 90%",
        input: "151 5.9% 90%",
        ring: "151 47% 40%",
      },
      dark: {
        background: "20 14.3% 6.1%",
        foreground: "0 0% 95%",
        popover: "151 0% 9%",
        "popover-foreground": "151 0% 95%",
        card: "151 0% 9%",
        "card-foreground": "151 0% 95%",
        primary: "142.1 87.6% 63.3%",
        "primary-foreground": "144.9 80.4% 10%",
        active: "137 18% 15%",
        "active-foreground": "142.1 87.6% 63.3%",
        secondary: "151 3.7% 15.9%",
        "secondary-foreground": "0 0% 98%",
        muted: "151 0% 15%",
        "muted-foreground": "151 5% 64.9%",
        accent: "151 6.5% 15.1%",
        "accent-foreground": "0 0% 98%",
        destructive: "0 62.8% 30.6%",
        "destructive-foreground": "0 85.7% 97.3%",
        border: "151 3.7% 15.9%",
        input: "151 3.7% 15.9%",
        ring: "142.4 71.8% 29.2%",
      },
    },
  },
  {
    name: "blue",
    label: "Blue",
    activeColor: {
      light: "216.2 83.2% 53.3%",
      dark: "216 98% 52%",
    },
    cssVars: {
      light: {
        background: "0 0% 100%",
        foreground: "216 98% 4.9%",
        card: "0 0% 100%",
        "card-foreground": "216 98% 4.9%",
        popover: "0 0% 100%",
        "popover-foreground": "216 98% 4.9%",
        primary: "216 98% 52%",
        "primary-foreground": "210 40% 98%",
        active: "222 10% 98%",
        "active-foreground": "222 41 20%",
        secondary: "210 40% 96.1%",
        "secondary-foreground": "222.2 47.4% 11.2%",
        muted: "222 40% 96.1%",
        "muted-foreground": "215.4 16.3% 46.9%",
        accent: "222 40% 96.1%",
        "accent-foreground": "222.2 47.4% 11.2%",
        destructive: "0 84.2% 60.2%",
        "destructive-foreground": "210 40% 98%",
        border: "214.3 31.8% 91.4%",
        input: "214.3 31.8% 91.4%",
        ring: "221.2 83.2% 53.3%",
      },
      dark: {
        background: "220 14.3% 6.1%",
        foreground: "220 0% 95%",
        popover: "216 0% 9%",
        "popover-foreground": "220 0% 95%",
        card: "220 10% 8.9%",
        "card-foreground": "220 10% 95%",
        primary: "216 98% 52%",
        "primary-foreground": "216 80.4% 100%",
        active: "216 50% 15%",
        "active-foreground": "216 98% 58%",
        secondary: "220 3.7% 15.9%",
        "secondary-foreground": "220 0% 98%",
        muted: "220 3.7% 15.9%",
        "muted-foreground": "220 5% 64.9%",
        accent: "220 3.7% 15.9%",
        "accent-foreground": "0 0% 98%",
        destructive: "0 62.8% 30.6%",
        "destructive-foreground": "0 85.7% 97.3%",
        border: "220 3.7% 15.9%",
        input: "220 3.7% 15.9%",
        ring: "216 71.8% 29.2%",
      },
    },
  },
  {
    name: "violet",
    label: "Violet",
    activeColor: {
      light: "252.1 83.3% 47.8%",
      dark: "253.4 70% 40.4%",
    },
    cssVars: {
      light: {
        background: "0 0% 100%",
        foreground: "224 71.4% 4.1%",
        card: "0 0% 100%",
        "card-foreground": "224 71.4% 4.1%",
        popover: "0 0% 100%",
        "popover-foreground": "224 71.4% 4.1%",
        primary: "252.1 83.3% 47.8%",
        "primary-foreground": "210 20% 98%",
        active: "220 14.3% 95.9%",
        "active-foreground": "252.1 83.3% 47.8%",
        secondary: "220 14.3% 95.9%",
        "secondary-foreground": "220.9 39.3% 11%",
        muted: "220 14.3% 95.9%",
        "muted-foreground": "220 8.9% 46.1%",
        accent: "220 14.3% 95.9%",
        "accent-foreground": "220.9 39.3% 11%",
        destructive: "0 84.2% 60.2%",
        "destructive-foreground": "210 20% 98%",
        border: "220 13% 91%",
        input: "220 13% 91%",
        ring: "262.1 83.3% 57.8%",
      },
      dark: {
        background: "263 41.4 6.1%",
        foreground: "263 20% 98%",
        card: "263 41.4 8.9%",
        "card-foreground": "210 20% 98%",
        popover: "263 41.4 8.9%",
        "popover-foreground": "210 20% 98%",
        primary: "327 70% 40.4%",
        "primary-foreground": "210 20% 98%",
        active: "263 40% 20%",
        "active-foreground": "263 41 98%",
        secondary: "215 27.9% 16.9%",
        "secondary-foreground": "210 20% 98%",
        muted: "263 27.9% 16.9%",
        "muted-foreground": "217.9 10.6% 64.9%",
        accent: "263 27.9% 16.9%",
        "accent-foreground": "210 20% 98%",
        destructive: "0 62.8% 30.6%",
        "destructive-foreground": "210 20% 98%",
        border: "263 27.9% 16.9%",
        input: "263 27.9% 16.9%",
        ring: "263.4 70% 50.4%",
      },
    },
  },
] as const;

export type Theme = (typeof themes)[number];

export const BASE_THEME_WITH_VARIABLES = `
:root {
  --background: <%- colors.light["background"] %>;
  --foreground: <%- colors.light["foreground"] %>;
  --card: <%- colors.light["card"] %>;
  --card-foreground: <%- colors.light["card-foreground"] %>;
  --popover: <%- colors.light["popover"] %>;
  --popover-foreground: <%- colors.light["popover-foreground"] %>;
  --primary: <%- colors.light["primary"] %>;
  --primary-foreground: <%- colors.light["primary-foreground"] %>;
  --active: <%- colors.light["active"] %>;
  --active-foreground: <%- colors.light["active-foreground"] %>;
  --secondary: <%- colors.light["secondary"] %>;
  --secondary-foreground: <%- colors.light["secondary-foreground"] %>;
  --muted: <%- colors.light["muted"] %>;
  --muted-foreground: <%- colors.light["muted-foreground"] %>;
  --accent: <%- colors.light["accent"] %>;
  --accent-foreground: <%- colors.light["accent-foreground"] %>;
  --destructive: <%- colors.light["destructive"] %>;
  --destructive-foreground: <%- colors.light["destructive-foreground"] %>;
  --border: <%- colors.light["border"] %>;
  --input: <%- colors.light["input"] %>;
  --ring: <%- colors.light["ring"] %>;
  --radius: <%- radius %>rem;
}

.dark {
  --background: <%- colors.dark["background"] %>;
  --foreground: <%- colors.dark["foreground"] %>;
  --card: <%- colors.dark["card"] %>;
  --card-foreground: <%- colors.dark["card-foreground"] %>;
  --popover: <%- colors.dark["popover"] %>;
  --popover-foreground: <%- colors.dark["popover-foreground"] %>;
  --primary: <%- colors.dark["primary"] %>;
  --primary-foreground: <%- colors.dark["primary-foreground"] %>;
  --active: <%- colors.dark["active"] %>;
  --active-foreground: <%- colors.dark["active-foreground"] %>;
  --secondary: <%- colors.dark["secondary"] %>;
  --secondary-foreground: <%- colors.dark["secondary-foreground"] %>;
  --muted: <%- colors.dark["muted"] %>;
  --muted-foreground: <%- colors.dark["muted-foreground"] %>;
  --accent: <%- colors.dark["accent"] %>;
  --accent-foreground: <%- colors.dark["accent-foreground"] %>;
  --destructive: <%- colors.dark["destructive"] %>;
  --destructive-foreground: <%- colors.dark["destructive-foreground"] %>;
  --border: <%- colors.dark["border"] %>;
  --input: <%- colors.dark["input"] %>;
  --ring: <%- colors.dark["ring"] %>;
}`;

export function getThemeCode(theme: Theme) {
  if (!theme) {
    return "";
  }

  return template(BASE_THEME_WITH_VARIABLES)({
    colors: theme.cssVars,
    radius: 0.5,
  });
}
