---
paths: ["packages/utils/src/avatar.ts", "packages/react/src/utils/generatedAvatar.ts", "packages/react/package.json"]
triggers: ["@dicebear", "GENERATED_AVATAR_STYLES", "STYLE_LOADERS"]
promoted: null
---
# A generated avatar is a seed, so the library version decides the face

**Context:** `user.avatarUrl` stores a generated avatar as `dicebear:<style>:<seed>[:<rrggbb>]` (`packages/utils/src/avatar.ts`). The browser draws it with DiceBear every time it renders (`packages/react/src/utils/generatedAvatar.ts`). Nothing about the picture is stored, only the seed.

**Problem:** A new DiceBear major version can draw a different face for the same seed. The move from version 9 to 10 (2026-10-08) changed every existing avatar, and nothing in the database showed it. A style removed from `GENERATED_AVATAR_STYLES` makes its stored values unparseable, so those avatars fall back to initials without an error.

**Rule:** Pin `@dicebear/core` and `@dicebear/styles` to exact versions, never a range. Treat a DiceBear upgrade as "every user's avatar may change", and compare renders of fixed seeds before and after. Only add to `GENERATED_AVATAR_STYLES`; the `Record` type of `STYLE_LOADERS` makes a style without a loader a type error.

**Applies to:** `packages/react/package.json` (DiceBear versions), `packages/utils/src/avatar.ts`, `packages/react/src/utils/generatedAvatar.ts`.
