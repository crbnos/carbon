# Factory OS X Brand Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Factory OS X shell, browser title, and favicon use the shared cyan `F` identity and the formal name `Factory OS X`.

**Architecture:** Keep branding local to the standalone Vite application. Add one static SVG mark and reference it from `index.html`; update only the existing shell brand markup and its existing CSS.

**Tech Stack:** TypeScript, Vite, HTML, CSS, Vitest

## Global Constraints

- Formal name is exactly `Factory OS X`.
- Mark is a `#00B8FF` rounded square with a bold uppercase `F` in `#09212A`.
- Do not change navigation, business behavior, APIs, data models, or layout dimensions.
- Target directory is not a Git repository; do not initialize Git or create a fake commit.

---

### Task 1: Factory OS X visible brand

**Files:**
- Create: `E:/6.Factory OS/Factory_OS_X_V15.11.3_Source/public/factory-os-mark.svg`
- Modify: `E:/6.Factory OS/Factory_OS_X_V15.11.3_Source/index.html`
- Modify: `E:/6.Factory OS/Factory_OS_X_V15.11.3_Source/src/app.ts`
- Modify: `E:/6.Factory OS/Factory_OS_X_V15.11.3_Source/src/styles.css`
- Test: `E:/6.Factory OS/Factory_OS_X_V15.11.3_Source/tests/brand.test.ts`

**Interfaces:**
- Consumes: existing `.brand`, `.brand-mark`, `.brand strong`, and `.brand small` selectors.
- Produces: one `/factory-os-mark.svg` browser icon and visible `Factory OS X` shell identity.

- [ ] **Step 1: Write the failing brand contract test**

Create `tests/brand.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Factory OS X branding", () => {
  it("uses the shared F mark and formal product name", () => {
    const html = readFileSync("index.html", "utf8");
    const app = readFileSync("src/app.ts", "utf8");
    const mark = readFileSync("public/factory-os-mark.svg", "utf8");

    expect(html).toContain('<link rel="icon" href="/factory-os-mark.svg"');
    expect(html).toContain("<title>Factory OS X V15.13.2</title>");
    expect(app).toContain('<span class="brand-mark" aria-hidden="true">F</span>');
    expect(app).toContain("<strong>Factory OS X</strong>");
    expect(mark).toContain('fill="#00B8FF"');
    expect(mark).toContain(">F</text>");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
pnpm vitest run tests/brand.test.ts
```

Expected: FAIL because `public/factory-os-mark.svg` does not exist and the old shell mark is `✦`.

- [ ] **Step 3: Add the canonical SVG mark**

Create `public/factory-os-mark.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-labelledby="title">
  <title>Factory OS</title>
  <rect width="64" height="64" rx="12" fill="#00B8FF"/>
  <text x="32" y="44" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="40" font-weight="800" fill="#09212A">F</text>
</svg>
```

- [ ] **Step 4: Update document metadata**

In `index.html`, add the favicon after the viewport meta and use exact metadata:

```html
<link rel="icon" type="image/svg+xml" href="/factory-os-mark.svg" />
<meta name="description" content="Factory OS X V15.13.2 企业智能操作系统" />
<title>Factory OS X V15.13.2</title>
```

- [ ] **Step 5: Update the shell brand without changing layout**

Replace the existing `.brand` line in `src/app.ts` with:

```html
<div class="brand"><span class="brand-mark" aria-hidden="true">F</span><div><strong>Factory OS X</strong><small>V15.13.2</small></div></div>
```

Keep the existing `40px × 40px`, `8px` radius and color declarations. Add only the deterministic type rule to `.brand-mark` in `src/styles.css`:

```css
font-family: Arial, Helvetica, sans-serif;
font-size: 20px;
line-height: 1;
```

- [ ] **Step 6: Run focused and project verification**

Run:

```powershell
pnpm vitest run tests/brand.test.ts
pnpm typecheck
pnpm build
```

Expected: brand test PASS, typecheck exits 0, build exits 0.

- [ ] **Step 7: Visually verify**

Run `pnpm dev`, open the local URL, and verify the sidebar displays the cyan `F`, `Factory OS X`, `V15.13.2`, and the browser tab uses the same mark. Check that navigation widths and wrapping are unchanged.

