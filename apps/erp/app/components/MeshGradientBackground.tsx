import { cn, useMode } from "@carbon/react";
import { MeshGradient } from "@paper-design/shaders-react";
import { useEffect, useState } from "react";
import { useTheme } from "~/hooks/useTheme";

// Theme-aware Paper Shaders mesh-gradient backdrop. Used behind the onboarding
// flow and the Implementation Hub so both share the same soft, animated canvas.
const meshColorsByTheme: Record<
  string,
  {
    light: [string, string, string, string];
    dark: [string, string, string, string];
  }
> = {
  zinc: {
    light: ["#edecef", "#f4f4f6", "#fafafb", "#f0eff2"],
    dark: ["#18181b", "#000000", "#0D0D0D", "#050505"]
  },
  neutral: {
    light: ["#eeece9", "#f4f3f1", "#faf9f8", "#f1efed"],
    dark: ["#1c1917", "#000000", "#0D0D0D", "#050505"]
  },
  red: {
    light: ["#fdf0f1", "#fdf6f6", "#fffafa", "#fdf3f3"],
    dark: ["#2d0a0a", "#000000", "#0D0D0D", "#050505"]
  },
  orange: {
    light: ["#fdf4e9", "#fdf8f1", "#fffbf6", "#fdf6ed"],
    dark: ["#2d1a0a", "#000000", "#0D0D0D", "#050505"]
  },
  yellow: {
    light: ["#fdf8e2", "#fdfaec", "#fffdf4", "#fdf9e7"],
    dark: ["#2d2a0a", "#000000", "#0D0D0D", "#050505"]
  },
  green: {
    light: ["#e9fbf2", "#f0fcf6", "#f6fdf9", "#edfcf4"],
    dark: ["#023225", "#000000", "#0D0D0D", "#050505"]
  },
  blue: {
    light: ["#eef3fd", "#f5f8fe", "#fcfdfe", "#f1f5fd"],
    dark: ["#0a1a2d", "#000000", "#0D0D0D", "#050505"]
  },
  violet: {
    light: ["#f3f0fe", "#f7f5fe", "#fbfaff", "#f5f2fe"],
    dark: ["#1e0a2d", "#000000", "#0D0D0D", "#050505"]
  }
};

export function getMeshColors(theme: string, mode: string) {
  const colors = meshColorsByTheme[theme] ?? meshColorsByTheme.blue;
  return mode === "light" ? colors.light : colors.dark;
}

export function getMeshBackgroundGradient(theme: string, mode: string) {
  const colors = getMeshColors(theme, mode);
  return `linear-gradient(to bottom right, ${colors[1]} 35.67%, ${colors[0]} 88.95%)`;
}

// Absolute-positioned background layer. Parent must be `relative`; render real
// content as a sibling with `relative z-10` on top.
export function MeshGradientBackground({
  className,
  theme: themeOverride
}: {
  className?: string;
  // Force a fixed palette (e.g. "blue") instead of the company theme. By default
  // the mesh follows the company's chosen theme — both the signup onboarding flow
  // and the Implementation Hub leave this unset so they match the company theme.
  theme?: string;
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
