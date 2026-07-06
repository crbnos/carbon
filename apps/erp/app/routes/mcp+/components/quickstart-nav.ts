// Lets the hero CTAs drive the Quickstart: smooth-scroll to it and, optionally,
// preselect a client in the SetupPipeline (which listens for this event).
export const SELECT_CLIENT_EVENT = "mcp:select-client";

export function goToQuickstart(client?: string) {
  document
    .getElementById("quickstart")
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
  if (client) {
    window.dispatchEvent(
      new CustomEvent(SELECT_CLIENT_EVENT, { detail: client })
    );
  }
}
