---
paths: []
triggers: []
promoted: null
---
# A drag re-rendered every card on the board

**Context:** The schedule boards (operations, dates, batches) render one sortable card per operation or job, each with a form, avatars, tooltips and a menu.

**Problem:** A drag stuttered: with 82 cards, six frames of a 90-frame sweep took over 100 ms. Two causes. dnd-kit re-renders every `useSortable` consumer when the drop target changes, and the hook sat inside the card, so every card's whole body rendered each time. And `useSensor(KeyboardSensor, { coordinateGetter })` passed a new options object on every render: dnd-kit memoizes the sensor on it, so every draggable got new `listeners`, which defeats `memo` on anything that takes them.

**Rule:** A sortable card is a thin shell that calls `useSortable` and a `memo`ized body that takes plain props (`sortableCardProps` in `Schedule/Kanban/cardShell.ts`). `useSensor` options are a module constant (`no-inline-sensor-options` check). A context every card reads must have a stable value. To find what re-renders, count renders per component during a scripted drag; do not guess.

**Applies to:** `apps/erp/app/modules/production/ui/Schedule/Kanban/**`; any dnd-kit board or list with more than a few dozen items.
