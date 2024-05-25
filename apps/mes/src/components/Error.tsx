import { Button, Heading } from "@carbon/react";
import { isRouteErrorResponse, useRouteError } from "react-router-dom";

export default function ErrorPage() {
  const error = useRouteError();
  console.error(error);

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      // ...
    } else if (error.status === 404) {
      // ...
    }

    return (
      <div className="dark">
        <div className="flex flex-col w-full h-screen bg-zinc-900 items-center justify-center space-y-4 ">
          <img
            src="/carbon-logo-light.png"
            alt="Carbon Logo"
            className="block max-w-[60px]"
          />
          <Heading size="h1">{error.status}</Heading>
          <p className="text-muted-foreground max-w-2xl">{error.statusText}</p>
          <Button onClick={() => (window.location.href = "/")}>
            Back Home
          </Button>
        </div>
      </div>
    );
  } else if (error instanceof Error) {
    return (
      <div className="dark">
        <div className="flex flex-col w-full h-screen bg-zinc-900 items-center justify-center space-y-4 ">
          <img
            src="/carbon-logo-light.png"
            alt="Carbon Logo"
            className="block max-w-[60px]"
          />
          <Heading size="h1">Something went wrong</Heading>
          <p className="text-muted-foreground max-w-2xl">{error.message}</p>
          <Button onClick={() => (window.location.href = "/")}>
            Back Home
          </Button>
        </div>
      </div>
    );
  } else {
    return <></>;
  }
}
