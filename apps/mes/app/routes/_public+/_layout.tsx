import { Outlet, useLoaderData } from "@remix-run/react";
import { BsHexagonFill } from "react-icons/bs";

import type { LoaderFunctionArgs } from "@vercel/remix";

export async function loader({ request }: LoaderFunctionArgs) {
  return {
    data: getRandomQuote(),
  };
}

export default function PublicRoute() {
  const { data } = useLoaderData<typeof loader>();
  return (
    <div className="container relative h-full flex-col items-center justify-center grid lg:max-w-none lg:grid-cols-2 lg:px-0">
      <div className="relative hidden h-full flex-col bg-muted p-10 text-white lg:flex dark:border-r">
        <div className="absolute inset-0 bg-zinc-900" />
        <div className="relative z-20 flex items-center text-lg font-medium">
          <BsHexagonFill className="w-6 h-6 mr-2" />
          CarbonOS
        </div>
        {data && (
          <div className="relative z-20 mt-auto">
            <blockquote className="space-y-2">
              <p className="text-lg">&ldquo;{data?.quote}&rdquo;</p>
              <footer className="text-sm">{data?.source}</footer>
            </blockquote>
          </div>
        )}
      </div>
      <div className="lg:p-8">
        <div className="mx-auto flex w-full flex-col justify-center space-y-6 sm:w-[350px]">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

function getRandomQuote() {
  const randomQuote = quotes[Math.floor(Math.random() * quotes.length)];
  return randomQuote;
}

const quotes = [
  {
    quote: "Nothing can be changed until it is faced.",
    source: "James Baldwin",
  },
  {
    quote:
      "The Sun will rise and set regardless. What we choose to do with the light while it's here is up to us. Journey wisely.",
    source: "Alex Elle",
  },
  {
    quote: "I am unfolding slowly because blooming takes time.",
    source: "Alex Elle",
  },
  {
    quote: "Someone once told me love isn’t perfect—or predictable.",
    source: "Lauren Morrill",
  },
  {
    quote:
      "Sometimes you climb out of bed in the morning and you think, I'm not going to make it, but you laugh inside — remembering all the times you've felt that way",
    source: "Charles Bukowski",
  },
  {
    quote: "If you can't beat the fear, just do it scared.",
    source: "Glennon Doyle",
  },
  {
    quote: "There is a crack in everything. That's how the light gets in.",
    source: "Rumi",
  },
  {
    quote: "We must bring our own light into the darkness.",
    source: "Charles Bukowski",
  },
  {
    quote: "You are not too old. And it is not too late.",
    source: "Rainer Maria Rilke",
  },
  {
    quote: "There is nothing holding you back in life more than yourself.",
    source: "Brianna Wiest",
  },
  {
    quote:
      "Another person's success is not the absence of your own. Another person's progress is not the absence of your own. Another person's happiness is not the absense of your own.",
    source: "Brianna Wiest",
  },
  {
    quote:
      "The things we lose are not losses. They are entry ways. They are the world saying, sometimes sharply, there is something else out there.",
    source: "Brianna Wiest",
  },
  {
    quote: "You are allowed to outgrow people.",
    source: "Mantra Magazine",
  },
  {
    quote:
      "Stop feeling bad for outgrowing people who had the chance to grow with you.",
    source: "Hunter Pauley",
  },
  {
    quote: "Don't let someone live rent-free in your head.",
    source: "Ann Landers",
  },
  {
    quote:
      "Not everything that is faced can be changed, but nothing can be changed until it is faced.",
    source: "James Baldwin",
  },
  {
    quote: "No force on earth can stop an idea whose time has come.",
    source: "Victor Hugo",
  },
  {
    quote: "Learning never exhausts the mind.",
    source: "Leonardo da Vinci",
  },
  {
    quote: "The journey of a thousand miles begins with one step.",
    source: "Lao Tzu",
  },
  {
    quote: "If opportunity doesn't knock, build a door.",
    source: "Milton Berle",
  },
  {
    quote: "Everything has beauty, but not everyone sees it.",
    source: "Confucius",
  },
  {
    quote:
      "The best and most beautiful things in the world cannot be seen or even touched - they must be felt with the heart.",
    source: "Helen Keller",
  },
  {
    quote: "Simplicity is the ultimate sophistication.",
    source: "Leonardo da Vinci",
  },
  {
    quote: "The best revenge is massive success.",
    source: "Frank Sinatra",
  },
  {
    quote:
      "The distance between insanity and genius is measured only by success.",
    source: "Bruce Feirstein",
  },
  {
    quote: "Success is the sum of small efforts, repeated day-in and day-out.",
    source: "Robert Collier",
  },
  {
    quote: "The mind is everything. What you think you become.",
    source: "Gautama Buddha",
  },
  {
    quote: "Peace comes from within. Do not seek it without.",
    source: "Gautama Buddha",
  },
  {
    quote:
      "What you think, you become. What you feel, you attract. What you imagine, you create.",
    source: "The Buddha",
  },
  {
    quote: "Share your knowledge. It is a way to achieve immortality.",
    source: "The Dalai Lama",
  },
  {
    quote: "Man is made by his belief. As he believes, so he is.",
    source: "Bhagavad Gita",
  },
  {
    quote:
      "Life’s most persistent and urgent question is, ‘What are you doing for others?’",
    source: "Martin Luther King, Jr.",
  },
  {
    quote: "Once you choose hope, anythings possible.",
    source: "Christopher Reeve",
  },
  {
    quote: "Learn from yesterday, live for today, hope for tomorrow.",
    source: "Albert Einstein",
  },
  {
    quote: "Stay hungry, stay foolish.",
    source: "Steve Jobs",
  },
  {
    quote: "The only way to do great work is to love what you do.",
    source: "Steve Jobs",
  },
  {
    quote: "You are never too old to set another goal or to dream a new dream.",
    source: "C.S. Lewis",
  },
];
