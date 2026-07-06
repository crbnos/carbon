import { getMESUrl } from "@carbon/auth";
import { requireAuthSession } from "@carbon/auth/session.server";
import { TooltipProvider, useMode } from "@carbon/react";
import { MeshGradient } from "@paper-design/shaders-react";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const authSession = await requireAuthSession(request, { verify: true });

  // Console terminals are MES-only — never let them reach the ERP picker.
  // Mirrors the guard in x+/_layout.tsx.
  if (authSession.console) {
    throw redirect(getMESUrl());
  }

  return {};
}

const MESH_COLORS: Record<string, [string, string, string, string]> = {
  light: ["#bdcdff", "#f7f5ff", "#ffffff", "#e6f3ff"],
  dark: ["#0a1a2d", "#000000", "#0D0D0D", "#050505"]
};

export default function SelectCompanyLayout() {
  const mode = useMode();
  const colors = MESH_COLORS[mode] ?? MESH_COLORS.light;
  const background = `linear-gradient(to bottom right, ${colors[1]} 35.67%, ${colors[0]} 88.95%)`;

  return (
    <TooltipProvider>
      <div className="relative h-screen w-screen">
        <div className="absolute inset-0" style={{ background }}>
          <MeshGradient
            speed={1}
            colors={colors}
            distortion={0.8}
            swirl={0.1}
            grainMixer={0}
            grainOverlay={0}
            className="absolute inset-0 w-full h-full"
            style={{ height: "100%", width: "100%" }}
          />
        </div>
        <div className="relative z-10 flex h-full w-full items-center justify-center p-4">
          <Outlet />
        </div>
      </div>
    </TooltipProvider>
  );
}
