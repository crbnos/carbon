import { useEffect, useState } from "react";

type ScreenSize = "sm" | "md" | "lg" | "xl" | "2xl";

function useMediaQuery() {
  const [screenSize, setScreenSize] = useState<ScreenSize>("sm");

  useEffect(() => {
    const checkScreenSize = () => {
      if (window.matchMedia("(min-width: 1536px)").matches) {
        setScreenSize("2xl");
      } else if (window.matchMedia("(min-width: 1280px)").matches) {
        setScreenSize("xl");
      } else if (window.matchMedia("(min-width: 1024px)").matches) {
        setScreenSize("lg");
      } else if (window.matchMedia("(min-width: 768px)").matches) {
        setScreenSize("md");
      } else {
        setScreenSize("sm");
      }
    };

    checkScreenSize();
    window.addEventListener("resize", checkScreenSize);

    return () => window.removeEventListener("resize", checkScreenSize);
  }, []);

  return {
    isMobile: ["sm", "md", "lg"].includes(screenSize),
    screenSize,
  };
}

export default useMediaQuery;
