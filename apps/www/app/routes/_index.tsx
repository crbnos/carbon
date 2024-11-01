import { LuMoveUpRight } from "react-icons/lu";

export default function Route() {
  return (
    <>
      <header className="flex select-none items-center bg-background pl-5 pr-4 border-b h-[52px] border-transparent">
        <div className="flex items-center gap-2 z-logo text-foreground cursor-pointer"></div>
      </header>

      <div className="relative flex h-full w-full items-start justify-center overflow-hidden bg-background">
        <a
          id="announcement"
          href="https://app.carbonos.dev"
          className="fixed top-10 left-1/2 -translate-x-1/2 group items-center border border-input rounded-full px-4 py-1.5 flex mb-4.5 text-xs hover:bg-alpha-gray-2 dark:hover:bg-background transition-theme"
          target="_blank"
          rel="noreferrer"
        >
          CarbonOS
          <span className="hidden md:inline-flex">: now in private beta</span>
          <LuMoveUpRight className="ml-2" />
          <span className="absolute -top-px left-[2.5rem] h-px w-[calc(100%-5rem)] bg-gradient-to-r from-emerald-600/0 via-emerald-600/80 to-emerald-600/0 opacity-0 group-hover:opacity-100 transition-opacity transition-theme"></span>
          <span className="absolute -top-px left-1/2 -translate-x-1/2 h-px w-[60px] bg-gradient-to-r from-emerald-300/0 via-emerald-300/50 to-emerald-300/0 mix-blend-overlay opacity-0 group-hover:opacity-100 transition-opacity transition-theme"></span>
        </a>

        <div className="ray" data-theme="dark">
          <div className="light-ray ray-one"></div>
          <div className="light-ray ray-two"></div>
          <div className="light-ray ray-three"></div>
          <div className="light-ray ray-four"></div>
          <div className="light-ray ray-five"></div>
        </div>

        <div
          id="intro"
          className="flex flex-col pt-[28dvh] mx-auto w-container text-center"
        >
          <img
            src="https://app.carbonos.dev/carbon-logo-light.png"
            alt="CarbonOS"
            className="w-64 mx-auto"
          />
          {/* <h1 className="text-[3rem] sm:text-[6rem] md:text-[10rem] lg:text-[14rem] font-bold tracking-tighter lg:tracking-[-0.75rem] text-foreground">
            CarbonOS
          </h1> */}
          {/* <p className="mb-6 text-center text-muted-foreground">
            Realtime, collaborative, and powerful manufacturing software.
          </p> */}
          {/* <Button
            className="rounded-full w-fit mx-auto"
            size="lg"
            rightIcon={<LuMoveUpRight />}
          >
            Get Started
          </Button> */}
        </div>
      </div>
    </>
  );
}
