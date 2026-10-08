# Archived specs

Specs that were **superseded before being implemented**. They stay in git for the
design history and the decisions they record, but they are not the design of record.

- A spec lands here when a newer spec replaces its scope (in whole, or the part that
  mattered). Partially superseded specs that still own live scope stay in `.ai/specs/`
  with a scope note pointing at the replacement.
- Every file here carries a `> Superseded by:` line under its header naming the
  replacement spec(s) and the date.
- Implemented specs go to `.ai/specs/implemented/`, never here.
- Do not cite an archived spec as precedent for a new design; cite the replacement.
