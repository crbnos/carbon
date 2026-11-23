# Publish a Training

Last tested: 2026-10-26
Route: /x/training/{trainingId}

## Prerequisites
- At least one training exists (e.g. train_… id). Status starts as "Draft".

## Steps
### 1. Navigate — /x/training/{id}. Header shows the name + a status badge (DRAFT/ACTIVE/ARCHIVED).
### 2. Publish — a Draft training shows a "Publish" button in the HEADER. Click it.
### 3. Confirm — a dialog "Publish Training" opens ("Employees assigned to this training can open it…"). Click its "Publish" button.
### 4. Verify — `training.status` is Active and the header badge reads ACTIVE.

## Selector Notes
- Status changes only from the header: Draft shows Publish, Active shows Archive, Reopen is in the ⋯ menu. The Properties panel has no Status field any more.
- A new training: /x/resources/training/new (Name, optional Grants Ability) → Save → lands on /x/training/{id}.

## Common Failures
- Looking for Status in the Properties panel — it was moved to the header.
