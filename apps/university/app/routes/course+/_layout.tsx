import { Button, Heading } from "@carbon/react";
import { Link, Outlet } from "@remix-run/react";
import { LuBookOpen, LuCirclePlay } from "react-icons/lu";
import { Hero } from "~/components/Hero";
import { modules } from "~/config";
import { useOptionalUser } from "~/hooks/useUser";
import { path } from "~/utils/path";

export default function CourseLayout() {
  const user = useOptionalUser();
  return (
    <div className="w-full flex flex-col">
      {user === null && (
        <Hero>
          <Heading
            size="h1"
            className="font-display text-[#212578] dark:text-white max-w-xl"
          >
            Your Journey Starts Here
          </Heading>
          <p className="text-muted-foreground dark:text-foreground text-balance text-left font-medium tracking-tighter text-lg max-w-xl">
            Learn the basics of Carbon and start your journey to becoming an
            expert in Carbon. All for free.
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
              leftIcon={<LuBookOpen />}
              asChild
            >
              <Link to={path.to.about}>See how it works</Link>
            </Button>
          </div>
        </Hero>
      )}
      <div className="w-full px-4 max-w-5xl mx-auto my-16">
        <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6">
          <nav className="space-y-4">
            {modules.map((module) => (
              <div key={module.id} className="space-y-2">
                <h3
                  className="font-display font-bold uppercase text-xs"
                  style={{ color: module.background }}
                >
                  {module.name}
                </h3>
                <div className="space-y-0">
                  {module.courses.map((course) => (
                    <Link
                      key={course.id}
                      to={path.to.course(module.id, course.id)}
                      className="block py-1 text-sm hover:underline"
                    >
                      {course.name}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </nav>
          <main>
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
