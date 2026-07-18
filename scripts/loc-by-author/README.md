# loc-by-author

Graphs lines of code contributed to a git branch by author over time.
Pure Python 3 (stdlib only) → self-contained interactive HTML chart.

## Run

```bash
python3 loc_by_author.py                        # new lines added per month on main
python3 loc_by_author.py --open                 # ...and open the result in your browser
python3 loc_by_author.py --metric net           # cumulative net lines instead
python3 loc_by_author.py --since "3 months ago" # scope to a date range
```

Output: `loc-by-author.html` (interactive: legend toggles, hover crosshair,
table view, dark-mode aware).

## Options

| Flag | Default | Meaning |
|------|---------|---------|
| `--branch` | `main` | branch to analyze |
| `--since` | – | only commits after this date (`"3 months ago"`, `2026-04-16`) |
| `--until` | – | only commits before this date |
| `--metric` | `monthly-additions` | `monthly-additions` (new lines added per month), `monthly` (net per month), `net` (cumulative adds−dels), `additions` (cumulative adds) |
| `--top N` | `7` | top N authors; the rest fold into "Other" |
| `--by` | `email` | group commits by `email` (merges aliases) or `name` |
| `--include-bots` | off | include bot/automation committers |
| `--no-merge-names` | off | don't auto-merge groups sharing a display name |
| `--aliases FILE` | – | JSON identity map (see below) |
| `--exclude GLOB` | – | extra path glob to exclude (repeatable) |
| `--out PATH` | `loc-by-author.html` | output file |
| `--open` | off | open the HTML when done |

## Notes on the numbers

- **Noise is excluded by default**: lockfiles, generated types
  (`packages/database/src/types.ts`, `**/generated/**`), minified/vendored files,
  and binaries. These dominate raw line counts and aren't hand-authored, so
  counting them makes the chart meaningless. Add more with `--exclude`.
- **Identity is messy.** Grouping by email merges name aliases; the tool also
  auto-merges groups that share a display name (e.g. one person, two emails).
  For cross-name aliases, pass `--aliases`:

  ```json
  {
    "Naveen Kashyap": ["naveenkash", "naveenkashyap243@gmail.com", "neilk17"],
    "Sid Gaikwad": ["sidgaikwad", "Sidwebworks"]
  }
  ```

  Tokens match either an email or an authored name (case-insensitive).
- **Metric matters a lot for ranking.** By *net* lines, heavy refactorers rank
  low or negative (Sidwebworks is net **−33k** — deletes more than adds), even
  with 380k additions. The default `monthly-additions` measures new lines written,
  which is usually what "contribution" means here.
- **AI coding agents count as authors.** `Carbon Agent` and `Claude` are treated
  as regular committers (they contribute real code); only pure CI/dependency bots
  (`fiber[bot]`, `dependabot`) are filtered. Use `--include-bots` to keep those too.
