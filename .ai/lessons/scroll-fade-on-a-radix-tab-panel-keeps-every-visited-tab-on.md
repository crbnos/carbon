---
paths: ["apps/mes/app/components/WorkRecord.tsx"]
triggers: ["scroll-fade"]
promoted: null
---
# `scroll-fade` on a Radix tab panel keeps every visited tab on screen

**Context:** The MES work record (`WorkRecordPane`, `apps/mes/app/components/WorkRecord.tsx`) and the job operation view put each tab's `TabsContent` in one grid cell (`[grid-area:main]`) and made that panel the scroller, with `scroll-fade`.

**Problem:** `scroll-fade` is a scroll-driven CSS animation (`packages/config/tailwind/theme.css`). Radix `Presence` keeps a closing panel mounted until its own animation fires `animationend`, which a scroll-driven animation never does. Every tab once opened stayed mounted, and they drew on top of each other: a service job's Findings heading over the customer name, Photos over Details.

**Rule:** Never put `scroll-fade` (or any `animation`) on an element Radix mounts and unmounts — `TabsContent`, dialog, popover or dropdown content. Put the scroll and `scroll-fade` on a child div.

**Applies to:** `TabsContent` and every Radix `Presence`-driven content element, in the ERP, the MES and `@carbon/react`.
