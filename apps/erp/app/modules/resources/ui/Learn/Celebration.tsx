import ConfettiExplosion from "react-confetti-explosion";

/**
 * Fires once when a unit, challenge, or exam is passed.
 *
 * Deliberately silent: the existing training runner references `/victory.mp3`,
 * which is not in this app's public directory, so its `.play()` fails and is
 * swallowed. Rather than copy a dead asset reference, this celebrates visually.
 */
const Celebration = () => (
  <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-50">
    <ConfettiExplosion
      particleCount={200}
      force={0.8}
      duration={2800}
      width={1600}
    />
  </div>
);

export default Celebration;
