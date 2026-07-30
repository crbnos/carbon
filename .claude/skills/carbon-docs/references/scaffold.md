# Phase 1 — Scaffold `docs` (Next.js + Fumadocs)

> **Historical — `docs` already exists.** You will almost never re-run this; it's the record of how
> the app was first stood up (Next.js + Fumadocs, React 19 pinned, pnpm/Biome). For *authoring or editing*
> docs, ignore this and start from `SKILL.md`. The decisions here are mostly still accurate, but the live
> app is the source of truth — don't re-scaffold over it.

Goal: a new app at `docs` that builds with the monorepo's tooling and renders one Guide page and
one Reference page. Get this thin slice working before doing anything else.

> Carbon has no Next.js app yet — this is the first. That's intentional and already anticipated:
> `@carbon/config` exports a ready `./tsconfig/nextjs.json`, and `turbo.json` already lists `.next/**`
> as a build output. You're filling in an expected slot, not fighting the monorepo.

## Step 1 — Decide the React/Next/Fumadocs version line (do this consciously)

The catalog pins `react@18.3.1` / `react-dom@18.3.1`, and `@carbon/react` peer-depends on React 18.
**Always check the current Fumadocs peer deps first** — it moves fast and dictates the path:

```bash
npm view fumadocs-ui version peerDependencies
npm view fumadocs-core peerDependencies
```

As of this writing, current Fumadocs (16.x) **hard-requires `react@^19.2` + `next@16` + `zod@4`** — so
the older "stay on React 18" path is not available with current Fumadocs. Pick one path and write down why:

- **Path B (the realistic default today): React 19, isolated.** Pin the docs app's own `react@^19.2`,
  `react-dom@^19.2`, `next@^16`, `fumadocs-*@latest`, and `zod@^4` in its `package.json` (NOT the
  catalog — the catalog stays on React 18 / zod 3 for the rest of the repo). Treat the docs app as
  isolated: consume only Carbon's **CSS tokens and fonts** (`theme.css` + `non.geist` — both pure CSS,
  no React), and do **not** import `@carbon/react` React components (its React-18 peer would clash).
  The bundled bespoke components only use Tailwind + framer-motion, so they run fine on React 19. Use a
  React-19-compatible `framer-motion` (v12+) or the `motion` package, pinned in the docs app.
- **Path A (only if you must reuse `@carbon/react` components): pin an older Fumadocs line** that still
  supports React 18, and add `react`/`react-dom` as `catalog:`. This trades away current Fumadocs
  features and ages out quickly — avoid unless there's a hard requirement to import Carbon's React
  components into MDX.

Because of the isolation in Path B, the workspace ends up with two React majors (18 for the apps, 19 for
docs). pnpm handles this fine — each package resolves its own. Note the split in your summary so nobody
is surprised. Also note `pnpm-workspace.yaml` sets `minimumReleaseAge` (a few days); brand-new Next/
Fumadocs releases may be blocked until they age in — pin to a slightly older patch if install refuses.

## Step 2 — Create the app skeleton

You can either run `pnpm create fumadocs-app` inside `apps/` and then reconcile it to the conventions
below, or hand-create the files. Either way the result must match this layout:

```
docs/
├── package.json
├── tsconfig.json
├── next.config.mjs
├── postcss.config.mjs
├── source.config.ts            # Fumadocs MDX source definition
├── mdx-components.tsx           # global MDX component map (built-ins + Carbon bespoke)
├── app/
│   ├── layout.tsx               # root: html, fonts, theme provider, global.css
│   ├── global.css               # ← copy assets/templates/global.css
│   ├── (home)/                  # optional editorial landing
│   ├── docs/
│   │   ├── layout.tsx           # DocsLayout (sidebar, search, nav)
│   │   └── [[...slug]]/page.tsx # renders an MDX page
│   └── api/search/route.ts      # search index endpoint
├── content/
│   └── docs/
│       ├── index.mdx            # Reference landing
│       ├── meta.json            # nav order (see information-architecture.md)
│       └── guide/               # editorial Guide chapters
│           ├── meta.json
│           └── build.mdx
├── lib/
│   └── source.ts                # loader() over content/docs
└── components/                  # ← copy assets/templates/components/*
```

## Step 3 — `package.json`

Use `workspace:*` for Carbon packages and `catalog:` for shared deps (matches `apps/starter`). Pin the
Fumadocs/Next versions to current stable at scaffold time.

```jsonc
{
  "name": "docs",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3002",          // pick an unused port: erp=3000 mes=3001 starter=4000 academy=4111
    "build": "next build",
    "start": "next start -p 3002",
    "postinstall": "fumadocs-mdx",       // generates the .source types
    "lint": "biome lint --write",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "fumadocs-core": "^16",
    "fumadocs-mdx": "^15",
    "fumadocs-ui": "^16",
    "next": "^16",
    "non.geist": "catalog:",              // pure CSS — safe to share from the catalog
    "framer-motion": "^12",               // v12+ for React 19 (powers scroll-reveal + progress)
    "react": "^19.2",                     // PINNED here, NOT catalog (repo stays on React 18)
    "react-dom": "^19.2",
    "zod": "^4"                           // fumadocs-core peers zod 4 (repo catalog is zod 3)
  },
  "devDependencies": {
    "@carbon/config": "workspace:*",
    "@tailwindcss/postcss": "^4",          // Next uses the PostCSS plugin, NOT @tailwindcss/vite
    "@tailwindcss/typography": "catalog:", // theme.css @plugins these four — must be installed
    "@types/mdx": "^2",                    // REQUIRED — mdx-components.tsx imports `mdx/types`
    "@types/node": "^22",
    "@types/react": "^19",                 // React 19 types — NOT catalog (catalog is 18)
    "@types/react-dom": "^19",
    "tailwindcss": "catalog:",
    "tailwindcss-animate": "catalog:",
    "tailwind-scrollbar": "catalog:",
    "tailwind-scrollbar-hide": "catalog:",
    "typescript": "catalog:"
  }
}
```

> Two non-obvious requirements, both learned by building this for real:
> - **`@types/mdx`** is a Fumadocs peer the generated `mdx-components.tsx` relies on
>   (`import type { MDXComponents } from "mdx/types"`). Omit it and `next build` fails type-check with
>   *"Cannot find module 'mdx/types'"* even though it compiles.
> - **React/`@types/react` must be pinned to 19**, not `catalog:` — the catalog is React 18 for the rest
>   of the repo. pnpm happily keeps both majors; verify the other apps still resolve `react@18` after
>   `pnpm install` (`pnpm --filter erp ls react`).

> `@carbon/config/tailwind/theme.css` begins with `@plugin "tailwindcss-animate"`,
> `@plugin "@tailwindcss/typography"`, `@plugin "tailwind-scrollbar"`, and `@plugin
> "tailwind-scrollbar-hide"`. Those packages must be resolvable from the docs app or the CSS import
> fails at build — hence the four devDeps above (all already in the catalog).

Notes:
- `tailwindcss@4.3.0` is in the catalog. Tailwind v4 in Next is wired through **`@tailwindcss/postcss`**
  (a PostCSS plugin), unlike the Vite apps which use `@tailwindcss/vite`. Add `@tailwindcss/postcss` to
  the catalog in `pnpm-workspace.yaml` if it isn't there yet (it's part of the same `4.3.0` line).
- Don't add `react`/`react-dom`/`framer-motion`/`non.geist` versions inline — reference `catalog:` so
  the docs app moves with the repo.

## Step 4 — `tsconfig.json`

Extend the prepared Next config and use the `@/*` alias Fumadocs expects:

```jsonc
{
  "extends": "@carbon/config/tsconfig/nextjs.json",
  "compilerOptions": {
    "paths": { "@/*": ["./*"] },
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts", ".source/**/*"],
  "exclude": ["node_modules"]
}
```

## Step 5 — PostCSS + Next config

`postcss.config.mjs`:
```js
export default { plugins: { "@tailwindcss/postcss": {} } };
```

`next.config.mjs` — wrap with the Fumadocs MDX plugin:
```js
import { createMDX } from "fumadocs-mdx/next";
const withMDX = createMDX();
/** @type {import('next').NextConfig} */
const config = { reactStrictMode: true };
export default withMDX(config);
```

## Step 6 — Fumadocs source + global styles

- `source.config.ts`, `lib/source.ts`, `mdx-components.tsx`, `app/layout.tsx`, `app/docs/layout.tsx`,
  and `app/docs/[[...slug]]/page.tsx` follow the standard Fumadocs App Router setup — generate them
  with `pnpm create fumadocs-app` or from the current Fumadocs docs, then apply the Carbon brand wiring
  in `references/brand-integration.md`.
- **`app/global.css` is the load-bearing file.** Copy `assets/templates/global.css` verbatim — it
  imports Tailwind, the Geist fonts, Carbon's `theme.css`, the Fumadocs UI CSS, bakes in the default
  theme's light/dark HSL values, and maps Fumadocs' `--color-fd-*` variables onto Carbon tokens. This
  is what makes a fresh Fumadocs install look like Carbon instead of like the Fumadocs demo.

## Step 7 — Wire into the monorepo

- **Workspace:** `docs` is listed explicitly in `pnpm-workspace.yaml` (it lives at the repo root, outside `apps/*`).
  Run `pnpm install` from the root so workspace links resolve.
- **Turbo:** nothing to add — the generic `dev` and `build` tasks run the app's scripts, and `.next/**`
  is already an output. Confirm with `pnpm --filter docs dev`.
- **Biome:** inherits the root `biome.jsonc`. Don't add a local linter config.
- **Optional root script:** add `"dev:docs": "turbo run dev --filter=docs"` to the root `package.json`
  to match the `dev:erp` / `dev:academy` ergonomics.

## Step 8 — Confirm the slice

```bash
pnpm install
pnpm --filter docs dev      # serves on the port you chose
pnpm --filter docs build    # must complete clean before you scale out
```

Load the dev server, confirm one Guide page and one Reference page render with Geist fonts and the
Carbon palette in both light and dark mode. Only then move on.

## Deployment (follow-up, not part of the first slice)

Carbon deploys via **SST** (`sst.config.ts` at root → AWS), with domains following `<app>.<infix>` and
docs naturally mapping to `docs.carbon.ms`. Adding the docs app to SST (a Next component pointing at
`docs`, with the domain) is a deliberate follow-up step — don't block the first render on it.
Mirror how `erp`/`mes` are declared in `sst.config.ts`. Confirm with the user before touching
deployment infra, since it's outward-facing.
