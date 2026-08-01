import { Outlet } from "react-router";
import { LearnShell } from "~/components/LearnShell";
import { OnThisPage } from "~/components/OnThisPage";

export default function CourseLayout() {
  return (
    <LearnShell rail={<OnThisPage />}>
      <Outlet />
    </LearnShell>
  );
}
