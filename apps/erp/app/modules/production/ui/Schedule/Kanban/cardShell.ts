// The shared visual shell for every schedule-board card (operation, job, batch):
// card background, hover, and the dark-mode elevated-surface shadow. Kept in one
// place so the batch card is visually locked to the operation/job cards instead
// of re-declaring the shadow string. (The same token appears on other surfaces
// across the app via @carbon/react primitives; unifying it into a Tailwind
// utility is a separate, app-wide change.)
export const KANBAN_CARD_SHELL =
  "bg-card hover:bg-muted/30 dark:border-none dark:shadow-[inset_0_0.5px_0_rgb(255_255_255_/_0.08),_inset_0_0_1px_rgb(255_255_255_/_0.24),_0_0_0_0.5px_rgb(0,0,0,1),0px_0px_4px_rgba(0,_0,_0,_0.08)]";
