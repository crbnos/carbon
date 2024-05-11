"use client";

import ContactForm from "@/components/ContactForm";
import { Tabs } from "@/components/Tabs";
import { Button, cn } from "@carbon/react";
import Image from "next/image";
import Link from "next/link";
import { BsGithub, BsLightningCharge, BsPlay } from "react-icons/bs";
import { GiSpeedometer } from "react-icons/gi";
import { GoSync } from "react-icons/go";
import { HiCode, HiFingerPrint } from "react-icons/hi";
import { TbBuildingFactory2 } from "react-icons/tb";

export default function Page() {
  return (
    <>
      <Hero />
      <ProductViews />
      <OpenCore />
      {/* <Calendar /> */}
    </>
  );
}

function Hero() {
  return (
    <>
      <div className="my-12 sm:my-36 flex flex-col space-y-8 max-w-2xl mx-auto text-center">
        <div className="text-center mb-4">
          <div className="fancy-button rounded-full w-fit mx-auto relative">
            <Link href="https://www.loom.com/share/7eb03a5e4d4d4836b34f173805fb7403?sid=7ed308d0-8d59-4230-a3f1-137aae3c24da">
              <Button
                className="border-border rounded-full"
                variant="secondary"
                leftIcon={<BsPlay />}
                asChild
              >
                <div>Watch the guided tour</div>
              </Button>
            </Link>
          </div>
        </div>
        <h1 className="max-w-5xl mx-auto text-5xl font-semibold tracking-tighter leading-tighter sm:text-6xl lg:text-7xl">
          <span className="dark:bg-clip-text dark:text-transparent dark:bg-gradient-to-b dark:from-white  dark:to-zinc-400">
            ERP for
          </span>{" "}
          <span className="bg-gradient-to-r bg-clip-text text-transparent dark:bg-gradient-to-b dark:from-[#3ECF8E] dark:via-[#3ECF8E] dark:to-[#3ecfb2] from-black to-black">
            the builders
          </span>
        </h1>
        <div className="max-w-xl mx-auto flex flex-col items-center text-center space-y-8">
          <p className="text-lg font-medium leading-tight text-foreground/60 md:text-xl lg:text-2xl">
            Powerful, modern and open, Carbon makes it easy to build the system
            your business needs.
          </p>
          <ContactForm />
        </div>
      </div>
    </>
  );
}

const ImageContainer: React.FC<{ imagePath: string }> = ({ imagePath }) => {
  return (
    <div
      style={{
        boxShadow:
          "0 0 #0000004d, 0 9px 20px #0000004a, 0 37px 37px #00000042, 0 84px 50px #00000026, 0 149px 60px #0000000a, 0 233px 65px #00000003",
      }}
      className="max-w-5xl -mt-12 mx-auto h-[30rem] md:h-[40rem] w-full border-4 border-[#6C6C6C] p-2 bg-[#222222] rounded-[30px] shadow-xl overflow-hidden"
    >
      <Image
        src={imagePath}
        className="rounded-xl"
        width="1209"
        height="903"
        alt="carbon manufacturing"
      />
    </div>
  );
};

function ProductViews() {
  const tabs = [
    {
      title: "Manufacturing",
      description:
        "Infinitely nestable, infinitely customizable bill of materials",
      value: "manufacturing",
      content: (
        <ImageContainer imagePath="/carbon-dark-mode-manufacturing.jpg" />
      ),
    },
    {
      title: "Accounting",
      description:
        "Realtime chart of accounts with double-entry accrual accounting",
      value: "accounting",
      content: (
        <ImageContainer imagePath={"/carbon-dark-mode-accounting.jpg"} />
      ),
    },
    {
      title: "Search",
      description: "Search across all your core or custom fields",
      value: "search",
      content: <ImageContainer imagePath={"/carbon-dark-mode-search.jpg"} />,
    },

    {
      title: "Permissions",
      description: "Fine-grained permissions for every user and every action",
      value: "permission",
      content: (
        <ImageContainer imagePath={"/carbon-dark-mode-permissions.jpg"} />
      ),
    },
    {
      title: "Documents",
      description: "Store and manage all your documents in one place",
      value: "documents",
      content: <ImageContainer imagePath={"/carbon-dark-mode-documents.jpg"} />,
    },
  ];

  return (
    <div className="h-[20rem] md:h-[40rem] [perspective:1000px] relative b flex-col max-w-5xl mx-auto w-full  items-start justify-start my-40 hidden md:flex">
      <Tabs tabs={tabs} />
    </div>
  );
}

const features = [
  {
    name: "High-Performance",
    icon: GiSpeedometer,
    description:
      "Built on best open-source technologies for incredible performance and security.",
  },
  {
    name: "Permissive License",
    icon: HiCode,
    description:
      "Unlike other open-source ERPs, you can use Carbon to build your own proprietary systems.",
  },
  {
    name: "Serverless",
    icon: GoSync,
    description:
      "So you can focus on your business systems, not your infrastructure.",
  },
  {
    name: "Realtime",
    icon: BsLightningCharge,
    description: "All data can be updated in realtime across applications.",
  },
  {
    name: "Manufacturing",
    icon: TbBuildingFactory2,
    description: "Carbon has first-class support for American manufacturing.",
  },
  {
    name: "Single Tenant",
    icon: HiFingerPrint,
    description:
      "You're not sharing databases with other companies. Your database is yours. Take it anytime.",
  },
] as const;

function OpenCore() {
  return (
    <section className="relative py-24 sm:py-36 lg:py-48 radial-gradient">
      <div className="flex flex-col space-y-8 px-4 mx-auto  lg:max-w-7xl">
        <h2 className="text-4xl font-semibold tracking-tight lg:text-5xl xl:text-6xl text-center text-foreground">
          Open Core
        </h2>
        <div className="mt-8 w-full text-center">
          <Link href="https://git.new/carbon">
            <div className="fancy-button rounded-full w-fit mx-auto relative mb-6">
              <Button
                className="border-border rounded-full"
                variant="secondary"
                leftIcon={<BsGithub />}
                asChild
              >
                <div>Star us on GitHub</div>
              </Button>
            </div>
          </Link>
        </div>
        <p className="mx-auto text-xl font-medium text-foreground/60 lg:max-w-3xl lg:text-2xl text-center">
          Carbon is the only ERP that gives you full ownership over your
          software stack. With Carbon{" "}
          <span className="underline underline-offset-2">
            you aren&apos;t a renter, you&apos;re an owner
          </span>
          .
        </p>

        <div className="grid md:auto-rows-[18rem] grid-cols-1 md:grid-cols-3 gap-4 max-w-7xl mx-auto">
          {features.map(({ icon: Icon, ...feature }, i) => (
            <div
              className={cn(
                "row-span-1 group/bento items-start p-8 space-y-4 bg-black/[0.03] dark:bg-zinc-900 round transition-all duration-300 ease-in-out rounded-lg shadow group ring-2 ring-transparent hover:ring-white/10 text-left"
              )}
              key={feature.name.split(" ").join("-")}
            >
              <Icon
                className="text-primary dark:text-zinc-900 w-10 h-10 dark:p-2 dark:bg-[#3ECF8E] rounded-full glow-green"
                aria-hidden="true"
              />
              <h2 className="font-semibold text-foreground text-xl md:text-2xl lg:text-3xl tracking-tight">
                {feature.name}
              </h2>
              <p className="font-medium text-foreground/60 text-lg">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// function Calendar() {
//   const { theme } = useTheme();
//   useEffect(() => {
//     (async function () {
//       const cal = await getCalApi();
//       cal("ui", {
//         theme: (theme ?? "light") as "dark" | "light",
//         styles: { branding: { brandColor: "#000000" } },
//         hideEventTypeDetails: false,
//         layout: "month_view",
//       });
//     })();
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, []);
//   return (
//     <section className="flex flex-col items-center py-24 gap-8">
//       <div className="text-4xl font-semibold tracking-tight lg:text-5xl xl:text-6xl text-center text-foreground">
//         Chat with us
//       </div>
//       <Cal
//         calLink="bradbarbin/30min"
//         style={{ width: "100%", height: "100%", overflow: "scroll" }}
//         config={{ layout: "month_view" }}
//       />
//     </section>
//   );
// }
