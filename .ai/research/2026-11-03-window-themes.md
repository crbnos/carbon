# Window themes — how other apps color the app frame

> Date: 2026-11-03
> Feeds: `.ai/specs/2026-11-03-window-themes.md`

## Question

How do other work apps let a user color the frame of the app, as one color or
as a gradient? Which parts do they color, and which parts do they keep neutral?

This is a UI preference, not ERP domain logic. So the survey covers work apps
with theme pickers, not ERPs.

## Findings

| Product | What the user picks | What the theme colors | What stays neutral |
|---------|---------------------|------------------------|--------------------|
| Slack (desktop, 2026) | A preset from groups "Single color", "Vision assistive", "Fun and new", and gradient presets. Or a custom theme: "System navigation", "Selected items", "Presence indication", "Notifications", plus a "Window gradient" check box. | The window frame: the workspace rail, the channel sidebar, the top search bar. The gradient blends the window color with the selected-items color. | The message pane. Text in the message pane keeps the normal light or dark colors. |
| Discord (Nitro) | Gradient presets, applied over the whole client. | The full background of the client, including the chat area. | Nothing. Discord tints the chat area too. |
| Linear | A custom theme with a base color, an accent color and a contrast slider. | Every surface. Linear derives a full palette from the 3 inputs. | Nothing. |
| GitHub | Light and dark themes, plus color-blind variants. | Every surface. | Not applicable. |

Sources: the 3 Slack screenshots that the user attached on 2026-11-03 (the
Slack window, the preset grid, the custom-theme panel). The Discord, Linear and
GitHub rows come from product knowledge. This note did not check them again.

## What this means for Carbon

1. Slack colors only the frame. Carbon's shell already has the same shape: a
   frame (`SidebarProvider` with the `NavRail`) around a rounded content card.
   So Carbon can copy Slack's model with no change to page content.
2. Discord and Linear tint every surface. That changes the contrast of dense
   tables and forms, which are most of Carbon. Carbon does not copy that model.
3. Slack's custom theme has 4 colors. 2 of them (presence, notifications) set
   status colors. Carbon's status colors (`success`, `destructive`) carry
   meaning across the app, so Carbon does not let a user change them.
4. Slack keeps the preset colors the same in light mode and dark mode. Only the
   message pane follows the mode. Carbon can do the same: the frame color does
   not depend on the mode.
5. Slack picks the text color in the frame for contrast. A light preset gets
   dark text. Carbon must do the same, for presets and for custom colors.
