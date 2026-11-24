---
paths: []
triggers: []
promoted: null
---
# The theme a page renders is not the theme the user picked

**Context:** A seasonal theme made `getTheme` (`services/theme.server.ts`) return the seasonal name for everyone in season (2026-10).

**Problem:** The ERP's onboarding theme step and `x+/account+/theme.tsx` also read `getTheme` to seed and post back the user's own pick. In season they posted the seasonal name, `themeColorValidator` refused it, and onboarding could not get past the theme step. The theme pickers meanwhile painted a chosen theme onto `<body>` while the server kept rendering the seasonal one.

**Rule:** Keep "what to render" (`getTheme` → `resolveTheme`) and "what the user chose" (`getStoredTheme` → `storedTheme`) as two reads, and decide the season once, in the root loader (`Document` renders the name with `themeByName`). A picker that cannot take effect is disabled and says why (`useSeasonalTheme`, `SeasonalThemeNotice`).

**Applies to:** `packages/utils/src/themes.ts`, every app's `services/theme.server.ts` and `root.tsx`, every theme picker.
