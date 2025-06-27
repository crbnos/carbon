import { LuBookOpen } from "react-icons/lu";

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
    background: "#00bba7",
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
      // {
      //   name: "Setup",
      //   id: "setup",
      //   description: "Learn about Carbon's architecture and how it works.",
      // },
    ],
  },
  // {
  //   name: "Selling",
  //   background: "#6041d0",
  //   foreground: "#fff",
  //   id: "selling",
  //   icon: <LuCrown />,
  //   courses: [],
  // },
];
