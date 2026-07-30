function timeOfDay(): string {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}

// A pool of complete greetings with varied tone — some time-aware, most casual/direct.
// One is picked at random per panel open, so it doesn't always sound the same.
const GREETINGS: Array<() => string> = [
  () => `Good ${timeOfDay()}! What can I help you with in Carbon today?`,
  () => `Good ${timeOfDay()} — what are you working on?`,
  () => "Hey! How can I help?",
  () => "Hi there 👋 What do you need?",
  () => "Hey, what's on your plate today?",
  () => "How's it going? Ask me anything about Carbon.",
  () => "What can I dig up for you?",
  () => "Ready when you are — what do you need?",
  () => "What would you like to know?",
  () => "Need to find something in Carbon? Just ask.",
  () => "Looking for something specific?",
  () => "Let's get to work — what's up?"
];

/** A random, tonally-varied greeting. */
export function pickGreeting(): string {
  return GREETINGS[Math.floor(Math.random() * GREETINGS.length)]();
}
