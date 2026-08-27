import { TooltipProvider } from "@carbon/react";
import { Outlet } from "react-router";

/**
 * Bare shell for pages that render inside another product (the Onshape right
 * panel): no app chrome, no navigation, the host supplies both.
 */
export default function OnshapeLayout() {
  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background text-foreground">
        <Outlet />
      </div>
    </TooltipProvider>
  );
}
