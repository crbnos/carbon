# Templates — DEPRECATED (scaffold-era, NOT used by the shipped docs)

> These files were starting points from when `docs` was first scaffolded. **The shipped docs use none
> of them.** They assume things that aren't true of the real app (Geist fonts, a `.dark` mode, `@carbon`
> theme tokens, React 18, and "signature-touch" components like a reading-progress ruler / scroll-reveal /
> chapter-rail / feature-callout / interactive checklist). Treat everything here as historical only.

**What the real docs actually use:**

- **Guide MDX components** (`docs/components/editorial/mdx.tsx`): `Figure`, `Screenshot`, `Callout`
  (`tone`+`badge`), `Divider`. Illustration keys live in `components/editorial/illustrations.tsx`.
- **Reference MDX components** (`docs/components/editorial/reference-components.tsx` + `components/mdx.tsx`):
  `Callout` (`type`), `Card`/`Cards`, `EnvVar`/`EnvVars`, `Steps`/`Tabs`.
- **Styling:** inline Tailwind arbitrary values, warm-paper palette, DM Sans + Fira Code, **light-only**.
- **The flow reader** (`components/editorial/{guide-context,guide-subnav,sidebar-nav,how-to-layout}.tsx`)
  drives the Guide's flow-switcher + scoped sidebar + View-Transitions crossfade.

**Use instead:** `references/components.md`, `references/design-language.md`, and the live components above.
The `components/*.tsx` files in this folder remain only as historical scaffolding artifacts.
