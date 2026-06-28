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
    light: ["#c2c2c9", "#e4e4e9", "#fafafb", "#d2d2d9"],
    dark: ["#18181b", "#000000", "#0D0D0D", "#050505"]
  },
  neutral: {
    light: ["#c7c3bf", "#e6e3df", "#faf9f8", "#d6d2cd"],
    dark: ["#1c1917", "#000000", "#0D0D0D", "#050505"]
  },
  red: {
    light: ["#fda4af", "#ffdce0", "#fff5f6", "#fec5cb"],
    dark: ["#2d0a0a", "#000000", "#0D0D0D", "#050505"]
  },
  orange: {
    light: ["#fdba74", "#ffe2c2", "#fff7ee", "#ffd2a3"],
    dark: ["#2d1a0a", "#000000", "#0D0D0D", "#050505"]
  },
  yellow: {
    light: ["#fcd34d", "#fdeba8", "#fffbe6", "#fde17f"],
    dark: ["#2d2a0a", "#000000", "#0D0D0D", "#050505"]
  },
  green: {
    light: ["#6ee7b7", "#b9efd3", "#ecfdf4", "#9eeecb"],
    dark: ["#023225", "#000000", "#0D0D0D", "#050505"]
  },
  blue: {
    light: ["#dfe9fc", "#f2f6fd", "#fdfdfe", "#eaf0fb"],
    dark: ["#0a1a2d", "#000000", "#0D0D0D", "#050505"]
  },
  violet: {
    light: ["#a78bfa", "#d8ccfe", "#f1edfe", "#c6b4fd"],
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
        speed={1}
        colors={getMeshColors(activeTheme, mode)}
        distortion={0.8}
        swirl={0.1}
        grainMixer={0}
        grainOverlay={0}
        className="absolute inset-0 w-full h-full"
        style={{ height: "100%", width: "100%" }}
      />
    </div>
  );
}
