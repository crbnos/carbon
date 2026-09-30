paths:
  - "docs/content/changelog/**"
  - "docs/components/changelog-*.tsx"
  - "docs/lib/changelog*.ts*"
  - "docs/app/changelog/**"

# Authoring a changelog entry

One MDX file per dated entry in `docs/content/changelog/`, named
`YYYY-MM-DD-slug.mdx`. Carbon has no versions, so `date` is the ordering key and
the filename's date must match the frontmatter's.

The entry is read in **four** places, which is what constrains the format:

| Surface | Shows | Built by |
|---|---|---|
| `/changelog` feed | `title` + `description` + first 3 tags only | `changelog-feed.tsx` |
| `/changelog/<slug>` | the full body | `[slug]/page.tsx` |
| `/changelog/rss.xml` | `description` **and** the full body as HTML | `rss.xml/route.ts` |
| ERP "What's new" panel | `title` + `description` | `getChangelogPanelEntry` |

So `description` is not a summary you can skip — it is the whole feed row, the
newsletter blurb and the in-app toast.

## Frontmatter

```yaml
---
title: "Returns, operation batching, and the Carbon API"
description: "Customer RMAs and supplier returns, job operations that run as one batch, and the Carbon API over plain HTTP."
date: "2026-09-18"
tags: ["sales", "purchasing", "production"]
---
```

- **`title`** — names the things that shipped, not a slogan.
- **`description`** — **15–20 words, one or two clauses.** It is the entire feed
  row; a 40-word run-on is a wall there. Use `Plus …` to gather the tail
  (`"Draft an engineering change … Plus inventory valuation and assembly instructions."`).
- **`tags`** — most important first; the feed shows only the first three.
- **`image`** — optional hero, a path under `docs/public/changelog/`. Rendered above the
  title on both the feed row and the entry page, and it carries a shared
  `view-transition-name` so the card morphs between them.

## Thumbnails

**Generated, not hand-drawn.** `docs/scripts/generate-changelog-thumbnail.mjs` writes
`docs/public/changelog/<slug>.svg` for every entry and stamps `image:` into the
frontmatter when it is missing:

```bash
cd docs && pnpm generate:changelog-thumbnails          # all
cd docs && pnpm generate:changelog-thumbnails <slug>   # one
```

The motif is derived from the **title**: whichever motif keyword appears earliest wins,
since a changelog title leads with its headline feature ("Ramp card transactions, batch
materials, …" is a ledger entry, not a batching one). Layout detail is varied by a hash
of the slug, so entries sharing a motif differ, and a rerun is byte-identical.

House style, enforced by the primitives in that script: 1200×675, dark and flat. Field
`#09090B`, panel `#141518`, hairline `#26272B`, solid fills only. No gradients, no
shadows, no `fill-opacity`, no text, no logos, one `#00B0FF` accent per image. These
render at ~56% in the feed, so detail is lost and only clutter survives.

A literal version was tried once — real part numbers, work centres and status pills from
the demo dataset — and rejected: unreadable at feed scale and busy rather than
convincing. If you ever want true realism, screenshot the running app
(`pnpm db:seed:dev --dataset satellite` fills every screen) the way
`docs/public/screens/` was made, rather than drawing it.

**A new subject with no motif gets a new motif** in `MOTIFS` plus a drawing function —
never a hand-authored one-off SVG, or the set drifts out of style. Never draw a third
party's logo, and never use real tenant data.

## Body — concise, useful, linked

Modelled on Linear's and Commit's changelogs. The failure mode to avoid is what
these entries used to be: 100-word unbroken paragraphs, no links, no idea where
in the product the thing lives.

1. **Lead with why, then what** — one or two sentences before the first `##`.
   Name the problem, then the thing that solves it.
2. **One `##` per feature, 1–3 sentences.** Keep a paragraph under ~60 words. If
   it needs more, it wants a bullet list.
3. **Link the feature to its reference page on first mention.** There are ~94
   pages under `docs/content/docs/reference/` — check for one before writing a
   bare noun. `find docs/content/docs -name '*.mdx'` is the index.
4. **Say where it is** when the entry knows: `Automate → Workflows`,
   `Account → Notifications`. Do not invent a path you have not verified.
5. **State plan gating inline** — "available on the Business plan".
6. **`<Accordion title="Improvements">` / `"Fixes"` last**, one line per bullet.
   On the entry page these render expanded (`ChangelogSection`), not collapsed.

**Never invent a product fact to fill the shape.** An entry describes what
merged; if you cannot verify a detail, leave it out.

## Components available

An entry is ordinary MDX with the full editorial vocabulary — `Callout`,
`Screenshot`, `Steps`/`Step`, `Cards`/`Card`, `PlanBadge`, `Term`, `Figure`,
`Accordion`, code fences, tables.

**Every component an entry uses needs a plain-HTML stand-in in
`docs/lib/changelog-feed-components.tsx`.** Feed readers and mail clients run no
components. A component missing from that map renders `undefined` and **fails the
build** — deliberately, because a newsletter that silently drops a section is
worse than a red build. Adding a component to the vocabulary means adding its
degrade there in the same change.

Note `Callout` here is the Reference one — `{ type, title, children }` — not the
Guides variant with `tone`/`badge`.

## Checks before committing

```bash
pnpm --filter docs typecheck
curl -s localhost:3002/changelog/rss.xml | grep -c '<item>'   # every entry still renders
```

Every internal link must resolve — a `/docs/...` path with no matching file 404s
silently in the feed and the newsletter:

```bash
cd docs && for l in $(grep -oh "](/docs/[^)]*)" content/changelog/*.mdx \
  | sed 's|](/docs/||;s|)||' | sort -u); do
  [ -f "content/docs/$l.mdx" ] || [ -f "content/docs/$l/index.mdx" ] \
    || echo "MISSING $l"; done
```
