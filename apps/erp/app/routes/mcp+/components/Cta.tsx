import { Button, useMode } from "@carbon/react";
import { useEffect, useState } from "react";
import { useInViewClass } from "../hooks/useInViewClass";
import { goToQuickstart } from "./quickstart-nav";

export function Cta() {
  const ref = useInViewClass<HTMLElement>();
  // Read the real <html> .dark class (useMode lags the toggle), and track toggles.
  const [isDark, setIsDark] = useState(useMode() === "dark");
  useEffect(() => {
    const html = document.documentElement;
    const update = () => setIsDark(html.classList.contains("dark"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(html, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return (
    <section ref={ref} className="reveal relative py-[54px] scroll-mt-20">
      <div
        className={
          isDark
            ? "bg-muted bg-cover bg-center border border-border rounded-[14px] px-[24px] py-[50px] text-center"
            : "bg-muted bg-[url(/cta.webp)] bg-cover bg-center border border-border rounded-[14px] px-[24px] py-[50px] text-center"
        }
      >
        <h2 className="font-medium tracking-[-0.035em] leading-[1.05] m-0 mb-[8px] text-foreground [text-wrap:balance] text-[clamp(1.8rem,2.8vw,2.4rem)]">
          Build something with Carbon
        </h2>
        <p className="text-muted-foreground m-0 mb-[20px]">
          Bring your manufacturing system into every AI assistant.
        </p>
        <div className="flex gap-[10px] flex-wrap justify-center">
          <Button
            variant="primary"
            size="lg"
            onClick={() => goToQuickstart("Claude Code")}
          >
            Connect to Claude
          </Button>
          <Button asChild variant="secondary" size="lg">
            <a
              href="https://www.carbon.ms/sales"
              target="_blank"
              rel="noopener"
            >
              Talk to sales
            </a>
          </Button>
        </div>
      </div>
    </section>
  );
}
