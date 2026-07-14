# @carbon/config

Shared build configuration: Vitest preset, TypeScript configs, and Tailwind theme. No runtime code — purely tooling.

## Always

- Import vitest config via `@carbon/config/vitest` in package `vitest.config.ts` files.
- Extend the appropriate tsconfig: `base.json` (libraries), `react-library.json` (React packages), `vite.json` (Vite/React Router apps).
- Import the Tailwind theme via `@import "@carbon/config/tailwind/theme.css"` in app CSS — this loads plugins (animate, typography, scrollbar) and custom variants.

## Ask First

- Modifying `tailwind/theme.css` — affects all apps' visual appearance and utility classes.
- Changing tsconfig `compilerOptions` — affects type checking across all packages.
- Changing the Vitest base config — affects test behavior in every package.

## Never

- Add runtime application code here — this package is build/dev tooling only.
- Duplicate Tailwind plugin configuration in individual apps (it's centralized in `theme.css`).

## Validation Commands

```bash
pnpm --filter @carbon/config build   # Build vitest config
```

## Key Exports

| Subpath | Provides |
|---------|----------|
| `./vitest` | Base Vitest config (node env, v8 coverage, passWithNoTests) |
| `./tsconfig/base.json` | Base TS config for libraries |
| `./tsconfig/react-library.json` | TS config for React packages |
| `./tsconfig/vite.json` | TS config for Vite/React Router apps |
| `./tailwind/theme.css` | Tailwind v4 theme with plugins, custom variants (`dark`, `tall`, `hover`), and base resets |

## Cross-References

- `packages/env/` — runtime env configuration (not this package)
- Individual package `tsconfig.json` files extend configs from here
