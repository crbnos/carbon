# Brand integration — DEPRECATED (scaffold-era)

> This file described how the docs app was *first* stood up: baking `@carbon/config` theme tokens, Geist
> fonts, a `.dark` mode, Fumadocs `--color-fd-*` variable mapping, and a Tailwind-Typography `.prose`
> collision fix. **The shipped `docs` does none of that.**

The real app is **standalone and light-only**:

- **No `@carbon/react`, no ERP theme tokens, no Geist, no dark mode.** It uses **DM Sans** (body) + **Fira
  Code** (mono) and a **warm-paper palette** styled with **inline Tailwind arbitrary values**
  (`bg-[#FBFBF9]`, `text-[#262323]`, `border-[#E7E7E3]`, accent `#1E84B0`).
- Shiki maps both "light" and "dark" to `github-dark-default` precisely *because* there is no dark mode.
- The Carbon wordmark lockup is `docs/public/carbon-word-light.svg` (mark + "carbon"); the `*-light`
  assets are dark ink for the light background.

**Use instead:** `references/design-language.md` for the real palette/fonts/conventions, and the live
components in `docs/components/{editorial,api}/` as the source of truth. Ignore the
`@carbon/config`/Geist/dark-mode guidance that used to live here.
