# Issue Module (Quality Management)

## Overview

The Issue module is part of the quality management system in Carbon ERP. It handles non-conformance tracking and management with a workflow-based approach.

## Issue Status Flow

Issues have the following status progression:

1. **Registered** - Initial status when an issue is created
2. **In Progress** - Status when work begins on the issue
3. **Closed** - Final status when the issue is resolved

### Status Transitions

- **Start Button**: Visible when status is "Registered", changes status to "In Progress"
- **Complete Button**: Visible when status is "In Progress", changes status to "Closed"
- **Reopen Button**: Visible when status is "Closed", changes status back to "In Progress"

## Task Types

Issues can have two types of tasks that are created automatically based on the issue configuration:

### 1. Action Tasks

- Created based on `requiredActionIds` array in the issue (includes former investigation types, merged in migration 20251120214020)
- Each action type creates one task
- Stored in `nonConformanceActionTask` table
- Examples: Root Cause Analysis, Corrective Action, Preventive Action, Containment

### 2. Approval Tasks

- Created based on `approvalRequirements` array in the issue
- Each approval type creates one task
- Stored in `nonConformanceApprovalTask` table
- Special handling for MRB (Material Review Board) approvals which also create reviewer records

## Task Status

All tasks have the following statuses:

- **Pending** - Initial status (tasks do NOT auto-start)
- **In Progress** - When work is actively being done
- **Completed** - When the task is finished
- **Skipped** - When the task is not applicable

### Task Actions

- **Start**: Changes status from "Pending" to "In Progress"
- **Complete**: Changes status from "In Progress" to "Completed"
- **Skip**: Available only when status is "Pending", changes to "Skipped"
- **Reopen**: Available when status is "Completed" or "Skipped", changes back to "Pending"

## Task Creation Process

1. When an issue is created, the system calls an edge function (`nonConformanceTasks`)
2. The function reads the issue's configuration:
   - `investigationTypes[]`
   - `requiredActions[]`
   - `approvalRequirements[]`
3. For each item in these arrays, it creates the corresponding task
4. Tasks are created with:
   - Status: "Pending"
   - No assignee by default
   - Associated to the issue via `nonConformanceId`

## Current Auto-Start Behavior

**Tasks do NOT auto-start when the issue status changes to "In Progress"**. All tasks remain in "Pending" status and must be manually started by users.

## Key Files

- **Header Component**: `/apps/erp/app/modules/quality/ui/Issue/IssueHeader.tsx`
- **Task Component**: `/apps/erp/app/modules/quality/ui/Issue/IssueTask.tsx`
- **Status Route**: `/apps/erp/app/routes/x+/issue+/$id.status.tsx`
- **Task Status Route**: `/apps/erp/app/routes/x+/issue+/task.$id.status.tsx`
- **Task Creation**: `/packages/database/supabase/functions/create/index.ts` (case "nonConformanceTasks")
- **Service Functions**: `/apps/erp/app/modules/quality/quality.service.ts`

## Database Tables

- `nonConformance` - Main issue records
- `nonConformanceItem` - Junction table linking issues to items (many-to-many relationship)
- `nonConformanceInvestigationTask` - Investigation tasks
- `nonConformanceActionTask` - Action tasks
- `nonConformanceApprovalTask` - Approval tasks
- `nonConformanceReviewer` - Reviewer records for MRB approvals

## Item Associations

Issues can be associated with multiple items (parts, materials, tools, consumables, services) through the `nonConformanceItem` junction table.

### Used In Integration

Issues now appear in the "Used In" panel for all item types:
- **Service Functions**: `getPartUsedIn()` and `getMaterialUsedIn()` in `/apps/erp/app/modules/items/items.service.ts` query the `nonConformanceItem` table
- **UI Component**: `/apps/erp/app/modules/items/ui/Item/UsedIn.tsx` handles rendering issues in the tree
- **View Routes**: All item view routes (part, material, tool, consumable) include issues in their UsedIn tree
- Issues are displayed under the "Issues" category with module set to "quality"

### Implementation Details

When querying items for issues:
```typescript
client
  .from("nonConformanceItem")
  .select("id, ...nonConformance(documentReadableId:nonConformanceId, documentId:id)")
  .eq("itemId", itemId)
  .eq("companyId", companyId)
  .limit(100)
  .order("createdAt", { ascending: false })
```

## Routes

- List: `/x/quality/issues`
- New: `/x/issue/new`
- Details: `/x/issue/{id}`
- Investigations: `/x/issue/{id}/investigations`
- Actions: `/x/issue/{id}/actions`
- Review: `/x/issue/{id}/review`
