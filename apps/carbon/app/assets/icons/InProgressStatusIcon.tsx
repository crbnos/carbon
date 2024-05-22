export function InProgressStatusIcon({ className }: { className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      color="currentColor"
      className={className}
    >
      <circle
        cx="7"
        cy="7"
        r="6"
        fill="none"
        stroke="#f2be00"
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
        stroke="#f2be00"
        stroke-width="4"
        stroke-dasharray="6.2517693806436885 100"
        stroke-dashoffset="0"
        transform="rotate(-90 7 7)"
      ></circle>
    </svg>
  );
}
