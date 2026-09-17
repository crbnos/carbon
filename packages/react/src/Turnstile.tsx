import { Turnstile } from "@marsidev/react-turnstile";
import { useMode } from "./hooks/useMode";

type TurnstileChallengeProps = {
  siteKey?: string;
  onToken: (token: string) => void;
};

// Clears the token on error/expiry so callers can gate submission on it.
export function TurnstileChallenge({
  siteKey,
  onToken
}: TurnstileChallengeProps) {
  const mode = useMode();

  if (!siteKey) return null;

  return (
    <div className="w-full flex justify-center">
      <Turnstile
        siteKey={siteKey}
        onSuccess={onToken}
        onError={() => onToken("")}
        onExpire={() => onToken("")}
        options={{
          theme: mode === "dark" ? "dark" : "light"
        }}
      />
    </div>
  );
}
