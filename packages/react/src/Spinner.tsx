import { cn } from "./utils/cn";

interface SpinnerProps {
  /** Diameter of the spinner in pixels */
  size?: number;
  className?: string;
}

const BARS = Array.from({ length: 12 });

export function Spinner({ size = 16, className }: SpinnerProps) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn("relative inline-block", className)}
      style={{ width: size, height: size }}
    >
      {BARS.map((_, i) => (
        <div
          key={i}
          className="absolute left-1/2 top-0 h-[24%] w-[8%] -translate-x-1/2 animate-spinner rounded-full bg-current"
          style={{
            transformOrigin: `center ${size / 2}px`,
            transform: `rotate(${i * 30}deg)`,
            animationDelay: `${-(11 - i) * (1 / 12)}s`
          }}
        />
      ))}
      <span className="sr-only">Loading</span>
    </div>
  );
}
