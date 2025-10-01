import { Loading } from "@carbon/react";
import { useEffect, useState } from "react";

export const Redirect = ({ path }: { path: string }) => {
  const [isLoading, setIsLoading] = useState(true);
  useEffect(() => {
    window.location.href = path;
    setIsLoading(false);
  }, [path]);

  return (
    <div className="flex h-screen w-screen items-center justify-center">
      <Loading className="size-8" isLoading={isLoading} />
    </div>
  );
};
