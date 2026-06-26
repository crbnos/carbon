import { LuHardHat } from "react-icons/lu";

// Stub content for hub pages not yet built (everything beyond Start Here in P1).
// The full IA shows in the sidebar; each page lands here until its real route
// is implemented (P2–P4).
export function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center text-center gap-3 p-8">
      <div className="size-12 rounded-xl border flex items-center justify-center">
        <LuHardHat className="text-xl text-muted-foreground" />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground max-w-sm text-pretty">
        This page of your Implementation Hub is being built. Start from the
        command center while we finish it.
      </p>
    </div>
  );
}
