/**
 * Frame — wraps a screenshot/diagram in a rounded, hairline-bordered frame with
 * an optional caption, so media reads as a deliberate figure rather than a raw
 * pasted image. Server component.
 *
 * Usage in MDX:
 *   <Frame caption="The routing builder, mid-edit.">
 *     ![Routing builder](/screens/routing-builder.png)
 *   </Frame>
 */
import type { ReactNode } from "react";

export function Frame({ children, caption }: { children: ReactNode; caption?: string }) {
  return (
    <figure className="not-prose my-8">
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm [&_img]:m-0 [&_img]:block [&_img]:w-full">
        {children}
      </div>
      {caption && (
        <figcaption className="mt-3 text-center text-xs text-muted-foreground">{caption}</figcaption>
      )}
    </figure>
  );
}
