import { Heading, useInterval } from "@carbon/react";
import { getLocalTimeZone, now } from "@internationalized/date";
import type { ComponentProps } from "react";
import { useMemo, useState } from "react";
import { useUser } from "~/hooks";

export function Greeting(props: ComponentProps<typeof Heading>) {
  const user = useUser();
  const [currentTime, setCurrentTime] = useState(() => now(getLocalTimeZone()));

  useInterval(
    () => {
      setCurrentTime(now(getLocalTimeZone()));
    },
    60 * 60 * 1000
  );

  const greeting = useMemo(() => {
    if (currentTime.hour >= 3 && currentTime.hour < 12) {
      return "Good morning";
    } else if (currentTime.hour >= 12 && currentTime.hour < 18) {
      return "Good afternoon";
    } else {
      return "Good evening";
    }
  }, [currentTime.hour]);

  return (
    <Heading size="h3" {...props}>
      {greeting}, {user.firstName}
    </Heading>
  );
}
