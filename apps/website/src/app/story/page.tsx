/* eslint-disable react/no-unescaped-entities */
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Carbon ERP | Story",
};

export default function Page() {
  return (
    <div className="prose dark:prose-invert container max-w-2xl my-24 text-xl space-y-8">
      <h1 className="text-3xl font-semibold sm:text-2xl lg:text-4xl xl:text-5xl text-center mb-16">
        Building Carbon
      </h1>

      <p>
        Like a lot of people, we've been through our share of bad ERP
        implementations. And like a lot of people, we've come to expect a lot
        from our software.
      </p>

      <h2 className="text-xl font-semibold sm:text-lg lg:text-2xl xl:text-3xl">
        Source Available
      </h2>
      <p>
        We've built Carbon for our past selves. And we've open-sourced it
        because we know we're not alone. Together, we are a community of
        manufacturers and developers who see a better way. And we understand
        that in order to make a system that is customized to your business,
        you've got to own all the code.
      </p>

      <h2 className="text-xl font-semibold sm:text-lg lg:text-2xl xl:text-3xl">
        Manufacturing-Focused
      </h2>
      <p>
        Manufacturing is hard enough. It's even harder when you're trying to
        make your processes match the ERP's expectations. We've built Carbon to
        be flexible, and we've built it to be simple so that you can model your
        business as closely as possible.
      </p>

      <h2 className="text-xl font-semibold sm:text-lg lg:text-2xl xl:text-3xl">
        Extensible
      </h2>
      <p>
        The mission of Carbon ERP is to become the platform upon which connected
        manufacturing ecosystems are built. The goal is to provide a solid
        foundation for businesses to build upon, and to provide a platform that
        is flexible enough to adapt to the ever-changing needs of the
        manufacturing industry.
      </p>
    </div>
  );
}
