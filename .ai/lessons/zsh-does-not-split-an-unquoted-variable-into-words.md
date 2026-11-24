---
paths: []
triggers: []
promoted: null
---
# zsh does not split an unquoted variable into words

**Context:** Running Biome on a list of changed files held in a shell variable (2026-10-16).

**Problem:** In zsh, `biome check $files` passes the whole list as ONE argument. Biome reported "File name too long" and "No files were processed", which reads as a Biome bug, not a shell one.

**Rule:** Pass file lists through `xargs` (`git diff --name-only | xargs biome check`) or use zsh's `${=files}`. Don't trust a tool error about a path until you have checked how the shell passed it.

**Applies to:** every Bash call in this environment (the login shell is zsh).
