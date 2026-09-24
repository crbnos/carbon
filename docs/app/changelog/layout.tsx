import type { ReactNode } from "react";
import { MainHeader } from "@/components/main-header";
import "../reference.css";

/** The changelog surface: the site header over a single centered article column —
 *  a dated feed needs no section sidebar or table of contents. */
export default function ChangelogLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen w-full bg-ed-paper">
      <MainHeader active="changelog" />
      <div className="mx-auto w-full max-w-370 pt-16">
        <main className="mx-auto w-full max-w-225 px-6 pb-35 pt-10 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
