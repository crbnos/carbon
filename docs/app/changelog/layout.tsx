import type { ReactNode } from "react";
import { MainHeader } from "@/components/main-header";
import "../reference.css";

/* Cross-document view transitions, inlined rather than put in a stylesheet.
 *
 * Next's `experimental.viewTransition` needs React 19's `unstable_ViewTransition`, and
 * docs resolves React 18 despite declaring ^19.2.0 — so the client-router route is shut.
 * This is the MPA route: the changelog's links are plain anchors, so navigation is
 * cross-document and the browser drives the transition, morphing any element that shares
 * a `view-transition-name` between the two pages.
 *
 * It has to be a literal <style>: Lightning CSS (Tailwind v4 / Turbopack) does not know
 * the `@view-transition` at-rule and silently drops it from the compiled stylesheet.
 * Verified by grepping the served CSS chunk. */
const VIEW_TRANSITIONS = `
@view-transition { navigation: auto; }
@media (prefers-reduced-motion: no-preference) {
  ::view-transition-group(*) {
    animation-duration: 320ms;
    animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
  }
  ::view-transition-old(root),
  ::view-transition-new(root) { animation-duration: 200ms; }
}
@media (prefers-reduced-motion: reduce) {
  ::view-transition-group(*),
  ::view-transition-old(root),
  ::view-transition-new(root) { animation: none; }
}
`;

export default function ChangelogLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen w-full bg-ed-paper">
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static stylesheet, no input */}
      <style dangerouslySetInnerHTML={{ __html: VIEW_TRANSITIONS }} />
      <MainHeader active="changelog" />
      <main className="pt-16 pb-24">{children}</main>
    </div>
  );
}
