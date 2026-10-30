# UI Text Size and Density Research: Best Practices Survey

## Summary

A customer wants bigger text. We surveyed four apps that let the user change UI size: Linear, Discord, Claude and T3 Code. Each finding comes from the app's live bundle or its source, read on 2026-10-29. All four set the root font size from a short list of presets, with 16px as the default. Only Discord has a density control. Discord's density is separate from its text size, and it changes a small set of named spacing tokens through a class on the root element. Carbon uses Tailwind v4 with rem units, like T3 Code. So one root font-size value scales text and spacing together.

Note: the customer's request is about storage unit LABELS. Those are printed PDF and ZPL files. Their title size is fixed at 40 and scales only with the label dimensions (`packages/documents/src/pdf/StorageUnitLabelPDF.tsx:22`, `packages/documents/src/zpl/StorageUnitLabelZPL.tsx:20`). A UI text-size setting does not change printed labels. That fix is separate.

## Apps Surveyed

- **Linear**: one "Font size" setting with five presets. It has no density setting.
- **Discord**: separate controls for zoom, chat font, UI density and message display.
- **Claude**: zoom in the desktop app. The Code surface has a transcript text size.
- **T3 Code**: Tailwind v4 like Carbon. Its interface font size sets the root size. The source is public.

## Key Consensus Patterns

### 1. The root font size carries the text size

- **Linear**: writes `html { font-size: Npx }` from `user.settings.fontSize`. At Default it removes the inline value.
- **Discord**: writes `html { font-size: N% }` and adds a `font-size-<N>` class for layout corrections.
- **T3 Code**: writes `root.style.fontSize = "Npx"` (`apps/web/src/appearanceFonts.ts`).
- **Claude Code**: sets `data-chat-text-size` on the root element. CSS reads that attribute.
- **Rationale**: one value changes every rem size. No app uses CSS `zoom` or `transform` for text size.

### 2. The units decide what grows

- **Linear and Discord**: text is in rem. Most spacing is in px. So text grows and layout grows much less.
- **T3 Code**: Tailwind v4. `--spacing` is 0.25rem, so text and spacing grow together. The result is a zoom of the whole UI.
- **Rationale**: Carbon is in the same state as T3 Code. A Carbon text-size setting is in effect a UI scale.

### 3. Presets, not free values

- **Linear**: Smaller 14, Small 15, Default 16, Large 18, Larger 20 (px).
- **Discord**: chat font 12, 14, 15, 16, 18, 20, 24 px. Zoom 50% to 200%.
- **T3 Code**: interface size 12 to 20 px, default 16.
- **Claude**: transcript text size Small, Medium, Large.
- **Rationale**: a short list is easy to test and keeps layouts correct.

### 4. Density is a separate control, and only Discord has it

- **Discord**: UI Density has Compact, Default and Spacious. A class on the root element (`density-compact`, `density-default`, `density-cozy`) remaps `--space-xs` to `--space-xxl`. Default is 8/12/16/20/24/32 px. Compact is 6/10/12/16/20/26 px. Spacious is 10/16/20/24/30/40 px. The class also changes component tokens, for example `--guildbar-avatar-size`, `--custom-member-list-width` and row heights. Message density is a different setting.
- **Linear, Claude, T3 Code**: no user density control. T3 Code has a `density` prop on menus ("default", "touch"), but code sets it, not the user.
- **Rationale**: density needs named spacing tokens. Discord has them. Carbon does not have them.

### 5. Fixed-size surfaces opt out

- **T3 Code**: prompt and code sizes are in px, "to avoid double scaling".
- **Discord**: per-size classes correct layout details.

### 6. Storage

- Zoom is per device in all four apps.
- Text size is per device in Discord, Claude and T3 Code. It is per account in Linear.
- Discord syncs density to the account.

## Answers to Research Questions

1. **What do the apps change?** The root font size, from presets. Source: all four.
2. **Are scale and density separate?** Yes. Only Discord has density, and it is a separate control.
3. **Where is the choice stored?** Per device in three apps. Per account in Linear.
4. **Is it a slider or presets?** Presets, with 16px as the default.

## Carbon Today

- Theme tokens are Tailwind v4 defaults (`packages/config/tailwind/theme.css`): `--spacing` is 0.25rem and `--text-*` are in rem. A root font-size change scales nearly all of the UI.
- The mode and theme choices are cookies. The server renders them on `<html>` (`apps/erp/app/root.tsx:272`, `apps/erp/app/services/mode.server.ts`). A text-size cookie can use the same path, so the first paint has the correct size.
- About 220 fixed-px text classes, for example `text-[10px]` and `text-[11px]`, do not scale. Most are in `apps/erp/app/modules`. A script can change them to rem.
- About 640 fixed-px size and spacing classes exist. Most are popover widths and small marks. In those places px is acceptable.
- Two JS sizes are in px: `ESTIMATED_ROW_HEIGHT = 45` (`apps/erp/app/components/Table/Table.tsx:113`) and `itemHeight` in `PickerList` and `Combobox`. These must follow the scale.
- If `--spacing` changes, widths change too (for example `w-64` on the sidebar). So a global `--spacing` change is not density. It is another zoom.

## Recommended Approach for Carbon

1. **Text size first (Linear and T3 Code pattern).** Add the presets Smaller 14, Small 15, Default 16, Large 18 and Larger 20. Write the root `font-size` on `<html>` from a cookie, as mode does. Apply it in the ERP and the MES.
2. **Convert the fixed-px text classes to rem**, so all text scales. Make the JS row and item heights follow the root size.
3. **Do density later, and only on lists (Discord pattern).** Add named variables for table row height and cell padding. Set them from a class on the root element. Do not change the global `--spacing`.
4. **Fix the label font separately.** Fit the name to the label width, or add a font-size option to the label settings.

## Open Questions

1. Store the choice per device (cookie only), or per account (user setting, copied to a cookie)? Linear uses per account. The other three use per device.

## Sources

- https://linear.app/docs/account-preferences
- https://static.linear.app/client/assets/startup-entry.DUYxNDK-.js
- https://static.linear.app/client/assets/LoadApplicationLayout.CuiyI15e.js
- https://static.linear.app/client/assets/style-JrF8q3kv.css
- https://support.discord.com/hc/en-us/articles/207260127
- https://discord.com/blog/making-discord-on-desktop-look-just-right-display-settings-to-ease-the-eyes
- https://discord.com/assets/web.b2b84438f3c83e84.js
- https://github.com/BetterDiscord/BetterDiscord/blob/main/src/betterdiscord/modules/editor.ts
- https://support.claude.com/en/articles/8887527
- https://assets-proxy.anthropic.com/claude-ai/v2/assets/v1/cd19fedd2-CmyVOWju.js
- https://assets-proxy.anthropic.com/claude-ai/v2/assets/v1/shared-20-C-JG675x.js
- https://github.com/pingdotgg/t3code (commit 960d5761): `apps/web/src/appearanceFonts.ts`, `apps/web/src/appInit.tsx`, `packages/contracts/src/settings.ts`, `apps/desktop/src/main/DesktopWindow.ts`
