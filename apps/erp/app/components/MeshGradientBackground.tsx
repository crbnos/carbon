// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn, useMode } from "@carbon/react";
import { themeByName } from "@carbon/utils";
import { MeshGradient } from "@paper-design/shaders-react";
import { useEffect, useState } from "react";
import { useTheme } from "~/hooks/useTheme";

// Theme-aware Paper Shaders mesh-gradient backdrop. Used behind the onboarding
// flow and the Implementation Hub so both share the same soft, animated canvas.
// Each theme carries its four colors per mode (`mesh` in @carbon/utils).
export function getMeshColors(theme: string, mode: string): string[] {
  const { mesh } = themeByName(theme);
  return [...(mode === "light" ? mesh.light : mesh.dark)];
}

export function getMeshBackgroundGradient(theme: string, mode: string) {
  const colors = getMeshColors(theme, mode);
  return `linear-gradient(to bottom right, ${colors[1]} 35.67%, ${colors[0]} 88.95%)`;
}

// Absolute-positioned background layer. Parent must be `relative`; render real
// content as a sibling with `relative z-10` on top.
export function MeshGradientBackground({
  className,
  theme: themeOverride,
  darkOnly = false
}: {
  className?: string;
  // Force a fixed palette (e.g. "blue") instead of the company theme. By default
  // the mesh follows the company's chosen theme — both the signup onboarding flow
  // and the Implementation Hub leave this unset so they match the company theme.
  theme?: string;
  // Skip the gradient in light mode (the Implementation Hub renders on the plain
  // page background there); the signup onboarding flow keeps it in both modes.
  darkOnly?: boolean;
}) {
  const mode = useMode();
  const serverTheme = useTheme();
  const [theme, setTheme] = useState(serverTheme);

  useEffect(() => {
    setTheme(serverTheme);
  }, [serverTheme]);

  // The onboarding theme step dispatches this to preview themes live.
  useEffect(() => {
    const handler = (e: Event) => {
      setTheme((e as CustomEvent<string>).detail);
    };
    window.addEventListener("onboarding-theme-change", handler);
    return () => window.removeEventListener("onboarding-theme-change", handler);
  }, []);

  const activeTheme = themeOverride ?? theme;

  if (darkOnly && mode !== "dark") {
    return null;
  }

  return (
    <div
      className={cn("absolute inset-0 overflow-hidden", className)}
      style={{ background: getMeshBackgroundGradient(activeTheme, mode) }}
    >
      <MeshGradient
        speed={0.3}
        colors={getMeshColors(activeTheme, mode)}
        distortion={0.4}
        swirl={0.05}
        grainMixer={0}
        grainOverlay={0}
        className="absolute inset-0 w-full h-full"
        style={{ height: "100%", width: "100%" }}
      />
    </div>
  );
}
