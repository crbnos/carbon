# Docs-site changelog (docs.carbon.ms/changelog)

Decision (researched 2026-09-04): Carbon deploys continuously with no versions/tags, so the
changelog is **date-based**, published as a third Fumadocs collection on the existing docs
site. No changesets/release-please/tagging, no new hosting — the docs Vercel Git integration
deploys it on merge to `main`. Pattern matches Supabase/Vercel/GitHub (dated feed + RSS) and
the official Fumadocs blog recipe.

## Design

- One MDX file per entry at `docs/content/changelog/YYYY-MM-DD-slug.mdx`, frontmatter
  `{ title, description, date, tags? }`. Entries are curated + user-facing (drafted from
  merged `feat:`/`fix:` PRs, then edited), never commit dumps.
- `/changelog` renders the full feed inline, newest first (Supabase-style scannable feed);
  `/changelog/[slug]` is the permalink per entry. `/changelog/rss.xml` is the feed.
- Uses the existing MainHeader (new "Changelog" nav item) + reference-surface styling.

## Tasks

- [x] 1. `docs/source.config.ts` — add `changelog` collection (`content/changelog`,
      pageSchema + `date` + optional `tags`).
- [x] 2. `docs/lib/source.ts` — export `changelogSource` (baseUrl `/changelog`) +
      a date-sorted `getChangelogEntries()` helper.
- [x] 3. Routes:
      - `docs/app/changelog/layout.tsx` — MainHeader (active `changelog`) + footer chrome.
      - `docs/app/changelog/page.tsx` — feed page, full MDX bodies inline, anchor per entry.
      - `docs/app/changelog/[slug]/page.tsx` — permalink page, `generateStaticParams`.
      - `docs/app/changelog/rss.xml/route.ts` — static RSS 2.0 from the collection.
- [x] 4. Nav: add "Changelog" to `NAV` in both `components/main-header.tsx` and
      `components/mobile-nav.tsx` (duplicated consts, both must change).
- [x] 5. SEO: entries + index in `app/sitemap.ts`; `pageSeo` metadata; RSS `<link>`
      alternate on the changelog surface.
- [x] 6. First entry drafted from merged PRs since mid-August (curated, grounded).
- [x] 7. Verify: `pnpm --filter docs build` green (safe here — isolated Conductor
      worktree, no dev server on 3002); internal links resolve.

## Follow-up (2026-09-05): Linear-style feed UI

- [x] Feed restyled after linear.app/changelog, in the warm-paper language: per-entry
      grid with a sticky date+tags rail on the left (`md:grid-cols-[9.5rem_minmax(0,1fr)]`),
      27px demi title, optional hero image, prose right column; rail collapses to a row
      above the title on mobile. Container widened to `max-w-225`.
- [x] `image` frontmatter (optional, path under `/public`) added to the collection schema;
      rendered as a rounded, hairline-bordered hero on both the feed and permalink pages.
- [x] Verified: build green, grid/sticky/title utilities present in built CSS.

## Out of scope (later, optional)

- ERP HelpMenu "What's new" link (`apps/erp/app/utils/path.ts` + `HelpMenu.tsx`).
- Mirroring entries to GitHub Releases/Discussions.
- A `/changelog-draft` helper that drafts an entry from `gh pr list --search "merged:>DATE"`.
