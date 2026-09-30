import type { ReactNode } from "react";
import { ChangelogIntro } from "@/components/changelog-intro";
import { MainHeader } from "@/components/main-header";
import "../reference.css";

export default function ChangelogLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen w-full bg-ed-paper">
      <MainHeader active="changelog" />
      <div className="mx-auto w-full max-w-370 px-6 pt-16 lg:px-8">
        <div className="lg:grid lg:grid-cols-[24rem_minmax(0,1fr)] lg:gap-x-16">
          <ChangelogIntro />
          <main className="min-w-0 pb-35">{children}</main>
        </div>
      </div>
    </div>
  );
}
