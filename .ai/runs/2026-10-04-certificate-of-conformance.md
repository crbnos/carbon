# Feature run: Certificate of Conformance

- Date: 2026-10-04
- Mode: fully autonomous
- Request: "/feature Certificate of Conformance"
- Scope: outbound CoC only. Carbon makes the certificate for a customer shipment. Inbound supplier CoCs are out of scope.

## Phase plan

| Phase | Run? | Reason |
|-------|------|--------|
| Research | Run | A CoC is quality and compliance logic. Carbon must not invent it. |
| Spec | Run | The feature adds a table, a PDF and a shipment change across modules. |
| Plan | Run | Mandatory. |
| Execute | Skip | The user said: "do not execute it just research etc." The run stops after the plan. |
| Test | Skip | The user verifies in the browser by hand. |
| Self-review | Skip | The user deselected it. |

## Decisions

| Gate | Decision | Who | Date |
|------|----------|-----|------|
| Scope change | Stop after the plan. Do not execute. | User | 2026-10-04 |
| Spec open questions Q2–Q11 | Resolved in autonomous mode. Each answer and its reason is in the spec. | Agent | 2026-10-04 |
| Spec open question Q1 | Add `customerShipping.certificateOfConformanceRequired`. Q1 is Ask-First, so the agent did not resolve it. | User: yes | 2026-10-04 |
| Plan approval | Not approved yet. The user must approve before `/execute`. | Pending | 2026-10-04 |

## Phase log

| Phase | Outcome | Artifact |
|-------|---------|----------|
| Research | Done. Four parallel agents covered SAP QM, job-shop ERPs, quality tools and standards, and the Carbon codebase. | `.ai/research/certificate-of-conformance.md` |
| Spec | Done. Planning corrected 4 facts: 11 template types, the preview banner, `renderToStream`, and the storage-path fallback. | `.ai/specs/2026-10-04-certificate-of-conformance.md` |
| Plan | Done. The plan has 16 tasks. Task 0 (the Q1 gate) is complete. | `.ai/plans/2026-10-04-certificate-of-conformance.md` |
| STE-80 | The agent rewrote the research, spec and plan. The agent did the STE-80 review pass on each file and on this record. | the 3 files above + this record |
| Execute | Not run, by user instruction. | none |

## Outcome

The run stopped after the plan, as the user asked. Next:

1. The user approves the plan.
2. Create the branch `naveen/certificate-of-conformance` from `main`.
3. Run `/execute` on the plan.
