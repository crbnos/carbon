import { Button as _Button, Heading as _Heading, VStack } from "@carbon/react";
import { Link } from "@remix-run/react";
import { AnimatePresence, motion } from "framer-motion";
import { onboardingSequence } from "~/utils/path";

const Heading = motion(_Heading);
const Button = motion(_Button);

const fade = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
};

export default function GetStarted() {
  return (
    <AnimatePresence>
      <VStack spacing={4} className="max-w-lg p-4 items-center text-center">
        <motion.img
          initial={{ opacity: 0, scale: 0.4 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 2, ease: "easeInOut" }}
          src="/carbon-logo-dark.png"
          alt="Carbon Logo"
          className="block dark:hidden max-w-[60px] mb-3"
        />
        <motion.img
          initial={{ opacity: 0, scale: 0.4 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 2, ease: "easeInOut" }}
          src="/carbon-logo-light.png"
          alt="Carbon Logo"
          className="hidden dark:block max-w-[60px] mb-3"
        />
        <Heading
          {...fade}
          transition={{ duration: 1.2, ease: "easeInOut", delay: 1.5 }}
          size="h1"
          className="m-0"
        >
          Welcome to CarbonOS
        </Heading>
        <motion.p
          {...fade}
          transition={{ duration: 1.2, ease: "easeInOut", delay: 1.5 }}
          className="text-muted-foreground text-sm pb-4"
        >
          CarbonOS is the operating system for manufacturing
        </motion.p>

        <Button
          {...fade}
          transition={{ duration: 1.2, ease: "easeInOut", delay: 1.5 }}
          size="lg"
          asChild
        >
          <Link to={onboardingSequence[0]}>Get Started</Link>
        </Button>
      </VStack>
    </AnimatePresence>
  );
}
