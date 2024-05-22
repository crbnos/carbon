export function TodoStatusIcon({ className }: { className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      color="currentColor"
      className="className"
    >
      <circle
        cx="7"
        cy="7"
        r="6"
        fill="none"
        stroke="#e2e2e2"
        stroke-width="2"
        stroke-dasharray="3.14 0"
        stroke-dashoffset="-0.7"
      ></circle>
      <circle
        className="progress"
        cx="7"
        cy="7"
        r="2"
        fill="none"
        stroke="#e2e2e2"
        stroke-width="4"
        stroke-dasharray="0 100"
        stroke-dashoffset="0"
        transform="rotate(-90 7 7)"
      ></circle>
    </svg>
  );
}
