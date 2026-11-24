---
paths: ["packages/react/src/Avatar.tsx", "packages/react/src/GeneratedAvatar.tsx", "packages/react/src/NavRail.tsx", "packages/react/src/utils/generatedAvatar*.ts", "packages/react/package.json"]
triggers: ["@dicebear/core"]
promoted: null
---
# A library that every page renders must not be imported statically

**Context:** `Avatar` (`@carbon/react`) is in the shell of every app. It renders generated avatars with `@dicebear/core`.

**Problem:** A static `import { Avatar, Style } from "@dicebear/core"` put about 156 KB minified (25 KB gzipped) into the main bundle of the ERP, MES and academy, on every page, whether or not a generated avatar was shown (found in self-review, 2026-10-08). Typecheck, tests and Biome all passed. Only a bundle measurement showed it.

**Rule:** In a component that every page renders, import a heavy library with `import()` at the point of first use, and keep only `import type` at the top of the file. Check with a split bundle: `npx esbuild <file> --bundle --splitting --format=esm --minify --outdir=/tmp/out '--external:@carbon/*' --external:react`. The entry file must stay small, and the library must be a separate chunk.

**Applies to:** `packages/react/src/**` components used in app shells (`Avatar`, `NavRail`, layout parts); any new dependency of `@carbon/react`.
