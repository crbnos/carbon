import {
  LuBox,
  LuCalculator,
  LuCirclePlay,
  LuCodeXml,
  LuFactory,
  LuFolderCheck,
  LuHexagon,
  LuShapes,
  LuShoppingCart,
  LuSquareStack,
  LuTruck,
  LuTvMinimalPlay,
  LuUpload,
} from "react-icons/lu";

type Config = Module[];

type Module = {
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
  supplemental?: Lesson[];
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
  loomUrl: string;
  description: string;
  duration: number;
};

export const modules: Config = [
  {
    name: "Carbon Overview",
    background: "#6041d0",
    foreground: "#fff",
    id: "carbon-overview",
    courses: [
      {
        name: "Introducing Carbon",
        id: "introducing-carbon",
        description:
          "Learn the fundamentals of Carbon and understand its architecture and capabilities.",
        icon: <LuHexagon />,
        topics: [
          {
            name: "What is Carbon?",
            id: "what-is-carbon",
            description:
              "Meet Carbon, the next generation of accessible, scalable, and data-centric ERP/MES/QMS software.",
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
                loomUrl:
                  "https://www.loom.com/share/51e0c6dd053b4a3e904fc795d4fc298f?sid=0bb2081d-6bc4-4efb-8361-d2717dda9781",
                name: "What is Carbon?",
                description:
                  "Meet Carbon, the next generation of accessible, scalable, and data-centric ERP/MES/QMS software. Carbon was designed from the ground up to be approachable and easy to get started with, but highly flexible and capable of scaling up to the largest projects.",
                duration: 0,
              },
              {
                id: "carbon-modules",
                loomUrl:
                  "https://www.loom.com/share/6d0edd4106e4440a9df253a711b1fc85?sid=d84101c2-7673-495f-a97c-e662d46ed974",
                name: "Carbon's Modules",
                description:
                  "Learn about Carbon's modular architecture and how different modules work together to provide comprehensive business management capabilities.",
                duration: 205,
              },
              {
                id: "architecture-overview",
                loomUrl:
                  "https://www.loom.com/share/0dcb2952495f41a3931d30ce30ecf60b?sid=a6901e78-ee3d-4b9d-8beb-349d5900f025",
                name: "Architecture Overview",
                description:
                  "Understand Carbon's technical architecture, including its web-based design, database structure, and API capabilities.",
                duration: 123,
              },
            ],
          },
        ],
      },
      {
        name: "The Basics",
        id: "the-basics",
        description:
          "Master the fundamental components of Carbon's interface and data management.",
        icon: <LuShapes />,
        topics: [
          {
            name: "Core Components",
            id: "core-components",
            description:
              "Learn about the essential building blocks of Carbon: tables, forms, documents, and custom fields.",
            challenge: [
              {
                id: "q1",
                question:
                  "Which component is used to display and manage data in Carbon?",
                options: ["Forms", "Tables", "Documents", "Custom Fields"],
                correctAnswer: 1,
              },
              {
                id: "q2",
                question:
                  "What allows you to collect and edit information in Carbon?",
                options: ["Tables", "Forms", "Documents", "Custom Fields"],
                correctAnswer: 1,
              },
            ],
            lessons: [
              {
                id: "tables",
                loomUrl:
                  "https://www.loom.com/share/215955b2b240439f875de13b47f91ac3?sid=0b256eef-13ef-4f43-9191-2b9a8f57aa14",
                name: "Tables & Views",
                description:
                  "Learn how to use tables to view, sort, filter, and manage your data effectively in Carbon.",
                duration: 151,
              },
              {
                id: "forms",
                loomUrl:
                  "https://www.loom.com/share/0559b51e4ce44cb9ae2b8c679fd4fed8?sid=0639aec8-55ba-4524-912c-63e16fb6e7da",
                name: "Forms",
                description:
                  "Master the art of creating and using forms to input and edit data in Carbon.",
                duration: 99,
              },
              {
                id: "documents",
                loomUrl:
                  "https://www.loom.com/share/8ec23411c1b24404ba2d427c64d3ff2c?sid=2727efcb-2c3e-4560-ae3d-9865ec673a1b",
                name: "Documents",
                description:
                  "Understand how to work with documents, including creation, editing, and sharing capabilities.",
                duration: 109,
              },
              {
                id: "custom-fields",
                loomUrl:
                  "https://www.loom.com/share/2ae2dd19c507426dbca78f0b3f071e17?sid=0d2b0dab-287b-4155-8b65-aeed58e5eba9",
                name: "Custom Fields",
                description:
                  "Learn how to extend Carbon's functionality by creating custom fields to capture additional data.",
                duration: 166,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    name: "Getting Started",
    background: "#4AA99D",
    foreground: "#fff",
    id: "getting-started",
    courses: [
      {
        name: "Setting Up Your Company",
        id: "setting-up-company",
        description:
          "Learn how to setup your organization to use Carbon effectively.",
        icon: <LuCirclePlay />,
        topics: [
          {
            name: "Company Setup",
            id: "company-setup",
            description:
              "Learn how to setup your company in Carbon. This includes creating your company, adding users, and setting up your company's preferences.",
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
                loomUrl:
                  "https://www.loom.com/share/d327844f2da4420c9a579f73b343601b?sid=f7f94b5a-68f5-47b5-a1bd-948247be1cda",
                description:
                  "Learn how to setup your company in Carbon. This includes creating your company, adding users, and setting up your company's preferences.",
                duration: 158,
              },
              {
                id: "users-permissions",
                name: "Users and Permissions",
                loomUrl:
                  "https://www.loom.com/share/39927f9213224b91a071f4b907ee55bd?sid=1fb2d1f0-28e3-43f4-a0b4-e490a36c8e4c",
                description:
                  "Learn how to setup your users in Carbon. This includes creating users, setting permissions, and managing access levels.",
                duration: 150,
              },
              {
                id: "locations-resources",
                name: "Locations and Resources",
                loomUrl:
                  "https://www.loom.com/share/f05bf13276d341a284670b0792b216c4?sid=324008b1-08bd-4c10-80ee-d1ad23e033a0",
                description:
                  "Learn how to setup your work centers, machines, and processes in Carbon. This is essential for manufacturing and resource planning.",
                duration: 301,
              },
              {
                id: "integrations",
                name: "Integrations",
                loomUrl:
                  "https://www.loom.com/share/ee50229e2f294170878038639479a18e?sid=49a1a785-5a45-42b8-bc30-809f2e50fb43",
                description:
                  "Learn how to setup your integrations in Carbon to connect with other business systems and tools.",
                duration: 91,
              },
            ],
          },
        ],
      },
      {
        name: "Migrating Data",
        id: "migrating-data",
        description:
          "Learn how to import and migrate your existing data into Carbon.",
        icon: <LuUpload />,
        topics: [
          {
            name: "Import Tools",
            id: "import-tools",
            description:
              "Learn how to use Carbon's import tools to bring your existing data into the system efficiently.",
            challenge: [
              {
                id: "q1",
                question:
                  "What is the primary method for importing data into Carbon?",
                options: [
                  "Manual entry",
                  "Import tools",
                  "API only",
                  "Database migration",
                ],
                correctAnswer: 1,
              },
            ],
            lessons: [
              {
                id: "import-tools",
                name: "Import Tools",
                loomUrl:
                  "https://www.loom.com/share/48df93ff658342e19a75c178a744c032?sid=0da5594c-26f9-4b51-aa80-670d02ad839c",
                description:
                  "Learn how to use Carbon's built-in import tools to efficiently migrate your data from other systems.",
                duration: 174,
              },
            ],
            supplemental: [
              {
                id: "importing-data-api",
                loomUrl:
                  "https://www.loom.com/share/51e0c6dd053b4a3e904fc795d4fc298f?sid=0bb2081d-6bc4-4efb-8361-d2717dda9781",
                name: "Importing Data with the API",
                description:
                  "Learn how to use Carbon's API to programmatically import data and integrate with other systems.",
                duration: 0,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    name: "Parts and Materials",
    background: "#488FB9",
    foreground: "#fff",
    id: "parts-materials",
    courses: [
      {
        name: "Defining an Item",
        id: "defining-item",
        description:
          "Learn how to define and manage different types of items in Carbon.",
        icon: <LuSquareStack />,
        topics: [
          {
            name: "Item Types",
            id: "item-types",
            description:
              "Understand the different types of items in Carbon: parts, materials, consumables, and tools.",
            challenge: [
              {
                id: "q1",
                question:
                  "Which of the following is NOT a type of item in Carbon?",
                options: ["Parts", "Materials", "Consumables", "Services"],
                correctAnswer: 3,
              },
            ],
            lessons: [
              {
                id: "parts-materials-consumables-tools",
                loomUrl:
                  "https://www.loom.com/share/acad6206adde4d1185e83f57393f36e9?sid=3cec60b1-91e3-454b-a6dd-f08fe1035ef2",
                name: "Parts, Materials and Tools",
                description:
                  "Learn the differences between various item types and when to use each one in your business processes.",
                duration: 140,
              },
              {
                id: "raw-materials",
                loomUrl:
                  "https://www.loom.com/share/4a8a1ad61bb44521b421e08f7152953c?sid=05cd0ff7-da25-4042-8967-ae0e19179cf1",
                name: "Raw Materials",
                description:
                  "Learn how to define and manage raw materials in Carbon.",
                duration: 242,
              },
              {
                id: "method-types",
                loomUrl:
                  "https://www.loom.com/share/bdd3c9479b8445a7abee54427c51bb57?sid=c2847cd1-6a40-486b-bf71-f3977c6ef598",
                name: "Method Types",
                description:
                  "Understand the different method types available for items and how they affect manufacturing processes.",
                duration: 289,
              },
              {
                id: "tracking-types",
                loomUrl:
                  "https://www.loom.com/share/30a89f804dd543ef98ccd37496e14bae?sid=a5995cf6-7a4f-450b-9e99-b1beae61a444",
                name: "Tracking Types",
                description:
                  "Learn about different tracking types and how they help manage inventory and traceability.",
                duration: 242,
              },
            ],
          },
          {
            name: "Manufacturing Methods",
            id: "manufacturing-methods",
            description:
              "Learn how to create and manage manufacturing methods, bills of process, and bills of materials.",
            challenge: [
              {
                id: "q1",
                question: "What defines how an item is manufactured in Carbon?",
                options: [
                  "Bill of Materials",
                  "Method",
                  "Process",
                  "Work Order",
                ],
                correctAnswer: 1,
              },
            ],
            lessons: [
              {
                id: "methods",
                loomUrl:
                  "https://www.loom.com/share/2d8403ecd2d5482da7034fd7f0b21969?sid=241d93bc-31c9-44e5-803a-88da0f24d49a",
                name: "Methods",
                description:
                  "Learn how to create and manage manufacturing methods that define how items are produced.",
                duration: 179,
              },

              {
                id: "bill-of-materials",
                loomUrl:
                  "https://www.loom.com/share/95252bd69ff74ddd8147bc0267d8d3d8?sid=dbecc174-40f2-48b0-9881-574d7e36c39b",
                name: "Bill of Materials",
                description:
                  "Learn how to create and manage bills of materials that define what components are needed.",
                duration: 173,
              },
              {
                id: "bill-of-process",
                loomUrl:
                  "https://www.loom.com/share/f4b8f9d550334e41b2b2708b5b73a7c6?sid=daf88059-7d31-4c24-93fa-ec3c4d0d6b3a",
                name: "Bill of Process",
                description:
                  "Understand how to create and manage bills of process that define the manufacturing steps.",
                duration: 269,
              },

              {
                id: "revisions-versions",
                loomUrl:
                  "https://www.loom.com/share/4281db40849c42aa856120058ced3d7b?sid=43ac885f-9111-47c8-9959-0d9171d65d4c",
                name: "Revisions and Versions",
                description:
                  "Master the revision and version control system for managing changes to methods and bills.",
                duration: 212,
              },
              {
                id: "get-method-save-method",
                loomUrl:
                  "https://www.loom.com/share/77f4a8f65c234b2c8f853ed8596003be?sid=87764c32-8656-4179-9d4b-77fe0a41ab11",
                name: "Get Method and Save Method",
                description:
                  "Learn how to retrieve and save methods programmatically using Carbon's API.",
                duration: 200,
              },
            ],
          },
          {
            name: "Advanced Manufacturing",
            id: "advanced-manufacturing",
            description:
              "Learn how to use Carbon's product configurator to create complex, configurable products.",
            challenge: [
              {
                id: "q1",
                question:
                  "What is the primary purpose of procedures in Carbon?",
                options: [
                  "To track customer preferences",
                  "To standardize the manufacturing process",
                  "To manage inventory levels",
                  "To create invoices",
                ],
                correctAnswer: 1,
              },
            ],
            lessons: [
              {
                id: "procedures",
                loomUrl:
                  "https://www.loom.com/share/e567df69608744ca8c2b16cb5751f76d?sid=42c982fe-2f53-49d3-9364-d3c8fe56d2ee",
                name: "Procedures",
                description:
                  "Learn how to create and manage procedures that define the manufacturing steps.",
                duration: 215,
              },
              {
                id: "subassemblies-vs-kits",
                loomUrl:
                  "https://www.loom.com/share/48d6f4a04c6e4b0484a1e0b875fd3a0d?sid=b87c0d16-b51b-45e3-8d47-ed90ff9f3eff",
                name: "Subassemblies vs Kits",
                description:
                  "Learn the difference between subassemblies and kits and when to use each one.",
                duration: 214,
              },
              {
                id: "product-configurator",
                loomUrl:
                  "https://www.loom.com/share/ec2f2c8607274c2cb35d3479ff97c86a?sid=6635bc72-1c9e-407a-ac6f-fded2726fbcb",
                name: "Product Configurator",
                description:
                  "Learn how to use Carbon's product configurator to create complex, configurable products.",
                duration: 328,
              },
            ],
            supplemental: [],
          },
        ],
      },
      {
        name: "Replenishing an Item",
        id: "replenishing-item",
        description:
          "Learn how to keep your inventory stocked using Carbon's planning, purchasing, and job management tools.",
        icon: <LuBox />,
        topics: [
          {
            name: "Replenishing an Item",
            id: "replenishing-an-item",
            description:
              "Understand the full lifecycle of replenishing inventory, including traceability, planning, purchasing, and job creation.",
            challenge: [
              {
                id: "q1",
                question:
                  "Which of the following is NOT a method for replenishing inventory in Carbon?",
                options: [
                  "Manual stock adjustment",
                  "Automated planning and purchasing",
                  "Job creation for manufacturing",
                  "Ignoring low stock alerts",
                ],
                correctAnswer: 3,
              },
            ],
            lessons: [
              {
                id: "inventory-management",
                loomUrl:
                  "https://www.loom.com/share/51e0c6dd053b4a3e904fc795d4fc298f?sid=0bb2081d-6bc4-4efb-8361-d2717dda9781",
                name: "Inventory Levels",
                description:
                  "Learn how to monitor and manage inventory levels, set reorder points, and handle stock movements.",
                duration: 0,
              },
              {
                id: "planning",
                loomUrl:
                  "https://www.loom.com/share/2eda5d04792a4f91af2c6c375ec46bc3?sid=8b74758d-0273-429b-8a51-aeee9f74a7b6",
                name: "Planning",
                description:
                  "See how Carbon's planning tools help you forecast demand and generate replenishment requirements.",
                duration: 370,
              },
              {
                id: "reorder-policy",
                loomUrl: "",
                name: "Reorder Policies",
                description:
                  "Learn how different reorder-policies affect planning",
                duration: 0,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    name: "Selling",
    background: "#3c5ec0",
    foreground: "#fff",
    id: "selling",
    courses: [
      {
        name: "Quoting and Estimating",
        id: "quoting-estimating",
        description:
          "Learn how to create quotes, estimates, and convert them to orders.",
        icon: <LuCalculator />,
        topics: [
          {
            name: "Quoting",
            id: "quote-process",
            description:
              "Master the complete quoting process from RFQ to order conversion.",
            challenge: [
              {
                id: "q1",
                question: "What is the first step in the quoting process?",
                options: [
                  "Creating a quote",
                  "Recording an RFQ",
                  "Calculating costs",
                  "Sending to customer",
                ],
                correctAnswer: 1,
              },
            ],
            lessons: [
              {
                id: "recording-rfq",
                loomUrl:
                  "https://www.loom.com/share/51e0c6dd053b4a3e904fc795d4fc298f?sid=0bb2081d-6bc4-4efb-8361-d2717dda9781",
                name: "Recording an RFQ",
                description:
                  "Learn how to record and manage Request for Quote (RFQ) documents from customers.",
                duration: 0,
              },
              {
                id: "quote-overview",
                loomUrl:
                  "https://www.loom.com/share/51e0c6dd053b4a3e904fc795d4fc298f?sid=0bb2081d-6bc4-4efb-8361-d2717dda9781",
                name: "Quote Overview",
                description:
                  "Understand the structure and components of a quote in Carbon.",
                duration: 0,
              },

              {
                id: "digital-quotes",
                loomUrl:
                  "https://www.loom.com/share/51e0c6dd053b4a3e904fc795d4fc298f?sid=0bb2081d-6bc4-4efb-8361-d2717dda9781",
                name: "Digital Quotes",
                description:
                  "Create professional digital quotes that can be easily shared with customers.",
                duration: 0,
              },
              {
                id: "quote-revisions",
                loomUrl:
                  "https://www.loom.com/share/51e0c6dd053b4a3e904fc795d4fc298f?sid=0bb2081d-6bc4-4efb-8361-d2717dda9781",
                name: "Quote Revisions",
                description:
                  "Learn how to manage quote revisions and track changes throughout the quoting process.",
                duration: 0,
              },
              {
                id: "converting-quotes-orders",
                loomUrl:
                  "https://www.loom.com/share/51e0c6dd053b4a3e904fc795d4fc298f?sid=0bb2081d-6bc4-4efb-8361-d2717dda9781",
                name: "Converting Quotes to Orders",
                description:
                  "Master the process of converting approved quotes into sales orders.",
                duration: 0,
              },
            ],
          },
          {
            name: "Estimating",
            id: "estimating",
            description:
              "Learn how to create accurate estimates using different methods and cost calculations.",
            challenge: [
              {
                id: "q1",
                question:
                  "What is the primary purpose of quote methods in Carbon?",
                options: [
                  "To track customer preferences",
                  "To standardize the estimation process",
                  "To manage inventory levels",
                  "To create invoices",
                ],
                correctAnswer: 1,
              },
            ],
            lessons: [
              {
                id: "quote-methods",
                loomUrl:
                  "https://www.loom.com/share/51e0c6dd053b4a3e904fc795d4fc298f?sid=0bb2081d-6bc4-4efb-8361-d2717dda9781",
                name: "Quote Methods",
                description:
                  "Learn how to use different quote methods to standardize your estimation process and ensure consistency.",
                duration: 0,
              },
              {
                id: "quote-costing",
                loomUrl:
                  "https://www.loom.com/share/51e0c6dd053b4a3e904fc795d4fc298f?sid=0bb2081d-6bc4-4efb-8361-d2717dda9781",
                name: "Quote Costing and Pricing",
                description:
                  "Master the art of calculating accurate costs for quotes including materials, labor, and overhead.",
                duration: 0,
              },
            ],
          },
        ],
      },
      {
        name: "Sales to Shipment",
        id: "sales-shipment",
        description:
          "Learn how to manage the complete sales process from order to shipment.",
        icon: <LuTruck />,
        topics: [
          {
            name: "Order Management",
            id: "order-management",
            description:
              "Master the complete order management process including make-to-order parts and shipping.",
            challenge: [
              {
                id: "q1",
                question: "What happens after a sales order is created?",
                options: [
                  "Immediate shipping",
                  "Production planning",
                  "Customer payment",
                  "Order cancellation",
                ],
                correctAnswer: 1,
              },
            ],
            lessons: [
              {
                id: "sales-orders",
                loomUrl:
                  "https://www.loom.com/share/51e0c6dd053b4a3e904fc795d4fc298f?sid=0bb2081d-6bc4-4efb-8361-d2717dda9781",
                name: "Sales Orders",
                description:
                  "Learn how to create and manage sales orders in Carbon.",
                duration: 0,
              },
              {
                id: "make-to-order-parts",
                loomUrl:
                  "https://www.loom.com/share/51e0c6dd053b4a3e904fc795d4fc298f?sid=0bb2081d-6bc4-4efb-8361-d2717dda9781",
                name: "Make to Order Parts",
                description:
                  "Understand how to handle make-to-order parts and production planning.",
                duration: 0,
              },
              {
                id: "shipping-orders",
                loomUrl:
                  "https://www.loom.com/share/51e0c6dd053b4a3e904fc795d4fc298f?sid=0bb2081d-6bc4-4efb-8361-d2717dda9781",
                name: "Shipping Orders",
                description: "Learn how to process and track order shipments.",
                duration: 0,
              },
              {
                id: "sales-invoices",
                loomUrl:
                  "https://www.loom.com/share/51e0c6dd053b4a3e904fc795d4fc298f?sid=0bb2081d-6bc4-4efb-8361-d2717dda9781",
                name: "Sales Invoices",
                description:
                  "Master the creation and management of sales invoices.",
                duration: 0,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    name: "Manufacturing",
    background: "#EFB655",
    foreground: "#000000cc",
    id: "manufacturing",
    courses: [
      {
        name: "Managing Production",
        id: "managing-production",
        description:
          "Learn how to manage the complete production lifecycle from job creation to completion.",
        icon: <LuFactory />,
        topics: [
          {
            name: "Managing Production",
            id: "managing-production",
            description:
              "Master the complete production management process including job creation, scheduling, planning, and closing.",
            challenge: [
              {
                id: "q1",
                question: "What is the primary purpose of a job in Carbon?",
                options: [
                  "To track customer orders",
                  "To manage production work",
                  "To handle inventory",
                  "To process invoices",
                ],
                correctAnswer: 1,
              },
              {
                id: "q2",
                question: "What is the primary goal of production scheduling?",
                options: [
                  "To maximize inventory levels",
                  "To optimize resource utilization",
                  "To minimize customer orders",
                  "To reduce quality checks",
                ],
                correctAnswer: 1,
              },
              {
                id: "q3",
                question: "What does production planning help determine?",
                options: [
                  "Customer preferences",
                  "Resource requirements and timelines",
                  "Supplier pricing",
                  "Quality standards",
                ],
                correctAnswer: 1,
              },
              {
                id: "q4",
                question: "What is the final step in job management?",
                options: [
                  "Starting the job",
                  "Scheduling the job",
                  "Closing the job",
                  "Planning the job",
                ],
                correctAnswer: 2,
              },
            ],
            lessons: [
              {
                id: "job-overview",
                loomUrl:
                  "https://www.loom.com/share/51e0c6dd053b4a3e904fc795d4fc298f?sid=0bb2081d-6bc4-4efb-8361-d2717dda9781",
                name: "Job Overview",
                description:
                  "Learn the fundamentals of job management and how jobs drive production in Carbon.",
                duration: 0,
              },
              {
                id: "scheduling",
                loomUrl:
                  "https://www.loom.com/share/51e0c6dd053b4a3e904fc795d4fc298f?sid=0bb2081d-6bc4-4efb-8361-d2717dda9781",
                name: "Scheduling",
                description:
                  "Learn how to schedule jobs and manage production timelines effectively.",
                duration: 0,
              },
              {
                id: "production-planning",
                loomUrl:
                  "https://www.loom.com/share/51e0c6dd053b4a3e904fc795d4fc298f?sid=0bb2081d-6bc4-4efb-8361-d2717dda9781",
                name: "Production Planning",
                description:
                  "Learn how to plan production activities and coordinate resources effectively.",
                duration: 0,
              },
              {
                id: "closing-job",
                loomUrl:
                  "https://www.loom.com/share/51e0c6dd053b4a3e904fc795d4fc298f?sid=0bb2081d-6bc4-4efb-8361-d2717dda9781",
                name: "Closing a Job",
                description:
                  "Learn the proper process for completing and closing jobs in the production system.",
                duration: 0,
              },
            ],
          },
        ],
      },
      {
        name: "Shop Floor",
        id: "shop-floor",
        description:
          "Learn how to manage shop floor operations using Carbon's MES capabilities.",
        icon: <LuTvMinimalPlay />,
        topics: [
          {
            name: "Shop Floor",
            id: "shop-floor",
            description:
              "Master shop floor operations including MES functionality, time tracking, batch/serial tracking, part issuing, and job travelers.",
            challenge: [
              {
                id: "q1",
                question: "What does MES stand for?",
                options: [
                  "Manufacturing Execution System",
                  "Material Exchange System",
                  "Management Execution System",
                  "Manufacturing Exchange System",
                ],
                correctAnswer: 0,
              },
              {
                id: "q2",
                question: "Why is tracking time and quantities important?",
                options: [
                  "For inventory management only",
                  "For accurate job costing and efficiency analysis",
                  "For customer satisfaction",
                  "For supplier management",
                ],
                correctAnswer: 1,
              },
              {
                id: "q3",
                question:
                  "What is the purpose of tracking batch and serial parts?",
                options: [
                  "To increase inventory levels",
                  "To provide traceability and quality control",
                  "To reduce production costs",
                  "To speed up shipping",
                ],
                correctAnswer: 1,
              },
              {
                id: "q4",
                question: "What happens when parts are issued to a job?",
                options: [
                  "Inventory levels increase",
                  "Inventory levels decrease",
                  "Customer orders are created",
                  "Suppliers are notified",
                ],
                correctAnswer: 1,
              },
              {
                id: "q5",
                question: "What is a job traveler used for?",
                options: [
                  "Customer communication",
                  "Guiding production processes and instructions",
                  "Supplier management",
                  "Quality control only",
                ],
                correctAnswer: 1,
              },
            ],
            lessons: [
              {
                id: "mes-overview",
                loomUrl:
                  "https://www.loom.com/share/51e0c6dd053b4a3e904fc795d4fc298f?sid=0bb2081d-6bc4-4efb-8361-d2717dda9781",
                name: "MES Overview",
                description:
                  "Learn about Manufacturing Execution Systems and how Carbon implements MES functionality.",
                duration: 0,
              },
              {
                id: "tracking-time-quantities",
                loomUrl:
                  "https://www.loom.com/share/51e0c6dd053b4a3e904fc795d4fc298f?sid=0bb2081d-6bc4-4efb-8361-d2717dda9781",
                name: "Tracking Time and Quantities",
                description:
                  "Learn how to track production time and quantities for accurate job costing and efficiency analysis.",
                duration: 0,
              },
              {
                id: "tracking-batch-serial",
                loomUrl:
                  "https://www.loom.com/share/51e0c6dd053b4a3e904fc795d4fc298f?sid=0bb2081d-6bc4-4efb-8361-d2717dda9781",
                name: "Tracking Batch and Serial Parts",
                description:
                  "Learn how to track batch and serial numbered parts for traceability and quality control.",
                duration: 0,
              },
              {
                id: "issuing-parts",
                loomUrl:
                  "https://www.loom.com/share/51e0c6dd053b4a3e904fc795d4fc298f?sid=0bb2081d-6bc4-4efb-8361-d2717dda9781",
                name: "Issuing Parts",
                description:
                  "Learn how to issue parts to jobs and track material consumption accurately.",
                duration: 0,
              },
              {
                id: "job-traveler",
                loomUrl:
                  "https://www.loom.com/share/51e0c6dd053b4a3e904fc795d4fc298f?sid=0bb2081d-6bc4-4efb-8361-d2717dda9781",
                name: "Job Traveler",
                description:
                  "Learn how to use job travelers to guide production processes and provide instructions.",
                duration: 0,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    name: "Buying",
    background: "#EF8729",
    foreground: "#fff",
    id: "buying",
    courses: [
      {
        name: "Purchasing Basics",
        id: "purchasing-basics",
        description: "Learn the fundamentals of purchasing in Carbon.",
        icon: <LuShoppingCart />,
        topics: [
          {
            name: "Purchasing Basics",
            id: "purchasing-basics",
            description:
              "Master the fundamental purchasing processes including overview, supplier quotes, purchase orders, and receiving.",
            challenge: [
              {
                id: "q1",
                question: "What is the first step in the purchasing process?",
                options: [
                  "Creating a purchase order",
                  "Receiving goods",
                  "Identifying needs",
                  "Paying suppliers",
                ],
                correctAnswer: 2,
              },
              {
                id: "q2",
                question: "Why are supplier quotes important?",
                options: [
                  "To increase inventory",
                  "To compare pricing and select the best supplier",
                  "To reduce quality checks",
                  "To speed up shipping",
                ],
                correctAnswer: 1,
              },
              {
                id: "q3",
                question: "What is a purchase order?",
                options: [
                  "A customer order",
                  "A formal request to buy goods or services",
                  "A quality inspection report",
                  "A shipping document",
                ],
                correctAnswer: 1,
              },
              {
                id: "q4",
                question:
                  "What should be done when receiving a purchase order?",
                options: [
                  "Immediately pay the supplier",
                  "Inspect goods and update inventory",
                  "Create a new purchase order",
                  "Contact the customer",
                ],
                correctAnswer: 1,
              },
            ],
            lessons: [
              {
                id: "purchasing-overview",
                loomUrl:
                  "https://www.loom.com/share/51e0c6dd053b4a3e904fc795d4fc298f?sid=0bb2081d-6bc4-4efb-8361-d2717dda9781",
                name: "Purchasing Overview",
                description:
                  "Learn about the complete purchasing process from supplier selection to payment.",
                duration: 0,
              },
              {
                id: "supplier-quotes",
                loomUrl:
                  "https://www.loom.com/share/51e0c6dd053b4a3e904fc795d4fc298f?sid=0bb2081d-6bc4-4efb-8361-d2717dda9781",
                name: "Supplier Quotes",
                description:
                  "Learn how to manage supplier quotes and compare pricing effectively.",
                duration: 0,
              },
              {
                id: "purchase-orders",
                loomUrl:
                  "https://www.loom.com/share/51e0c6dd053b4a3e904fc795d4fc298f?sid=0bb2081d-6bc4-4efb-8361-d2717dda9781",
                name: "Purchase Orders",
                description:
                  "Learn how to create and manage purchase orders effectively.",
                duration: 0,
              },
              {
                id: "receiving-purchase-order",
                loomUrl:
                  "https://www.loom.com/share/51e0c6dd053b4a3e904fc795d4fc298f?sid=0bb2081d-6bc4-4efb-8361-d2717dda9781",
                name: "Receiving a Purchase Order",
                description:
                  "Learn how to receive and inspect purchased goods properly.",
                duration: 0,
              },
            ],
          },
        ],
      },
      {
        name: "Advanced Purchasing",
        id: "advanced-purchasing",
        description:
          "Master advanced purchasing techniques including planning, cost analysis, and supplier management.",
        icon: <LuShoppingCart />,
        topics: [
          {
            name: "Advanced Purchasing",
            id: "advanced-purchasing",
            description:
              "Master advanced purchasing concepts including purchase invoices, planning, historical costs, and supplier pricing analysis.",
            challenge: [
              {
                id: "q1",
                question: "What is the purpose of a purchase invoice?",
                options: [
                  "To track customer orders",
                  "To request payment from suppliers",
                  "To record received goods and request payment",
                  "To manage inventory levels",
                ],
                correctAnswer: 2,
              },
              {
                id: "q2",
                question: "What is purchasing planning based on?",
                options: [
                  "Supplier preferences only",
                  "Demand forecasts and inventory levels",
                  "Customer orders only",
                  "Quality requirements only",
                ],
                correctAnswer: 1,
              },
              {
                id: "q3",
                question: "Why are historical costs important?",
                options: [
                  "To increase inventory levels",
                  "To make better purchasing decisions and negotiate prices",
                  "To reduce quality checks",
                  "To speed up shipping",
                ],
                correctAnswer: 1,
              },
              {
                id: "q4",
                question: "What is the goal of supplier pricing analysis?",
                options: [
                  "To increase costs",
                  "To optimize costs and improve supplier relationships",
                  "To reduce quality",
                  "To slow down delivery",
                ],
                correctAnswer: 1,
              },
            ],
            lessons: [
              {
                id: "purchase-invoices",
                loomUrl:
                  "https://www.loom.com/share/51e0c6dd053b4a3e904fc795d4fc298f?sid=0bb2081d-6bc4-4efb-8361-d2717dda9781",
                name: "Purchase Invoices",
                description:
                  "Learn how to process and manage purchase invoices for payment.",
                duration: 0,
              },
              {
                id: "purchasing-planning",
                loomUrl:
                  "https://www.loom.com/share/51e0c6dd053b4a3e904fc795d4fc298f?sid=0bb2081d-6bc4-4efb-8361-d2717dda9781",
                name: "Purchasing Planning",
                description:
                  "Learn how to plan purchasing activities based on demand and inventory levels.",
                duration: 0,
              },
              {
                id: "historical-costs",
                loomUrl:
                  "https://www.loom.com/share/51e0c6dd053b4a3e904fc795d4fc298f?sid=0bb2081d-6bc4-4efb-8361-d2717dda9781",
                name: "Historical Costs",
                description:
                  "Learn how to analyze historical costs for better purchasing decisions.",
                duration: 0,
              },
              {
                id: "supplier-pricing",
                loomUrl:
                  "https://www.loom.com/share/51e0c6dd053b4a3e904fc795d4fc298f?sid=0bb2081d-6bc4-4efb-8361-d2717dda9781",
                name: "Supplier Pricing",
                description:
                  "Learn how to analyze supplier pricing and develop negotiation strategies.",
                duration: 0,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    name: "Quality",
    background: "#DD6444",
    foreground: "#fff",
    id: "quality",
    courses: [
      {
        name: "Tracking Quality",
        id: "tracking-quality",
        description:
          "Learn how to implement and manage quality control processes in Carbon.",
        icon: <LuFolderCheck />,
        topics: [
          {
            name: "Tracking Quality",
            id: "tracking-quality",
            description:
              "Master quality control processes including issues and gauge management.",
            challenge: [
              {
                id: "q1",
                question: "What is a issue?",
                options: [
                  "A successful product",
                  "A product or material that doesn't meet specifications",
                  "A customer order",
                  "A supplier invoice",
                ],
                correctAnswer: 1,
              },
              {
                id: "q2",
                question: "Why is gauge calibration important?",
                options: [
                  "To increase costs",
                  "To ensure measurement accuracy and quality control",
                  "To reduce inventory",
                  "To speed up production",
                ],
                correctAnswer: 1,
              },
            ],
            lessons: [
              {
                id: "issues",
                loomUrl:
                  "https://www.loom.com/share/51e0c6dd053b4a3e904fc795d4fc298f?sid=0bb2081d-6bc4-4efb-8361-d2717dda9781",
                name: "Issues",
                description:
                  "Learn how to track and manage non-conforming materials and products.",
                duration: 0,
              },
              {
                id: "gauges-calibrations",
                loomUrl:
                  "https://www.loom.com/share/51e0c6dd053b4a3e904fc795d4fc298f?sid=0bb2081d-6bc4-4efb-8361-d2717dda9781",
                name: "Gauges and Calibrations",
                description:
                  "Learn how to manage measurement equipment and calibration schedules.",
                duration: 0,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    name: "Developing",
    background: "#10d131",
    foreground: "#000000cc",
    id: "developing",
    courses: [
      {
        name: "Using the API",
        id: "using-api",
        description:
          "Learn how to use Carbon's API for integration and automation.",
        icon: <LuCodeXml />,
        topics: [
          {
            name: "Using the API",
            id: "using-api",
            description:
              "Master API usage including API keys, TypeScript client, C# client, Python client, and webhooks.",
            challenge: [
              {
                id: "q1",
                question: "What is the purpose of an API key?",
                options: [
                  "To increase costs",
                  "To provide secure access to Carbon's API",
                  "To reduce quality",
                  "To slow down performance",
                ],
                correctAnswer: 1,
              },
              {
                id: "q2",
                question:
                  "What is the advantage of using the TypeScript API client?",
                options: [
                  "To increase costs",
                  "To provide type safety and better development experience",
                  "To reduce quality",
                  "To slow down performance",
                ],
                correctAnswer: 1,
              },
              {
                id: "q3",
                question: "What platform is the C# API client designed for?",
                options: [
                  "Web browsers",
                  ".NET applications",
                  "Mobile apps",
                  "Linux systems",
                ],
                correctAnswer: 1,
              },
              {
                id: "q4",
                question:
                  "What is Python commonly used for in API integration?",
                options: [
                  "Web development only",
                  "Data analysis, automation, and integration",
                  "Mobile development",
                  "Database management only",
                ],
                correctAnswer: 1,
              },
              {
                id: "q5",
                question: "What is the primary benefit of webhooks?",
                options: [
                  "To increase costs",
                  "To receive real-time event notifications",
                  "To reduce quality",
                  "To slow down performance",
                ],
                correctAnswer: 1,
              },
            ],
            lessons: [
              {
                id: "api-keys",
                loomUrl:
                  "https://www.loom.com/share/51e0c6dd053b4a3e904fc795d4fc298f?sid=0bb2081d-6bc4-4efb-8361-d2717dda9781",
                name: "API Keys",
                description:
                  "Learn how to create and manage API keys for secure access to Carbon's API.",
                duration: 0,
              },
              {
                id: "typescript-api-client",
                loomUrl:
                  "https://www.loom.com/share/51e0c6dd053b4a3e904fc795d4fc298f?sid=0bb2081d-6bc4-4efb-8361-d2717dda9781",
                name: "TypeScript API Client",
                description:
                  "Learn how to use Carbon's TypeScript API client for seamless integration.",
                duration: 0,
              },
              {
                id: "csharp-api-client",
                loomUrl:
                  "https://www.loom.com/share/51e0c6dd053b4a3e904fc795d4fc298f?sid=0bb2081d-6bc4-4efb-8361-d2717dda9781",
                name: "C# API Client",
                description:
                  "Learn how to use Carbon's C# API client for .NET applications.",
                duration: 0,
              },
              {
                id: "python-api-client",
                loomUrl:
                  "https://www.loom.com/share/51e0c6dd053b4a3e904fc795d4fc298f?sid=0bb2081d-6bc4-4efb-8361-d2717dda9781",
                name: "Python API Client",
                description:
                  "Learn how to integrate with Carbon using the Python API client.",
                duration: 0,
              },
              {
                id: "webhooks",
                loomUrl:
                  "https://www.loom.com/share/51e0c6dd053b4a3e904fc795d4fc298f?sid=0bb2081d-6bc4-4efb-8361-d2717dda9781",
                name: "Webhooks",
                description:
                  "Learn how to use webhooks for real-time event notifications from Carbon.",
                duration: 0,
              },
            ],
          },
        ],
      },
      {
        name: "Integrating with Carbon",
        id: "integrating-carbon",
        description:
          "Learn how to build integrations and custom applications with Carbon.",
        icon: <LuCodeXml />,
        topics: [
          {
            name: "Integrating with Carbon",
            id: "integrating-carbon",
            description:
              "Master integration techniques including system integrations and custom application development.",
            challenge: [
              {
                id: "q1",
                question: "What is the goal of system integrations?",
                options: [
                  "To increase complexity",
                  "To streamline workflows and improve efficiency",
                  "To reduce functionality",
                  "To slow down processes",
                ],
                correctAnswer: 1,
              },
              {
                id: "q2",
                question: "What can you build with Carbon's API?",
                options: [
                  "Only mobile apps",
                  "Custom applications, dashboards, and tools",
                  "Only web applications",
                  "Only desktop software",
                ],
                correctAnswer: 1,
              },
            ],
            lessons: [
              {
                id: "integrations",
                loomUrl:
                  "https://www.loom.com/share/ee50229e2f294170878038639479a18e?sid=49a1a785-5a45-42b8-bc30-809f2e50fb43",
                name: "Integrations",
                description:
                  "Learn how to integrate Carbon with other business systems and tools.",
                duration: 91,
              },
              {
                id: "applications",
                loomUrl:
                  "https://www.loom.com/share/51e0c6dd053b4a3e904fc795d4fc298f?sid=0bb2081d-6bc4-4efb-8361-d2717dda9781",
                name: "Applications",
                description:
                  "Learn how to build custom applications that integrate with Carbon's platform.",
                duration: 0,
              },
            ],
          },
        ],
      },
    ],
  },
];
