# Research Task: Fixed Asset Journal Entries — Purchase & Sale

**Objective:** Research-only. No code changes.

## Context

Carbon is building a fixed asset selling flow. After merging PR #1155, a "failed to create sales order line" error appeared. We also need to understand correct accounting treatment.

## Questions to Answer

### 1. Industry Best Practices: Journal Entries

What are the standard journal entries (per GAAP/IFRS) when:

**a) Purchasing a Fixed Asset:**
- At receipt (GR): What hits? Asset account, GR/IR clearing, etc.
- At invoice (AP): What hits? How does it reconcile to receipt?

**b) Selling a Fixed Asset:**
- At shipment: What hits? Remove asset from books, recognize disposal
- At invoice (AR): Revenue side — what hits?
- How is gain/loss on disposal calculated and where does it land?

### 2. Carbon Codebase Research

Look at the following areas in `/home/openclaw/carbon`:

**a) Fixed Asset module:**
- `packages/database/` — find the fixed asset schema (migrations or types)
- Find the `fixedAsset` service file(s) — likely `*.service.ts` with fixedAsset in name
- Find the models file — `fixedAsset.models.ts` or similar
- What fields does a fixed asset have? Especially: net book value (NBV), accumulated depreciation, original cost, etc.

**b) Sales Order / Sales Order Line:**
- Find `salesOrder` or `salesOrderLine` service/models
- What does a sales order line creation look like? What fields are required?
- Why might creation fail after PR #1155? Look at what PR #1155 changed (check git log or the files it touched)

**c) Journal Entry / Accounting module:**
- Find how journal entries are currently generated (look for `journalEntry` or similar in services)
- For purchasing: how does a receipt + AP invoice generate journal entries today?
- For selling: what accounting hooks exist (if any) for sales order shipment + AR invoice?

**d) PR #1155 diff:**
- `cd /home/openclaw/carbon && git log --oneline | head -20` to find the merge commit
- `git show <commit> --stat` to see what files changed
- Understand what the PR did and why it might have broken sales order line creation

### 3. Gap Analysis

Based on what you find:
- What journal entries does Carbon currently generate for fixed asset purchase vs. what GAAP says it should?
- What journal entries does Carbon currently generate for fixed asset sale vs. what GAAP says it should?
- What's missing or incorrect?
- What caused the "failed to create sales order line" error?

## Output

Write a concise research report to `/home/openclaw/.openclaw/workspace/tasks/fixed-asset-journal-entries-report.md` with:
1. Industry standard journal entries (purchase + sale)
2. What Carbon currently does (purchase + sale)
3. Gap analysis
4. Root cause of the "failed to create sales order line" error
5. Recommended fixes (no implementation — just describe what needs to change)

## Constraints
- Read-only. No code changes, no git commits, no PRs.
- Use `rg` for searching (not grep).
- Be thorough on the accounting side — this needs to be correct for manufacturing ERP customers.
