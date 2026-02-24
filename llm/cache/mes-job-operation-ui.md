# MES Job Operation UI

## Overview

The MES app's operation detail page (`/x/operation/:operationId`) displays job operation information with responsive design for both desktop and mobile. The main component is `JobOperation` located at:

**Location:** `apps/mes/app/components/JobOperation/JobOperation.tsx`

## Component Structure

### Tabs System

The operation page uses a tab-based navigation with these tabs:
- **Details** - Main operation info (materials, files, steps, parameters)
- **Model** - 3D model viewer (if model file exists)
- **Procedure** - Work instructions
- **Chat** - Operation chat/notes

### Desktop vs Mobile Layout

**Desktop (md and above):**
- Tabs visible in header
- Job info bar visible with customer, description, status, duration, deadline
- Details tab content scrolls with right padding for controls sidebar
- Controls sidebar positioned absolutely on the right

**Mobile:**
- Tabs visible in header (compact)
- Job info bar shows only Job ID and dropdown menu
- Details tab content fills width (no padding for sidebar)
- Controls section appears inline below content
- Source column in materials table hidden to save space

### Key Responsive Classes

```tsx
// Tabs visibility - always visible
<div className="flex flex-shrink-0 items-center justify-end gap-2">

// Job header info bar - visible with flex-wrap
<div className="flex flex-wrap items-center justify-between px-4 lg:pl-6 py-2 min-h-[var(--header-height)] bg-background gap-2 md:gap-4">

// Detailed job info (customer, status, etc) - hidden on mobile
<HStack className="hidden md:flex justify-end items-center gap-2">

// Details tab content - visible on all screens
<TabsContent value="details" className="flex flex-col">

// ScrollArea - no right padding on mobile
<ScrollArea className="w-full md:pr-[calc(var(--controls-width))] h-[calc(100dvh-...)]">

// Materials Source column - hidden on mobile
<Th className="lg:table-cell hidden">Source</Th>
<Td className="hidden lg:table-cell">
```

### Controls Section

**Location:** `apps/mes/app/components/JobOperation/components/Controls.tsx`

The Controls component displays:
- Work center info
- Start/Stop buttons
- Scrap, Complete, Close Out buttons
- Progress times

Mobile-specific job info is shown in Controls (inside `md:hidden` div) since the header detailed info is hidden on mobile.

## Key Sections

### Materials Section

Shows bill of materials with:
- Part name and description
- Source (method type + shelf) - hidden on mobile
- Estimated quantity
- Actual (issued) quantity
- Issue button for tracked materials

The "Issue Material" button is always visible and opens the `IssueMaterialModal`.

### Files Section

Displays job-related files with:
- File name and type icon
- File size
- Download dropdown menu

### Serial Numbers Section

Only visible when `parentIsSerial` is true:
- Lists tracked entities
- Print label button
- Select button for each serial

## Modals

- `IssueMaterialModal` - Issue materials to operation
- `QuantityModal` - Log complete/scrap/rework quantities
- `SerialSelectorModal` - Select serial number to work on
- `RecordModal` - Record step data
- `DeleteStepRecordModal` - Delete step record

## CSS Variables

```css
--controls-width: The width of the controls sidebar
--controls-height: Dynamic height based on operation durations
--header-height: Standard header height
```

## Related Components

- `apps/mes/app/routes/x+/operation.$operationId.tsx` - Route loader
- `apps/mes/app/components/JobOperation/components/Controls.tsx` - Controls sidebar
- `apps/mes/app/components/JobOperation/components/IssueMaterialModal.tsx` - Material issuing
- `apps/mes/app/components/JobOperation/hooks/useOperation.tsx` - Operation state hook
- `apps/mes/app/components/JobOperation/hooks/useFiles.tsx` - File handling hook
