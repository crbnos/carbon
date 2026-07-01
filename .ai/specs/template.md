# {Title}

> Status: draft | in-progress | implemented
> Author: {name}
> Date: {YYYY-MM-DD}

## TLDR

One paragraph summary of what this spec proposes.

## Problem Statement

What's wrong or what's missing. Include concrete examples if possible.

## Proposed Solution

How we'll solve it.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| {decision} | {choice} | {why} |

## Data Model Changes

Tables, columns, migrations needed. Include SQL sketches for new tables.

```sql
-- Example:
CREATE TABLE "newEntity" (
    "id" TEXT NOT NULL DEFAULT id('prefix'),
    "companyId" TEXT NOT NULL,
    -- Business columns
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "customFields" JSONB,
    CONSTRAINT "newEntity_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "newEntity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- RLS
ALTER TABLE "newEntity" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "newEntity_SELECT" ON "newEntity" FOR SELECT USING (has_role());
```

## API / Service Changes

New or modified service functions, route loaders/actions.

## UI Changes

New or modified pages, forms, tables.

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| {risk} | Low/Med/High | {mitigation} |

## Open Questions

> HARD STOP: Do not proceed with implementation until these are answered.

- [ ] {question 1}
- [ ] {question 2}

## Changelog

- {YYYY-MM-DD}: Created
