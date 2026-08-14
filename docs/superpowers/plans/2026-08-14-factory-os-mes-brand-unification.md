# Factory OS MES Brand Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace user-visible Carbon branding in the MES application with the shared cyan `F` identity and the formal name `Factory OS MES`.

**Architecture:** Add an app-local branding module so MES does not change shared Carbon utilities or ERP assets. The module supplies the formal name, favicon links, and reusable mark/wordmark components; existing login and public layout routes consume it.

**Tech Stack:** React, TypeScript, React Router, Vitest, SVG/PNG static assets

## Global Constraints

- Formal name is exactly `Factory OS MES`.
- Mark is a `#00B8FF` rounded square with a bold uppercase `F` in `#09212A`.
- Do not rename Carbon packages, environment variables, routes, APIs, authentication logic, or database objects.
- Preserve unrelated dirty files in the Carbon worktree.

---

### Task 1: MES branding module and visible surfaces

**Files:**
- Create: `apps/mes/app/branding.tsx`
- Create: `apps/mes/app/branding.test.tsx`
- Create: `apps/mes/public/factory-os-mark.svg`
- Modify: `apps/mes/app/root.tsx`
- Modify: `apps/mes/app/routes/_public+/_layout.tsx`
- Modify: `apps/mes/app/routes/_public+/login.tsx`
- Modify: `apps/mes/public/site.webmanifest`

**Interfaces:**
- Produces: `FACTORY_OS_MES_NAME`, `factoryOsMesFaviconLinks`, `FactoryOsMark`, and `FactoryOsMesWordmark` from `~/branding`.
- Consumes: existing React components and Tailwind utility classes only.

- [ ] **Step 1: Write the failing branding test**

Create `apps/mes/app/branding.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  FACTORY_OS_MES_NAME,
  FactoryOsMark,
  FactoryOsMesWordmark,
  factoryOsMesFaviconLinks
} from "./branding";

describe("Factory OS MES branding", () => {
  it("exposes one formal name and shared F mark", () => {
    expect(FACTORY_OS_MES_NAME).toBe("Factory OS MES");
    expect(factoryOsMesFaviconLinks).toContainEqual({
      rel: "icon",
      type: "image/svg+xml",
      href: "/factory-os-mark.svg"
    });
    expect(renderToStaticMarkup(<FactoryOsMark />)).toContain(">F<");
    expect(renderToStaticMarkup(<FactoryOsMesWordmark />)).toContain(
      "Factory OS MES"
    );
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
pnpm --filter mes test -- app/branding.test.tsx
```

Expected: FAIL because `./branding` does not exist.

- [ ] **Step 3: Implement the app-local brand module**

Create `apps/mes/app/branding.tsx` with:

```tsx
import { cn } from "@carbon/react";
import type { ComponentProps } from "react";

export const FACTORY_OS_MES_NAME = "Factory OS MES";

export const factoryOsMesFaviconLinks = [
  { rel: "icon", type: "image/svg+xml", href: "/factory-os-mark.svg" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
  { rel: "manifest", href: "/site.webmanifest" }
];

export function FactoryOsMark({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      aria-label="Factory OS"
      className={cn(
        "inline-grid aspect-square place-items-center rounded-[18.75%] bg-[#00B8FF] font-sans font-extrabold leading-none text-[#09212A]",
        className
      )}
      {...props}
    >
      F
    </span>
  );
}

export function FactoryOsMesWordmark({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-3", className)} aria-label={FACTORY_OS_MES_NAME}>
      <FactoryOsMark className="size-10 text-xl" aria-hidden="true" />
      <span className="text-xl font-semibold tracking-tight">{FACTORY_OS_MES_NAME}</span>
    </div>
  );
}
```

- [ ] **Step 4: Add the canonical SVG asset**

Create `apps/mes/public/factory-os-mark.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-labelledby="title">
  <title>Factory OS</title>
  <rect width="64" height="64" rx="12" fill="#00B8FF"/>
  <text x="32" y="44" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="40" font-weight="800" fill="#09212A">F</text>
</svg>
```

- [ ] **Step 5: Replace root metadata and favicon links**

In `apps/mes/app/root.tsx`, remove the `@carbon/utils/favicon` import, import `FACTORY_OS_MES_NAME` and `factoryOsMesFaviconLinks` from `~/branding`, spread the local links, and return:

```ts
export const meta: MetaFunction = () => [{ title: FACTORY_OS_MES_NAME }];
```

- [ ] **Step 6: Replace public-layout and login branding**

In `_public+/_layout.tsx`, replace both Carbon wordmark images with:

```tsx
<FactoryOsMesWordmark
  className={cn("relative z-50", CONTROLLED_ENVIRONMENT && "grayscale")}
/>
```

In `_public+/login.tsx`, change its meta title to `Factory OS MES | Login` and replace the two Carbon mark images with:

```tsx
{CONTROLLED_ENVIRONMENT ? (
  <img src="/flag.png" alt="Controlled environment" className="w-24 grayscale" />
) : (
  <FactoryOsMark className="size-24 text-5xl" />
)}
```

- [ ] **Step 7: Update the web manifest**

Set `apps/mes/public/site.webmanifest` to:

```json
{
  "name": "Factory OS MES",
  "short_name": "Factory OS MES",
  "icons": [
    {
      "src": "/factory-os-mark.svg",
      "type": "image/svg+xml",
      "sizes": "any"
    }
  ],
  "theme_color": "#00B8FF",
  "background_color": "#ffffff",
  "display": "standalone"
}
```

Keep the existing Apple touch icon for compatibility until a deterministic PNG is rendered from the canonical SVG in Task 2.

- [ ] **Step 8: Run focused tests and type checking**

Run:

```powershell
pnpm --filter mes test -- app/branding.test.tsx
pnpm --filter mes typecheck
pnpm --filter mes build
```

Expected: test PASS, typecheck exits 0, build exits 0.

- [ ] **Step 9: Commit only MES task files**

```powershell
git add -- apps/mes/app/branding.tsx apps/mes/app/branding.test.tsx apps/mes/app/root.tsx 'apps/mes/app/routes/_public+/_layout.tsx' 'apps/mes/app/routes/_public+/login.tsx' apps/mes/public/factory-os-mark.svg apps/mes/public/site.webmanifest
git commit -m "feat(mes): unify Factory OS branding"
```

### Task 2: MES raster icon set

**Files:**
- Modify: `apps/mes/public/apple-touch-icon.png`
- Modify: `apps/mes/public/icons/16.png`
- Modify: `apps/mes/public/icons/20.png`
- Modify: `apps/mes/public/icons/29.png`
- Modify: `apps/mes/public/icons/32.png`
- Modify: `apps/mes/public/icons/40.png`
- Modify: `apps/mes/public/icons/50.png`
- Modify: `apps/mes/public/icons/57.png`
- Modify: `apps/mes/public/icons/58.png`
- Modify: `apps/mes/public/icons/60.png`
- Modify: `apps/mes/public/icons/64.png`
- Modify: `apps/mes/public/icons/72.png`
- Modify: `apps/mes/public/icons/76.png`
- Modify: `apps/mes/public/icons/80.png`
- Modify: `apps/mes/public/icons/87.png`
- Modify: `apps/mes/public/icons/100.png`
- Modify: `apps/mes/public/icons/114.png`
- Modify: `apps/mes/public/icons/120.png`
- Modify: `apps/mes/public/icons/128.png`
- Modify: `apps/mes/public/icons/144.png`
- Modify: `apps/mes/public/icons/152.png`
- Modify: `apps/mes/public/icons/167.png`
- Modify: `apps/mes/public/icons/180.png`
- Modify: `apps/mes/public/icons/192.png`
- Modify: `apps/mes/public/icons/256.png`
- Modify: `apps/mes/public/icons/512.png`
- Modify: `apps/mes/public/icons/1024.png`

**Interfaces:**
- Consumes: `apps/mes/public/factory-os-mark.svg` from Task 1.
- Produces: deterministic square PNG exports for legacy/PWA consumers.

- [ ] **Step 1: Render PNGs from the canonical SVG**

Use the repository's existing `sharp` dependency from the root. Run:

```powershell
@'
import sharp from "sharp";
const sizes = [16, 20, 29, 32, 40, 50, 57, 58, 60, 64, 72, 76, 80, 87, 100, 114, 120, 128, 144, 152, 167, 180, 192, 256, 512, 1024];
const source = "apps/mes/public/factory-os-mark.svg";
await Promise.all(sizes.map((size) =>
  sharp(source).resize(size, size).png().toFile(`apps/mes/public/icons/${size}.png`)
));
await sharp(source).resize(180, 180).png().toFile("apps/mes/public/apple-touch-icon.png");
'@ | node --input-type=module -
```

Do not edit any other public images.

- [ ] **Step 2: Verify dimensions and colors**

Run:

```powershell
@'
import sharp from "sharp";
const sizes = [16, 20, 29, 32, 40, 50, 57, 58, 60, 64, 72, 76, 80, 87, 100, 114, 120, 128, 144, 152, 167, 180, 192, 256, 512, 1024];
for (const size of sizes) {
  const meta = await sharp(`apps/mes/public/icons/${size}.png`).metadata();
  if (meta.width !== size || meta.height !== size) throw new Error(`bad ${size}px icon`);
}
const apple = await sharp("apps/mes/public/apple-touch-icon.png").metadata();
if (apple.width !== 180 || apple.height !== 180) throw new Error("bad Apple touch icon");
console.log(`verified ${sizes.length + 1} raster icons`);
'@ | node --input-type=module -
```

Expected: `verified 27 raster icons`.

- [ ] **Step 3: Re-run MES build and visually verify**

Run `pnpm --filter mes build`, then inspect login, authenticated MES, browser favicon, and installed/PWA metadata in light and dark mode. Expected visible name: `Factory OS MES`; expected mark: cyan square `F`; no user-visible Carbon logo remains on these surfaces.

- [ ] **Step 4: Commit only raster assets**

```powershell
git add -- apps/mes/public/apple-touch-icon.png apps/mes/public/icons
git commit -m "chore(mes): regenerate Factory OS app icons"
```
