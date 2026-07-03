# Attribution

## Open Mercato

Several workflow patterns in `.ai/` are inspired by or adapted from
[Open Mercato](https://github.com/open-mercato/open-mercato), an open-source
AI-Engineering Foundation Framework.

**License:** MIT License
**Copyright:** (c) 2025-2026 Open Mercato contributors

### Patterns adapted:

- **`.ai/` directory structure** — centralized AI knowledge base with specs, skills,
  rules, lessons, and scripts
- **Skill installation** (`install-skills.sh`) — multi-harness symlink installer
- **`root-cause` skill** — read-only bug analysis with structured brief output
- **`fix` skill** — minimal change implementation with mandatory regression tests
- **`check-and-commit` skill** — pre-commit verification gate
- **`create-agents-md` skill** — consistent AGENTS.md generation from code
- **`spec-writing` skill** — spec writing with Open Questions hard gate
- **Task Router pattern** — root AGENTS.md as a dispatch table to package/module guides
- **Always / Ask First / Never** template — behavioral contracts at every AGENTS.md level
- **Lessons format** — `Context → Problem → Rule → Applies to` prescriptive format

### MIT License text:

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
