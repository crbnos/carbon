import type { ReactNode } from "react";
import { CourseSidebar } from "./CourseSidebar";

/** The learn surface's two-pane shell: sticky course sidebar (lg+) + content.
 *  Shared by the course layout, lesson, and challenge pages so navigation
 *  context is always present. `activeCourseId` highlights the current course
 *  on pages whose URL isn't `/course/*`. */
export function LearnShell({
  children,
  activeCourseId,
  rail
}: {
  children: ReactNode;
  activeCourseId?: string;
  rail?: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-370">
      <CourseSidebar activeCourseId={activeCourseId} />
      <main className="min-w-0 flex-1 px-6 pb-24 pt-10 lg:px-14">
        {children}
      </main>
      {rail ? (
        <aside className="hidden w-56 shrink-0 py-10 pr-8 xl:block">
          {rail}
        </aside>
      ) : null}
    </div>
  );
}
