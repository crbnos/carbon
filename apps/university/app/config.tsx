import {
  LuBookOpen,
  LuCode,
  LuCrown,
  LuShield,
  LuShoppingCart,
  LuSquareStack,
} from "react-icons/lu";

type Config = Section[];

type Section = {
  name: string;
  id: string;
  background: string;
  foreground: string;
  icon: React.ReactNode;
  courses: Course[];
};

type Course = {
  name: string;
  id: string;
  description: string;
  topics: Topic[];
};

type Topic = {
  name: string;
  id: string;
  description: string;
  challenge: Question[];
  videos: Video[];
};

type Question = any;

type Video = {
  name: string;
  id: string;
  description: string;
  duration: number;
};

export const sections: Config = [
  {
    name: "Getting Started",
    background: "#6041d0",
    foreground: "#fff",
    id: "getting-started",
    icon: <LuBookOpen />,
    courses: [
      {
        name: "Carbon Overview",
        id: "carbon-overview",
        description:
          "Welcome to Carbon, a powerful ERP/MES/QMS software that uses web technology and a modular platform to offer a wide variety of configurations based on the customer’s needs. Learn about Carbon's architecture and setup in this first course.",
        topics: [
          {
            name: "Introducing Carbon",
            id: "introduction",
            description:
              "This topic covers the basics of Carbon. Here you will learn what it is, how the platform and modules work, and the architecture.",
            challenge: [],
            videos: [
              {
                id: "what-is-carbon",
                name: "What is Carbon?",
                description: "",
                duration: 100,
              },
              {
                id: "about-carbon-modules",
                name: "About Carbon's Modules",
                description: "",
                duration: 100,
              },
              {
                id: "carbon-architecture",
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
        topics: [
          {
            name: "Setting Up Your Company",
            id: "company-setup",
            description:
              "Learn how to setup your company in Carbon. This includes creating your company, adding users, and setting up your company's preferences. This is the first step to getting your organization ready to use Carbon.",
            challenge: [],
            videos: [
              {
                id: "company-setup",
                name: "Company Setup",
                description:
                  "Learn how to setup your company in Carbon. This includes creating your company, adding users, and setting up your company's preferences. This is the first step to getting your organization ready to use Carbon.",
                duration: 100,
              },
              {
                id: "users-setup",
                name: "Users & Permissions",
                description:
                  "Learn how to setup your users in Carbon. This includes creating your users, adding users, and setting up your users' preferences.",
                duration: 100,
              },
              {
                id: "resources-setup",
                name: "Resources",
                description:
                  "Learn how to setup your work centers, machines, and processes in Carbon. This is the first step to getting your organization ready to use Carbon.",
                duration: 100,
              },
              {
                id: "integrations-setup",
                name: "Integrations",
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
    name: "Bill of Materials",
    background: "#4AA99D",
    foreground: "#fff",
    id: "bom",
    icon: <LuSquareStack />,
    courses: [],
  },
  {
    name: "Selling",
    background: "#488FB9",
    foreground: "#fff",
    id: "selling",
    icon: <LuCrown />,
    courses: [],
  },
  {
    name: "Manufacturing",
    background: "#78B2C4",
    foreground: "#fff",
    id: "selling",
    icon: <LuCrown />,
    courses: [],
  },
  {
    name: "Buying",
    background: "#EFB655",
    foreground: "#fff",
    id: "buying",
    icon: <LuShoppingCart />,
    courses: [],
  },
  {
    name: "Quality",
    background: "#EF8729",
    foreground: "#fff",
    id: "quality",
    icon: <LuShield />,
    courses: [],
  },
  {
    name: "Developing",
    background: "#DD6444",
    foreground: "#fff",
    id: "developing",
    icon: <LuCode />,
    courses: [],
  },
  {
    name: "Example",
    background: "#AB7DB3",
    foreground: "#fff",
    id: "example-1",
    icon: <LuCrown />,
    courses: [],
  },
  {
    name: "Example",
    background: "#8487C5",
    foreground: "#fff",
    id: "example-2",
    icon: <LuCrown />,
    courses: [],
  },
];
