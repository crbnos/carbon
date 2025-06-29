import { LuCirclePlay, LuHexagon } from "react-icons/lu";

type Config = Section[];

type Section = {
  name: string;
  id: string;
  background: string;
  foreground: string;
  courses: Course[];
};

type Course = {
  name: string;
  id: string;
  description: string;
  icon: React.ReactNode;
  topics: Topic[];
};

type Topic = {
  name: string;
  id: string;
  description: string;
  challenge: Question[];
  lessons: Lesson[];
};

interface Question {
  id: string;
  question: string;
  options: string[];
  correctAnswer: number; // index of the correct option
}

type Lesson = {
  name: string;
  id: string;
  videoId: string;
  description: string;
  duration: number;
};

export const sections: Config = [
  {
    name: "Getting Started",
    background: "#6041d0",
    foreground: "#fff",
    id: "getting-started",
    courses: [
      {
        name: "Carbon Overview",
        id: "carbon-overview",
        description:
          "Welcome to Carbon, a powerful ERP/MES/QMS software that uses web technology and a modular platform to offer a wide variety of configurations based on the customer's needs. Learn about Carbon's architecture and setup in this first course.",
        icon: <LuHexagon />,
        topics: [
          {
            name: "Introducing Carbon",
            id: "introduction",
            description:
              "This topic covers the basics of Carbon. Here you will learn what it is, how the platform and modules work, and the architecture.",
            challenge: [
              {
                id: "q1",
                question: "What is Carbon?",
                options: [
                  "A programming language",
                  "A powerful ERP/MES/QMS software",
                  "A database management system",
                  "A web framework",
                ],
                correctAnswer: 1,
              },
              {
                id: "q2",
                question: "What technology does Carbon primarily use?",
                options: [
                  "Mobile apps",
                  "Desktop software",
                  "Web technology",
                  "Cloud computing only",
                ],
                correctAnswer: 2,
              },
              {
                id: "q3",
                question: "How is Carbon designed to be?",
                options: [
                  "Complex and difficult to use",
                  "Approachable and easy to get started with",
                  "Only for large enterprises",
                  "Limited in functionality",
                ],
                correctAnswer: 1,
              },
            ],
            lessons: [
              {
                id: "what-is-carbon",
                videoId: "1234567890",
                name: "What is Carbon?",
                description:
                  "Meet Carbon, the next generation of accessible, scalable, and data-centric ERP/MES/QMS software. Carbon was designed from the ground up to be approachable and easy to get started with, but highly flexible and capable of scaling up to the largest projects.",
                duration: 100,
              },
              {
                id: "about-carbon-modules",
                videoId: "1234567890",
                name: "About Carbon's Modules",
                description: "",
                duration: 100,
              },
              {
                id: "carbon-architecture",
                videoId: "1234567890",
                name: "Carbon's Architecture",
                description: "",
                duration: 100,
              },
            ],
          },
        ],
      },
      {
        name: "Getting Setup",
        id: "getting-setup",
        description: "Learn how to setup your organization to use Carbon.",
        icon: <LuCirclePlay />,
        topics: [
          {
            name: "Setting Up Your Company",
            id: "company-setup",
            description:
              "Learn how to setup your company in Carbon. This includes creating your company, adding users, and setting up your company's preferences. This is the first step to getting your organization ready to use Carbon.",
            challenge: [
              {
                id: "q1",
                question:
                  "What is the first step to getting your organization ready to use Carbon?",
                options: [
                  "Setting up integrations",
                  "Creating your company",
                  "Adding users",
                  "Setting up resources",
                ],
                correctAnswer: 1,
              },
              {
                id: "q2",
                question:
                  "Which of the following is NOT part of company setup?",
                options: [
                  "Creating your company",
                  "Adding users",
                  "Setting up preferences",
                  "Installing software",
                ],
                correctAnswer: 3,
              },
            ],
            lessons: [
              {
                id: "company-setup",
                name: "Company Setup",
                videoId: "1234567890",
                description:
                  "Learn how to setup your company in Carbon. This includes creating your company, adding users, and setting up your company's preferences. This is the first step to getting your organization ready to use Carbon.",
                duration: 100,
              },
              {
                id: "users-setup",
                name: "Users & Permissions",
                videoId: "1234567890",
                description:
                  "Learn how to setup your users in Carbon. This includes creating your users, adding users, and setting up your users' preferences.",
                duration: 100,
              },
              {
                id: "resources-setup",
                name: "Resources",
                videoId: "1234567890",
                description:
                  "Learn how to setup your work centers, machines, and processes in Carbon. This is the first step to getting your organization ready to use Carbon.",
                duration: 100,
              },
              {
                id: "integrations-setup",
                name: "Integrations",
                videoId: "1234567890",
                description: "Learn how to setup your integrations in Carbon.",
                duration: 100,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    name: "Parts & Materials",
    background: "#4AA99D",
    foreground: "#fff",
    id: "bom",
    courses: [],
  },
  {
    name: "Selling",
    background: "#488FB9",
    foreground: "#fff",
    id: "selling",
    courses: [],
  },
  {
    name: "Manufacturing",
    background: "#78B2C4",
    foreground: "#fff",
    id: "selling",
    courses: [],
  },
  {
    name: "Buying",
    background: "#EFB655",
    foreground: "#fff",
    id: "buying",
    courses: [],
  },
  {
    name: "Shipping & Receiving",
    background: "#EF8729",
    foreground: "#fff",
    id: "quality",
    courses: [],
  },
  {
    name: "Quality",
    background: "#DD6444",
    foreground: "#fff",
    id: "developing",
    courses: [],
  },
  {
    name: "Developing",
    background: "#8487C5", // "#AB7DB3",
    foreground: "#fff",
    id: "example-1",
    courses: [],
  },
  // {
  //   name: "Example",
  //   background: "#8487C5",
  //   foreground: "#fff",
  //   id: "example-2",
  //   courses: [],
  // },
];
