---
name: changelog-entry
description: >-
  Write and ship a Carbon changelog entry end to end: ground it in what actually merged,
  write the MDX in the house format, generate its thumbnail, and verify the feed, the
  permalink and the RSS newsletter all still render. Use whenever someone asks to add,
  write, draft or publish a changelog entry, to "write up" a release or a batch of merged
  work, or to regenerate changelog thumbnails. Not for the docs Guide or Reference (use
  carbon-docs) and not for release notes that live outside docs/content/changelog.
---

# changelog-entry — write and ship a changelog entry

**Announce at start:** "Using the changelog-entry skill — writing {date} and generating its thumbnail."

The full conventions live in `.claude/rules/changelog-authoring.md`; read it first. This
skill is the workflow around them.

## The surfaces an entry feeds

One MDX file reaches four places, which is why the format is constrained:

| Surface | Shows |
|---|---|
| `/changelog` | `title` + `description` + first 3 tags + thumbnail |
| `/changelog/<slug>` | the full body |
| `/changelog/rss.xml` | `description` **and** the body as HTML |
| ERP "What's new" panel | `title` + `description` |

`description` is therefore not optional garnish — it is the entire feed row, the
newsletter blurb and the in-app toast.

## Workflow

### 1. Ground it — never write from the diff summary alone

Establish what actually shipped before writing a word:

```bash
git log --oneline <since>..main | cat
gh pr list --state merged --limit 40 --json number,title,mergedAt,labels
```

For each candidate feature, open the code or the reference page and confirm the claim.
**Never invent a product fact to fill the shape.** If you cannot verify a detail, leave
it out. An entry is a record of what merged, not a wish list.

### 2. Pick the date and slug

`docs/content/changelog/YYYY-MM-DD-slug.mdx`. Carbon has no versions, so `date` is the
ordering key and the filename's date must match the frontmatter's. Entries land roughly
every two weeks.

### 3. Write it

Frontmatter, then a lead, then one `##` per feature. The failure mode to avoid is the
100-word unbroken paragraph with no links — see the rule for the full format, but in short:

- `description` — **15–20 words**. It is the whole feed row.
- Lead with why, then what, in one or two sentences before the first `##`.
- One `##` per feature, 1–3 sentences, under ~60 words.
- **Link each feature to its reference page on first mention.** There are ~94 pages under
  `docs/content/docs/reference/`; check for one before writing a bare noun.
- Say where it lives (`Automate → Workflows`) only if you have verified the path.
- `<Accordion title="Improvements">` / `"Fixes"` last, one line per bullet.
- No em dashes.

### 4. Generate the thumbnail

```bash
cd docs && pnpm generate:changelog-thumbnails            # all entries
cd docs && pnpm generate:changelog-thumbnails <slug>     # just the new one
```

The motif is derived from the **title**: whichever motif keyword appears earliest wins,
because a changelog title leads with its headline feature. Layout detail is varied by a
hash of the slug, so two entries sharing a motif do not come out identical, and a rerun
is byte-identical. The script also stamps `image:` into the frontmatter when missing.

If a new entry's subject has no motif, add one to `MOTIFS` in
`docs/scripts/generate-changelog-thumbnail.mjs` alongside a drawing function — do not
hand-author a one-off SVG, or the set drifts out of the house style.

### 5. Verify — all four surfaces

```bash
cd docs
pnpm typecheck
curl -s localhost:3002/changelog/rss.xml | grep -c '<item>'   # every entry renders
```

Every internal link must resolve; a `/docs/...` path with no file 404s silently in the
feed *and* in the newsletter:

```bash
cd docs && for l in $(grep -oh "](/docs/[^)]*)" content/changelog/*.mdx \
  | sed 's|](/docs/||;s|)||' | sort -u); do
  [ -f "content/docs/$l.mdx" ] || [ -f "content/docs/$l/index.mdx" ] \
    || echo "MISSING $l"; done
```

Then look at `/changelog` and the permalink in a browser.

## Gotchas

- **Any MDX component an entry uses needs a plain-HTML stand-in** in
  `docs/lib/changelog-feed-components.tsx`. Feed readers run no components; one that is
  missing renders `undefined` and **fails the build**, deliberately — a newsletter that
  silently drops a section is worse than a red build.
- `Callout` here is the Reference one (`type`/`title`/`children`), not the Guides variant
  with `tone`/`badge`.
- The newsletter dispatcher reads the RSS feed, so a malformed entry reaches subscribers.
  Check the feed before considering the entry done.
- Nothing sends `carbon/changelog-dispatch` automatically; publishing the entry is not
  the same as sending the newsletter.
