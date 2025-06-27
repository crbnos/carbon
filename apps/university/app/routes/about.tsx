import { Button, Heading } from "@carbon/react";
import { Link } from "@remix-run/react";
import { LuBookOpen, LuCirclePlay } from "react-icons/lu";
import { Hero } from "~/components/Hero";
import { sections } from "~/config";
import { path } from "~/utils/path";

export default function AboutRoute() {
  return (
    <div className="w-full flex flex-col">
      <Hero>
        <Heading
          size="h1"
          className="font-display text-[#212578] dark:text-white max-w-2xl"
        >
          What do you want to learn?
        </Heading>
        <p className="text-base max-w-2xl">
          Want to take command of your business? Need a quick answer to a
          problem? Test your knowledge and track your progress
        </p>
        <div className="flex items-center gap-2">
          <Button
            size="lg"
            variant="secondary"
            leftIcon={<LuCirclePlay />}
            asChild
          >
            <Link
              to={path.to.video(sections[0].courses[0].topics[0].videos[0].id)}
            >
              Begin your first lesson
            </Link>
          </Button>
          <Button
            size="lg"
            variant="secondary"
            leftIcon={<LuBookOpen />}
            asChild
          >
            <Link to={path.to.about}>See how it works</Link>
          </Button>
        </div>
      </Hero>
      <div className="w-full px-4 max-w-6xl mx-auto my-16"></div>
    </div>
  );
}
