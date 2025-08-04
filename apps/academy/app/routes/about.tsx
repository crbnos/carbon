import { Button, Heading } from "@carbon/react";
import { Link } from "@remix-run/react";
import { LuCirclePlay } from "react-icons/lu";
import { Hero } from "~/components/Hero";
import { modules } from "~/config";
import { useOptionalUser } from "~/hooks/useUser";
import { path } from "~/utils/path";

export default function AboutRoute() {
  const user = useOptionalUser();
  return (
    <div className="w-full flex flex-col">
      <Hero>
        <Heading
          size="display"
          className="font-display text-[#212578] dark:text-white max-w-2xl"
        >
          Carbon Academy
        </Heading>
        <p className="text-muted-foreground text-balance text-left font-medium tracking-tighter text-lg max-w-2xl">
          Want to take command of your business? Need a quick answer to a
          problem or onboard a new employee? Test your knowledge and track your
          progress.
        </p>
        <div className="flex items-center gap-2">
          {user ? (
            <Button
              size="lg"
              variant="secondary"
              leftIcon={<LuCirclePlay />}
              asChild
            >
              <Link
                to={path.to.lesson(
                  modules[0].courses[0].topics[0].lessons[0].id
                )}
              >
                Begin your first lesson
              </Link>
            </Button>
          ) : (
            <Button
              size="lg"
              variant="secondary"
              leftIcon={<LuCirclePlay />}
              asChild
            >
              <Link to={path.to.login}>Sign up to register</Link>
            </Button>
          )}
        </div>
      </Hero>
      <section className="border-b">
        <div className="flex flex-row gap-8 w-full px-4 max-w-5xl mx-auto my-24">
          <div className="flex flex-col max-w-2xl gap-6">
            <h3 className="text-muted-foreground uppercase text-sm font-display leading-[140%] tracking-tighter">
              How it works
            </h3>
            <Heading
              size="h1"
              className="font-display text-[#212578] dark:text-white max-w-2xl"
            >
              Register and Track Your Progress
            </Heading>
            <p className="text-muted-foreground text-balance text-left font-medium tracking-tighter text-lg">
              Sign up to track your progress. Then join a course! All courses
              are free, and you can earn your credential(s) for free too.
              Courses in Carbon Academy are designed to build off of each other
              as you follow the recommended path. You can also jump around if
              you'd like to skip ahead on anything.
            </p>
          </div>
        </div>
      </section>
      <section>
        <div className="flex flex-row gap-8 w-full px-4 max-w-5xl mx-auto my-24">
          <div className="flex flex-col max-w-2xl gap-6">
            <h3 className="text-muted-foreground uppercase text-sm font-display leading-[140%] tracking-tighter">
              Challenges
            </h3>
            <Heading
              size="h1"
              className="font-display text-[#212578] dark:text-white max-w-2xl"
            >
              Take Challenges
            </Heading>
            <p className="text-muted-foreground text-balance text-left font-medium tracking-tighter text-lg">
              Put your new Carbon knowledge to the test by taking challenges.
              You'll need to score 100% to pass a challenge, but there is no
              limit on the number of attempts.
            </p>
            <div className="flex items-center gap-2">
              <Button
                size="lg"
                variant="secondary"
                leftIcon={<LuCirclePlay />}
                asChild
              >
                <Link
                  to={path.to.lesson(
                    modules[0].courses[0].topics[0].lessons[0].id
                  )}
                >
                  Begin your first lesson
                </Link>
              </Button>
              <Button
                size="lg"
                variant="secondary"
                leftIcon={<LuCirclePlay />}
                asChild
              >
                <Link to={path.to.login}>Sign up to take challenges</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
