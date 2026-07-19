import { useEffect, useState } from "react";

export function GlitchHeading({
  code = "404",
  srText
}: {
  code?: string;
  srText?: string;
}) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [glitching, setGlitching] = useState(false);

  // Parallax follow the pointer
  useEffect(() => {
    function onMove(e: PointerEvent) {
      const { innerWidth, innerHeight } = window;
      const x = (e.clientX / innerWidth - 0.5) * 2;
      const y = (e.clientY / innerHeight - 0.5) * 2;
      setOffset({ x, y });
    }
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  // Random glitch bursts
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    let burst: ReturnType<typeof setTimeout>;
    function loop() {
      const delay = 1800 + Math.random() * 3200;
      timeout = setTimeout(() => {
        setGlitching(true);
        burst = setTimeout(
          () => setGlitching(false),
          180 + Math.random() * 220
        );
        loop();
      }, delay);
    }
    loop();
    return () => {
      clearTimeout(timeout);
      clearTimeout(burst);
    };
  }, []);

  return (
    <div
      className="relative select-none"
      style={{
        transform: `translate3d(${offset.x * -14}px, ${offset.y * -14}px, 0)`
      }}
      onPointerEnter={() => setGlitching(true)}
      onPointerLeave={() => setGlitching(false)}
    >
      {/* Ghost layers */}
      <span
        aria-hidden="true"
        className="absolute inset-0 font-sans font-bold leading-none tracking-tighter text-foreground/70 transition-transform duration-75"
        style={{
          transform: glitching
            ? "translate(-6px, 3px)"
            : `translate(${offset.x * 4}px, 0)`,
          clipPath: glitching
            ? "polygon(0 15%, 100% 15%, 100% 40%, 0 40%)"
            : "none"
        }}
      >
        {code}
      </span>
      <span
        aria-hidden="true"
        className="absolute inset-0 font-sans font-bold leading-none tracking-tighter text-foreground/40 transition-transform duration-75"
        style={{
          transform: glitching
            ? "translate(6px, -3px)"
            : `translate(${offset.x * -4}px, 0)`,
          clipPath: glitching
            ? "polygon(0 60%, 100% 60%, 100% 85%, 0 85%)"
            : "none"
        }}
      >
        {code}
      </span>
      {/* Main layer */}
      <h1
        className="relative font-sans font-bold leading-none tracking-tighter text-foreground"
        style={{ fontSize: "clamp(7rem, 30vw, 26rem)" }}
      >
        <span className="sr-only">{srText ?? `Error ${code}. `}</span>
        <span aria-hidden="true">{code}</span>
      </h1>
    </div>
  );
}
