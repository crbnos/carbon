# Window themes — solid and gradient colors for the app frame and page

> Status: in-progress
> Author: naveenkash
> Date: 2026-11-03

## TLDR

A user can color the frame of the ERP and the MES: the navigation rail and the
gutter around the content card. The user picks a solid theme, a gradient
theme, or a custom pair of colors with an optional gradient. The page takes a
tint of the frame's hue, so the page and the frame match. These are themes,
beside the 8 color themes: one choice, stored in the existing `theme` cookie.
A color theme renders exactly as it did before.

## Overview diagram

```mermaid
flowchart LR
    A["Appearance pane"]:::hot -->|"theme"| B["root action"]
    B --> C["theme cookie"]
    C --> D["root loader"]
    D --> E["useWindowTheme"]:::new
    A -.->|"preview or pending pick"| E
    E --> F["SidebarProvider frame"]:::hot
    E --> G["NavRail colors"]:::hot
    E --> H["page tint on html"]:::new
    classDef hot stroke-width:3px
    classDef new stroke-dasharray:4 3
```

## Problem Statement

Carbon has 8 theme colors (`themes` in `packages/utils/src/themes.ts`). A theme
color sets the accent: buttons, the active item, focus rings. It does not
change the frame. Every company and every user therefore sees the same grey
frame. A user who works in 2 companies, or on 2 screens, cannot tell them
apart at a glance.

Slack solves this with window themes (see
`.ai/research/2026-11-03-window-themes.md`). The user picks a frame color or a
gradient. The message pane stays neutral.

## Proposed Solution

### Model

A window theme has 3 values:

| Value | Meaning |
|-------|---------|
| `base` | The frame color. Slack calls it "Window background". |
| `highlight` | The color of the selected item in the rail. Slack calls it "Selected items". |
| `gradient` | If true, the frame blends `base` into `highlight` towards the bottom right. |

A window theme is a theme. `Theme.window` holds its 3 values, and the `theme`
cookie holds its name, as for every theme:

| `theme` cookie | Meaning |
|----------------|---------|
| `zinc`, `red`, … | A color theme. No window colors: the frame looks as it does today. |
| `forge`, `graphite`, … | A window theme from `windowThemes` (built from `WINDOW_THEMES`). |
| `custom:7c2d12:ea580c:g` | A custom theme: `base`, `highlight`, then `g` (gradient) or `s` (solid). |

A window theme keeps the default theme's accent (`cssVars` of `zinc`).
`isThemeName` is the one test of a stored name. An unknown or malformed value
reads as the default theme. So removing a preset never breaks a browser that
still holds its name.

### Presets

`WINDOW_THEMES` in `packages/utils/src/window-themes.ts` holds 16 presets in 2
groups.

| Group | Presets |
|-------|---------|
| Gradient | Forge, Anodized, Patina, Brass, Oxide, Aurora, Tidewater |
| Solid | Graphite, Plum, Ember, Jade, Lagoon, Cobalt, Garnet, Linen, Mist |

Linen and Mist are light frames with dark text. The other presets are dark
frames with light text.

### Colors in the frame

`windowThemeStyle(theme)` returns 3 style objects and a tone. All are pure
functions of the 3 values, so the server and the browser render the same thing.

| Style | Applied to | Sets |
|-------|-----------|------|
| `frame` | `SidebarProvider` in the ERP and MES shells | `background`: `base`, or the gradient flow ("The gradient" below) |
| `rail` | the desktop `<nav>` of `NavRail` | `background: transparent`, `color: hsl(var(--foreground))`, and the rail's CSS variables (table below) |

The rail sets the existing theme variables again, inside the rail only:

| Variable | Value |
|----------|-------|
| `--foreground` | White or near-black, whichever has the better WCAG contrast against the frame |
| `--muted-foreground` | `--foreground` blended 35% towards `base` |
| `--active` | A translucent tile: the rail's text color at 14% opacity. If that costs the text its 4.5:1 contrast on a gradient end, black at 22% opacity. |
| `--active-foreground` | `--foreground` |
| `--accent`, `--card`, `--border`, `--input` | `--foreground` blended 8% to 18% over `base` |
| `--background` | `base` |

The rail sets `color` too. Text with no color class inherits its color from
`<body>`, and `<body>` resolves `--foreground` before the rail sets it again.

The rail's classes do not change. They read the same variables, so a rail
without a window theme renders as it does today. Popovers, tooltips and the
mobile drawer render in a portal, outside the rail. So they keep the normal
colors.

### The gradient

The first gradient was one straight sRGB line from `base` to a blend with
`highlight`. A blend in sRGB passes through grey between distant hues: blue to
lime went muddy olive. Slack's gradient does 4 things that one line does not:

1. It blends in a perceptual color space, so blue to lime passes through teal.
2. It deepens and mutes the picked colors. The frame never shows them raw.
3. It moves over the whole window: a lift at the top, a glow at the far corner.
4. Its channel list flows too, from the top hue to the bottom hue.

`gradientFlow` (`window-themes.ts`) builds 4 stops in OKLCH: OKLab read as
lightness, chroma and hue. A blend moves the hue the shorter way round the
wheel. A straight line through OKLab still crosses grey between opposite hues.
Round the wheel, red goes through violet to blue, as Slack's bloom does.

| Stop | Color |
|------|-------|
| `glow` | `base`, 0.045 lighter (OKLab L): the top right |
| `base` | The user's color, as it is |
| `mid` | Halfway from `base` to `end`, at 80% chroma |
| `end` | 70% from `base` to `highlight`, 0.03 darker than `base` at most, at 80% chroma: the bloom |

`windowThemeBackground` paints 2 layers, top first, as Slack's frame does:

1. The bloom: `end` at the bottom-left corner, through `mid`, fading out.
2. A diagonal wash (45°) from `mid` at the bottom left, through `base`, to
   `glow` at the top right.

With the gradient off, the frame is the flat `base`, so the bloom is all the
gradient adds. A gradient theme's module sidebar flows too. `--card-end` is
the panel tint in the hue of `end`, at the same lightness. The sidebar paints
`--card` to `--card-end` from top to bottom, so its foot takes the bloom's
hue. The picker's swatch runs the same way: the bloom at the bottom left.

`windowThemeStyle` checks the text color against all 4 stops. It takes the
color whose lowest contrast is highest. Then every stop but `base` moves away
from the text, 0.015 OKLab L at a time, until the text reads at AA. `base` is
the user's own color, so it never moves.

`tone` is `dark` when the frame takes light text, else `light`. The rail picks
the company logo by `tone`, not by the mode. A dark frame in light mode needs
the logo made for a dark background.

### Colors in the page

`content` holds the page's surface and text variables, one set per mode:
`--background`, `--card`, `--popover`, `--secondary`, `--muted`, `--accent`,
`--active`, `--border`, `--input` and their `-foreground` pairs. Each one takes
the hue of `base`. Its saturation is a fixed fraction of the saturation of
`base`, so Graphite leaves the page almost neutral and Plum gives a clear plum
cast. Its lightness stays close to the default theme, so contrast stays the
same.

The root `Document` sets `content` on `<html>` after the theme's own
variables, so the tint wins. Dialogs, popovers and tooltips render in a portal
under `<body>`, so they take the tint too. `useWindowThemeContent(mode)` sets
it only inside the signed-in app (`isAppPath`). Sign-in, shared links and
onboarding keep the plain theme.

`content` does not touch `--primary`, `--destructive`, `--success` or `--ring`.
The theme color and the status colors keep their meaning.

The page takes the lightest tint. Slack's message pane is the calmest part of
the window, and Carbon's page holds dense tables and forms.

`panel` holds a stronger tint for the module sidebar (`CollapsibleSidebar`),
one set per mode. It sits between the frame and the page, as Slack's channel
list does. It is pale with dark text in light mode, and deep with light text in
dark mode. The sidebar sets `panel` on its own element, as the rail does.

So a window theme has 3 layers, from strongest to lightest:

| Layer | Carbon element | Slack element |
|-------|----------------|---------------|
| Frame | `SidebarProvider` and the rail | The window background and the workspace rail |
| Panel | The module sidebar | The channel list |
| Page | The content card, dialogs, popovers | The message pane |

`window-themes.test.ts` holds every preset, in both modes, to 4.5:1 for
`--foreground` and `--muted-foreground` on each surface of the page and the
panel. It holds `--active-foreground` on `--active` to 4.5:1 too.

### Read and write

The flow is the theme's own flow. Nothing new reaches the server:

1. The Appearance pane posts `theme` to the host app's root action (`/`).
2. The root action validates it with `themeColorValidator` (`isThemeName`).
   Then it writes the `theme` cookie (`themeCookieWrites`).
3. The root loader returns `theme` (`getTheme`), which resolves a window
   theme or a custom one like any theme.
4. `useThemeValue()` (`@carbon/react`) reads a preview first, then any pending
   `theme` pick, then the loader data. `useWindowTheme()` returns the styles of
   that theme's window colors, or `null` for a color theme.
5. `NavRail` applies `rail`. The ERP and MES shells apply `frame`. The root
   `Document` applies `content`.

Because step 4 reads the pending pick, the app changes as soon as the user
clicks. A color drag uses the preview: `setWindowThemePreview` paints each
pointer move without a save. The pane saves once, 400 ms after the last move.
If the user closes the pane first, the pane saves the last color as it closes.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| What a window theme colors | The frame (`SidebarProvider` and the desktop `NavRail`) in full color, and a tint of the frame's hue on the page. | The user asked for a page that matches the frame, not a plain black or white page (2026-11-03). A tint, not the full color, keeps dense tables and forms readable. A test holds the page text at AA. |
| Window theme or theme | A kind of theme, beside the color themes. One choice, one `theme` cookie. | The user asked for one setting, so the app manages one cookie and one resolver (2026-11-05). The cost: a user can no longer combine a color theme's accent with a window frame. |
| Where the choice is stored | The `theme` cookie, per browser. | Every theme is a per-browser cookie on the host app (`packages/account/AGENTS.md`). A new column is a schema change, which `AGENTS.md` puts in Ask First. |
| A window theme's accent | The default theme's (`zinc`) `cssVars`. | The frame carries the color. A neutral accent fits every frame. |
| The avatar menu and the mobile profile sheet | They list the color themes only. | 24 themes crowd a compact menu. A pick there replaces a window theme, as any theme pick does. |
| Light mode and dark mode | The same frame colors in both modes. | Slack does this (research finding 4). It halves the preset data, and a dark frame around a white card is the look users know from Slack. |
| Text color in the frame | Computed by WCAG contrast, never stored. | A custom color can be light or dark. A stored text color could go stale when the user edits the frame color. |
| Status colors | Not customizable. | `success` and `destructive` carry meaning across Carbon (research finding 3). |
| Animated mesh gradient | Not used. Gradients are static CSS. | A WebGL shader behind every page costs GPU and battery all day. The mesh stays on onboarding. |
| Where the colors apply | Through the existing CSS variables, not new Tailwind tokens: on the rail for the rail, on `<html>` for the page. | No class changes, so the default app cannot drift. The page variables sit on `<html>`, so portals match the page. |
| Rail hover and selected item | A translucent tile of the rail's text color, not the highlight. The hover is the same tile at 60%. | Slack's rail does this. A solid highlight tile sat badly on a gradient frame. A tile works on any frame. |
| Where the highlight shows | The module sidebar's selected item: a 45% wash of `highlight` over the panel. | Slack puts "Selected items" on the channel list. A full-strength fill failed AA on its 60% hover blend for most presets. The wash keeps the text at 4.5:1 on both. |
| The module sidebar | A `panel` tint, stronger than the page and lighter than the frame. | The user's Slack screenshots (2026-11-03): the channel list is a tinted panel between the frame and a calm message pane. 3 layers read as one theme. |
| The company logo in the rail | Picked by the frame's `tone`, not by the mode. | The logo sits on the frame. A dark frame in light mode would show the logo made for a light background. |
| Preview | A click: the pending `theme` submission, from any fetcher. A color drag: `setWindowThemePreview`, a store that `useThemeValue` reads first. | Each save revalidates every loader on the page. A drag that saved every 150 ms ran about 20 full revalidations in 3 seconds. |
| Custom color pickers | `ColorPicker` (`@carbon/react`). The pane saves once, 400 ms after the last change, and on close. | An existing component. One save per drag. |
| Accent preview of a window theme | `useThemePreview` skips the variables that `content` sets. | The accent preview paints `<body>`, which outranks `<html>`. Without the skip, the tint drops while the preview shows. |
| Apps | ERP and MES. The starter hides the section. | The ERP and the MES shells both use `NavRail` inside `SidebarProvider`. The starter's shell has no rail. |
| Where the presets live | `packages/utils/src/window-themes.ts`, beside `themes.ts` and `ui-scale.ts`. | Server code (root loaders) and browser code (`@carbon/react`, `@carbon/account`) both read them. |
| Preset labels | Plain strings, not translated. | The theme color labels ("Modern", "Cherry") are not translated either. They are names. |
| Heuristic 1, multi-tenancy | N/A. No table. | The cookie holds a display preference of one browser. It holds no company data. |
| Heuristic 2, service shape | N/A. No service function. | The root action writes a cookie, as it does for text size. |
| Heuristic 3, RLS | N/A. No table. | No data reaches the database. |
| Heuristic 4, permissions | N/A. | Every signed-in user can change their own appearance. The root action has no permission check for mode or text size. |
| Heuristic 5, form pattern | A fetcher posts to `/`, as the rest of the Appearance pane does. | The pane has no form to submit. Each control saves on change. |
| Heuristic 6, module layout | N/A. No ERP module. | The code lives in shared packages and the app roots. |
| Heuristic 7, backward compatibility | No frozen surface changes. With no cookie, every app renders as before. | The rail variables apply only when a window theme is set. |

## Data Model Changes

N/A. The feature adds no table and no column. It stores the choice in a
cookie.

## API / Service Changes

| Place | Change |
|-------|--------|
| `packages/utils/src/window-themes.ts` (new) | `WINDOW_THEMES`, `parseWindowTheme`, `serializeWindowTheme`, `windowThemeStyle`, `windowThemeTextColors`, `windowThemeSwatch`, `windowThemeMesh`, `randomWindowTheme`. Color math only, no cookies. |
| `packages/utils/src/themes.ts` | `Theme` gets `window?`. New `windowThemes` and `isThemeName`. `storedTheme` and `themeByName` resolve window themes and `custom:` names. |
| `packages/utils/src/types.ts` | `themeColorValidator` accepts every `isThemeName`. |
| `packages/utils/src/window-themes.test.ts` (new) | Parsing, round trips, contrast choices, style output, window themes read from the `theme` cookie |
| `packages/react/src/hooks/useWindowTheme.tsx` (new) | `useThemeValue`, `useWindowTheme`, `useWindowThemeContent`, `setWindowThemePreview` |
| `packages/react/src/NavRail.tsx` | Applies `rail` to the desktop `<nav>` |
| ERP and MES `root.tsx` | `Document` sets `content` on `<html>`. The loader and the action are the theme's own. |
| ERP and MES `routes/x+/_layout.tsx` | Applies `frame` to `SidebarProvider` |

## Closest Sibling

The color themes (`themes.ts`): a window theme is one more kind of theme. It
uses the theme cookie, the theme validator, the theme resolvers and the root
action's theme branch with no copy. The preview copies text size and density
(`useUiScale` reads a pending pick first).

Deviation: a color theme styles `<html>` only. A window theme also styles 3
elements of the shell (the frame, the rail, the module sidebar), because the
frame takes the full color. That deviation is the "What a window theme colors"
decision.

## UI Changes

Archetype: a settings pane section (`AccountSettingsSection` in
`packages/account/src/ui/AppearanceSettings.tsx`), `ThemeSettings`. It
replaces the "Theme color" section.

1. Section "Theme". Description: "A color sets the accent. Gradient and solid
   themes also color the navigation, the sidebar and the page."
2. 2 tabs in the section header, beside the title, as Slack does: "Themes"
   and "Custom theme". The tabs keep the pane short. The section opens on
   "Custom theme" when a custom theme is in use, else on "Themes".
3. Tab "Themes" holds 3 groups in a 2-column grid (4 columns from `sm`). Each
   card has a round swatch and the theme name. The selected card has the
   primary border.
   1. "Color": the 8 color themes (`pickableThemes`, the seasonal theme first
      while in season).
   2. "Gradient": 7 cards. The swatch shows the gradient flow.
   3. "Solid": 9 cards. The swatch is one flat circle of the frame color. A
      circle split into 2 halves read as a two-tone frame.
4. Tab "Custom theme" holds the custom theme editor:
   1. A "Custom" card. Its swatch shows the custom colors. A click saves the
      colors that the custom fields show.
   2. A "Surprise me" button: it picks a random dark base and a lighter
      highlight of a nearby hue.
   3. 2 `ColorPicker` fields: "Window background" and "Selected items".
   4. A `Switch`: "Window gradient", with the hint "Blend the window
      background into the selected items color."
5. If the user selects a window theme, the custom fields show its colors. An
   edit turns them into a custom theme.

`AccountSettingsConfig` gets `windowThemes?: boolean`. The ERP and the MES set
it. The starter does not, so its section has no tabs and lists the color themes
only.

## Acceptance Criteria

- [ ] With a color theme, the ERP and MES shells render with the same classes
      and styles as before. The rail `<nav>` has no `style`.
- [ ] A user picks "Plum". The `theme` cookie holds `plum`. No other cookie
      changes.
- [ ] A user picks "Plum" in Account → Appearance. The frame and the rail turn
      plum at once, before the save returns. The page, the tables and the
      dialogs take a plum tint in light mode and in dark mode.
- [ ] Every preset keeps the page text at a WCAG contrast of at least 4.5:1 in
      both modes (`window-themes.test.ts`).
- [ ] A user drags a custom color for 3 seconds. The frame follows the pointer.
      The browser sends 1 save after the drag, not 1 per move.
- [ ] The sign-in page shows no tint for a browser that holds a window theme.
- [ ] A user picks "Tidewater" on a module page. The module sidebar is a pale
      blue-green panel in light mode and a deep blue-green panel in dark mode.
      The page is almost white or almost black.
- [ ] After a reload, the frame is still plum. The server renders it, so the
      page shows no flash of the grey frame.
- [ ] A user picks "Forge". The frame shows a gradient from dark orange to a
      lighter orange towards the bottom right.
- [ ] A user picks "Linen". The rail text is dark and has a WCAG contrast of at
      least 4.5:1 against the frame.
- [ ] A user sets custom colors `#DC540C` and `#F89B6C` with "Window gradient"
      on. The `theme` cookie holds `custom:dc540c:f89b6c:g`. The frame shows the gradient.
- [ ] The selected rail item is a translucent tile. Its text contrast is at
      least 4.5:1 on every preset.
- [ ] The selected module sidebar item takes the highlight's hue. Its text
      contrast is at least 4.5:1, selected and under the pointer.
- [ ] The CompanySwitcher dropdown and the rail tooltips keep the normal
      popover colors.
- [ ] A user picks "Modern". The `theme` cookie holds `zinc`. The frame is grey again.
- [ ] The root action refuses `theme=custom:zzz` with status 400.
- [ ] The starter's Appearance pane shows no "Window theme" section.
- [ ] The MES shows the same frame as the ERP for the same cookie.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| A custom pair gives low contrast on a selected or hovered item | Low | `windowThemeStyle` picks the rail tile and the panel text for contrast on the fill and on the 60% hover blend. The user chose the colors and sees the result at once. |
| A shell element inside the rail sets a hard-coded color (`text-white`, `bg-zinc-…`) | Low | Check the ERP and MES rails in the browser with a light and a dark preset. |
| The cookie value carries CSS into a style attribute | High | `parseWindowTheme` accepts only a known preset name or `custom:` + 2 six-digit hex codes + `g`/`s`. Every other value reads as the default. Unit tests pin this. |
| A frame color makes the content card's edge hard to see | Low | The card keeps its border and `shadow-md`. |
| The page tint lowers the contrast of page text | Med | The tint keeps the default lightness. A test holds every preset at 4.5:1 in both modes. |
| A custom color gives a strong tint | Low | The tint takes a fraction of the color's saturation, and the user sees the result at once. |

## Open Questions

> HARD STOP: Do not proceed with implementation until these are answered.

The user asked for an autonomous run ("take best decision, don't stop to wait
for me"). So the agent decided each question below: first by codebase
precedent, then by the research, then by the recommended answer.

- [x] Is the choice per browser or per user? — **Autonomous:** per browser, a
      cookie. Every other appearance setting is a per-browser cookie. A per-user
      column is a schema change, which is Ask First.
- [x] Does the top bar inside the content card take the frame color, as Slack's
      search bar does? — **Autonomous:** no. The top bar is inside the card, and
      the card stays neutral. Moving the top bar out of the card is a layout
      change outside this feature.
- [x] Does the MES get the feature, or only the ERP? — **Autonomous:** both. The
      Appearance pane is shared, and the 2 shells have the same structure. A
      setting that shows in the MES pane and does nothing there would be a bug.
- [x] Does the mobile drawer take the frame color? — **Autonomous:** no. It is
      a sheet over the page, like a popover. Below `md` the content card fills
      the screen, so the frame does not show.
- [x] Do the presets include Slack's "Vision assistive" group? —
      **Autonomous:** no, not in v1. Slack's assistive presets change status
      colors, which Carbon keeps fixed. Every preset meets 4.5:1 text contrast
      already.
- [x] Is a window theme a second setting, or a kind of theme? — **User:** a
      kind of theme, in the `theme` cookie, "so we don't manage different
      cookies or variables" (2026-11-05). It replaces the autonomous first
      decision, a separate `window-theme` cookie.
- [x] Does the page take the window theme's color, or only the frame? —
      **User:** the page too. The user asked for the page background and text
      to match the theme, not to show plain black. The agent first decided
      "frame only" from Slack's model. The user's answer replaces it.
- [x] Do Slack's "Share" and "Import" buttons come in v1? — **Autonomous:** no.
      The custom value is a short cookie string. "Surprise me" is in v1
      because it needs no new surface.

## Changelog

- 2026-11-05: The bloom comes from the bottom-left corner and the base fills
  the top right, as in Slack. Blends go round the hue wheel (OKLCH), so
  opposite hues pass through violet, not grey. The bloom is a touch darker
  than the base.
- 2026-11-05: The Theme section splits into 2 tabs, "Themes" and "Custom
  theme", so the pane does not run long.
- 2026-11-05: The gradient flows as Slack's does: 4 OKLab stops, deepened and
  muted, in 3 layers; the module sidebar flows too. Every stop holds the text
  at AA.
- 2026-11-05: A solid theme's swatch is the flat frame color, not a split
  circle.
- 2026-11-05: Window themes are themes. The `window-theme` cookie, its
  validator, its root action branch and its loader field are gone. One
  "Theme" section lists color, gradient, solid and custom themes.
- 2026-11-03: The rail's hover and selected item are a translucent tile, as in
  Slack's rail. The highlight moves to the module sidebar's selected item.
- 2026-11-03: The module sidebar takes a `panel` tint, and the page tint is
  lighter, to match the 3 layers of the user's Slack screenshots. New gradient
  preset Tidewater, close to the user's Slack theme.
- 2026-11-03: The page takes a tint of the frame's hue, on the user's request.
  Review fixes: the rail logo follows the frame's tone, a color drag saves once,
  and closing the pane mid-drag saves the last color.
- 2026-11-03: Implemented on the branch. The AA test in
  `window-themes.test.ts` made 7 preset highlights darker. The browser check
  covered the ERP and the MES in light and dark mode. It also covered a
  gradient, a light frame, a custom theme, Default, a reload and a phone.
- 2026-11-03: Created. Autonomous run; the 6 resolutions above are assumed
  decisions for review at the PR.
