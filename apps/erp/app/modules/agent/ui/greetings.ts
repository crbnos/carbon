function timeGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

const OPENERS = [
  "What can I help you with in Carbon today?",
  "What are you working on? I can look things up across Carbon.",
  "Ask me anything about Carbon — jobs, orders, inventory, and more.",
  "How can I help you get things done today?",
  "Need to find something? I can search the docs and your data.",
  "What would you like to know?",
  "I’m here to help — what’s on your plate?",
  "Looking for something specific? Just ask.",
  "Let’s get to work — what do you need?",
  "What can I dig up for you today?"
];

/** A friendly, time-aware greeting picked at random. */
export function pickGreeting(): string {
  const opener = OPENERS[Math.floor(Math.random() * OPENERS.length)];
  return `${timeGreeting()}! ${opener}`;
}
