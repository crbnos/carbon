const LINE = "#E1E1DC";
const STAR = "#CFCFC9";
const STAR_ACCENT = "#9FCFE4";

// Connected clusters, then loose stars. Coordinates are hand-placed on a 560×420 field.
const CLUSTERS: [number, number][][] = [
  [[58, 92], [126, 58], [188, 104], [252, 66]],
  [[330, 150], [398, 116], [452, 176], [386, 222], [330, 150]],
  [[470, 48], [528, 92]],
  [[96, 268], [162, 232], [228, 286], [296, 250]],
  [[382, 320], [448, 296]],
];

const LOOSE: [number, number][] = [
  [22, 44], [210, 18], [300, 96], [420, 240], [150, 340], [260, 368],
  [500, 300], [72, 180], [348, 40], [508, 200], [36, 320], [276, 140],
  [180, 160], [440, 120],
];

const ACCENT = new Set(["126,58", "386,222", "228,286"]);

/* Standing decoration for the identity column, echoing Commit's constellation. Purely
 * atmospheric — it carries the column's empty half so the block does not read as a gap.
 * Commit pairs its star field with a radial bloom; that needs a full-height half-page to
 * fade out in, and inside a 24rem column it gets clipped into a visible rectangle, so the
 * field carries it alone here. Clipped by its own wrapper rather than by the panel, so
 * the Subscribe popover (a sibling) is never cut off. */
export function ChangelogDecoration() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 hidden overflow-hidden lg:block"
    >
      <svg
        viewBox="0 0 560 420"
        className="absolute -top-20 -right-28 w-[42rem] rotate-[18deg] overflow-visible"
      >
        <g stroke={LINE} strokeWidth={1} fill="none" strokeLinecap="round">
          {CLUSTERS.map((points) => (
            <polyline key={points.join()} points={points.map((p) => p.join(",")).join(" ")} />
          ))}
        </g>
        {[...CLUSTERS.flat(), ...LOOSE].map(([cx, cy]) => {
          const accent = ACCENT.has(`${cx},${cy}`);
          return (
            <circle
              key={`${cx}-${cy}`}
              cx={cx}
              cy={cy}
              r={accent ? 2.2 : 1.6}
              fill={accent ? STAR_ACCENT : STAR}
            />
          );
        })}
      </svg>
    </div>
  );
}
