import {
  LuBox,
  LuCalculator,
  LuCirclePlay,
  LuCodeXml,
  LuCreditCard,
  LuFactory,
  LuFolderCheck,
  LuHexagon,
  LuShapes,
  LuShoppingCart,
  LuSquareStack,
  LuTruck,
  LuTvMinimalPlay,
  LuUpload,
  LuWebhook,
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
  videoId: string;
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
                videoId: "1234567890",
                name: "What is Carbon?",
                description:
                  "Meet Carbon, the next generation of accessible, scalable, and data-centric ERP/MES/QMS software. Carbon was designed from the ground up to be approachable and easy to get started with, but highly flexible and capable of scaling up to the largest projects.",
                duration: 100,
              },
              {
                id: "carbon-modules",
                videoId: "1234567890",
                name: "Carbon's Modules",
                description:
                  "Learn about Carbon's modular architecture and how different modules work together to provide comprehensive business management capabilities.",
                duration: 100,
              },
              {
                id: "architecture-overview",
                videoId: "1234567890",
                name: "Architecture Overview",
                description:
                  "Understand Carbon's technical architecture, including its web-based design, database structure, and API capabilities.",
                duration: 100,
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
                videoId: "1234567890",
                name: "Tables",
                description:
                  "Learn how to use tables to view, sort, filter, and manage your data effectively in Carbon.",
                duration: 100,
              },
              {
                id: "forms",
                videoId: "1234567890",
                name: "Forms",
                description:
                  "Master the art of creating and using forms to input and edit data in Carbon.",
                duration: 100,
              },
              {
                id: "documents",
                videoId: "1234567890",
                name: "Documents",
                description:
                  "Understand how to work with documents, including creation, editing, and sharing capabilities.",
                duration: 100,
              },
              {
                id: "custom-fields",
                videoId: "1234567890",
                name: "Custom Fields",
                description:
                  "Learn how to extend Carbon's functionality by creating custom fields to capture additional data.",
                duration: 100,
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
                videoId: "1234567890",
                description:
                  "Learn how to setup your company in Carbon. This includes creating your company, adding users, and setting up your company's preferences.",
                duration: 100,
              },
              {
                id: "users-permissions",
                name: "Users and Permissions",
                videoId: "1234567890",
                description:
                  "Learn how to setup your users in Carbon. This includes creating users, setting permissions, and managing access levels.",
                duration: 100,
              },
              {
                id: "locations-resources",
                name: "Locations and Resources",
                videoId: "1234567890",
                description:
                  "Learn how to setup your work centers, machines, and processes in Carbon. This is essential for manufacturing and resource planning.",
                duration: 100,
              },
              {
                id: "integrations",
                name: "Integrations",
                videoId: "1234567890",
                description:
                  "Learn how to setup your integrations in Carbon to connect with other business systems and tools.",
                duration: 100,
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
                videoId: "1234567890",
                description:
                  "Learn how to use Carbon's built-in import tools to efficiently migrate your data from other systems.",
                duration: 100,
              },
            ],
            supplemental: [
              {
                id: "importing-data-api",
                videoId: "1234567890",
                name: "Importing Data with the API",
                description:
                  "Learn how to use Carbon's API to programmatically import data and integrate with other systems.",
                duration: 100,
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
                videoId: "1234567890",
                name: "Parts, Materials and Tools",
                description:
                  "Learn the differences between various item types and when to use each one in your business processes.",
                duration: 100,
              },
              {
                id: "method-types",
                videoId: "1234567890",
                name: "Method Types",
                description:
                  "Understand the different method types available for items and how they affect manufacturing processes.",
                duration: 100,
              },
              {
                id: "tracking-types",
                videoId: "1234567890",
                name: "Tracking Types",
                description:
                  "Learn about different tracking types and how they help manage inventory and traceability.",
                duration: 100,
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
                videoId: "1234567890",
                name: "Methods",
                description:
                  "Learn how to create and manage manufacturing methods that define how items are produced.",
                duration: 100,
              },
              {
                id: "bill-of-process",
                videoId: "1234567890",
                name: "Bill of Process",
                description:
                  "Understand how to create and manage bills of process that define the manufacturing steps.",
                duration: 100,
              },
              {
                id: "bill-of-materials",
                videoId: "1234567890",
                name: "Bill of Materials",
                description:
                  "Learn how to create and manage bills of materials that define what components are needed.",
                duration: 100,
              },
              {
                id: "revisions-versions",
                videoId: "1234567890",
                name: "Revisions and Versions",
                description:
                  "Master the revision and version control system for managing changes to methods and bills.",
                duration: 100,
              },
              {
                id: "get-method-save-method",
                videoId: "1234567890",
                name: "Get Method and Save Method",
                description:
                  "Learn how to retrieve and save methods programmatically using Carbon's API.",
                duration: 100,
              },
            ],
            supplemental: [
              {
                id: "product-configurator",
                videoId: "1234567890",
                name: "Product Configurator",
                description:
                  "Learn how to use Carbon's product configurator to create complex, configurable products.",
                duration: 100,
              },
            ],
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
                id: "planning",
                videoId: "1234567890",
                name: "Planning",
                description:
                  "See how Carbon's planning tools help you forecast demand and generate replenishment requirements.",
                duration: 100,
              },
              {
                id: "inventory-management",
                videoId: "1234567890",
                name: "Inventory Levels",
                description:
                  "Learn how to monitor and manage inventory levels, set reorder points, and handle stock movements.",
                duration: 100,
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
                videoId: "1234567890",
                name: "Recording an RFQ",
                description:
                  "Learn how to record and manage Request for Quote (RFQ) documents from customers.",
                duration: 100,
              },
              {
                id: "quote-overview",
                videoId: "1234567890",
                name: "Quote Overview",
                description:
                  "Understand the structure and components of a quote in Carbon.",
                duration: 100,
              },

              {
                id: "digital-quotes",
                videoId: "1234567890",
                name: "Digital Quotes",
                description:
                  "Create professional digital quotes that can be easily shared with customers.",
                duration: 100,
              },
              {
                id: "quote-revisions",
                videoId: "1234567890",
                name: "Quote Revisions",
                description:
                  "Learn how to manage quote revisions and track changes throughout the quoting process.",
                duration: 100,
              },
              {
                id: "converting-quotes-orders",
                videoId: "1234567890",
                name: "Converting Quotes to Orders",
                description:
                  "Master the process of converting approved quotes into sales orders.",
                duration: 100,
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
                videoId: "1234567890",
                name: "Quote Methods",
                description:
                  "Learn how to use different quote methods to standardize your estimation process and ensure consistency.",
                duration: 100,
              },
              {
                id: "quote-costing",
                videoId: "1234567890",
                name: "Quote Costing and Pricing",
                description:
                  "Master the art of calculating accurate costs for quotes including materials, labor, and overhead.",
                duration: 100,
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
                videoId: "1234567890",
                name: "Sales Orders",
                description:
                  "Learn how to create and manage sales orders in Carbon.",
                duration: 100,
              },
              {
                id: "make-to-order-parts",
                videoId: "1234567890",
                name: "Make to Order Parts",
                description:
                  "Understand how to handle make-to-order parts and production planning.",
                duration: 100,
              },
              {
                id: "shipping-orders",
                videoId: "1234567890",
                name: "Shipping Orders",
                description: "Learn how to process and track order shipments.",
                duration: 100,
              },
              {
                id: "sales-invoices",
                videoId: "1234567890",
                name: "Sales Invoices",
                description:
                  "Master the creation and management of sales invoices.",
                duration: 100,
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
            name: "Job Overview",
            id: "job-overview",
            description:
              "Understand the fundamentals of job management and how jobs drive production in Carbon.",
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
            ],
            lessons: [
              {
                id: "job-overview",
                videoId: "1234567890",
                name: "Job Overview",
                description:
                  "Learn the fundamentals of job management and how jobs drive production in Carbon.",
                duration: 100,
              },
            ],
          },
          {
            name: "Scheduling",
            id: "scheduling",
            description:
              "Master the art of scheduling jobs and managing production timelines effectively.",
            challenge: [
              {
                id: "q1",
                question: "What is the primary goal of production scheduling?",
                options: [
                  "To maximize inventory levels",
                  "To optimize resource utilization",
                  "To minimize customer orders",
                  "To reduce quality checks",
                ],
                correctAnswer: 1,
              },
            ],
            lessons: [
              {
                id: "scheduling",
                videoId: "1234567890",
                name: "Scheduling",
                description:
                  "Learn how to schedule jobs and manage production timelines effectively.",
                duration: 100,
              },
            ],
          },
          {
            name: "Production Planning",
            id: "production-planning",
            description:
              "Understand how to plan production activities and coordinate resources.",
            challenge: [
              {
                id: "q1",
                question: "What does production planning help determine?",
                options: [
                  "Customer preferences",
                  "Resource requirements and timelines",
                  "Supplier pricing",
                  "Quality standards",
                ],
                correctAnswer: 1,
              },
            ],
            lessons: [
              {
                id: "production-planning",
                videoId: "1234567890",
                name: "Production Planning",
                description:
                  "Learn how to plan production activities and coordinate resources effectively.",
                duration: 100,
              },
            ],
          },
          {
            name: "Closing a Job",
            id: "closing-job",
            description:
              "Master the process of completing and closing jobs in the production system.",
            challenge: [
              {
                id: "q1",
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
                id: "closing-job",
                videoId: "1234567890",
                name: "Closing a Job",
                description:
                  "Learn the proper process for completing and closing jobs in the production system.",
                duration: 100,
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
            name: "MES Overview",
            id: "mes-overview",
            description:
              "Understand Manufacturing Execution Systems and how Carbon implements MES functionality.",
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
            ],
            lessons: [
              {
                id: "mes-overview",
                videoId: "1234567890",
                name: "MES Overview",
                description:
                  "Learn about Manufacturing Execution Systems and how Carbon implements MES functionality.",
                duration: 100,
              },
            ],
          },
          {
            name: "Tracking Time and Quantities",
            id: "tracking-time-quantities",
            description:
              "Master the tracking of production time and quantities for accurate job costing.",
            challenge: [
              {
                id: "q1",
                question: "Why is tracking time and quantities important?",
                options: [
                  "For inventory management only",
                  "For accurate job costing and efficiency analysis",
                  "For customer satisfaction",
                  "For supplier management",
                ],
                correctAnswer: 1,
              },
            ],
            lessons: [
              {
                id: "tracking-time-quantities",
                videoId: "1234567890",
                name: "Tracking Time and Quantities",
                description:
                  "Learn how to track production time and quantities for accurate job costing and efficiency analysis.",
                duration: 100,
              },
            ],
          },
          {
            name: "Tracking Batch and Serial Parts",
            id: "tracking-batch-serial",
            description:
              "Learn how to track batch and serial numbered parts for traceability.",
            challenge: [
              {
                id: "q1",
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
            ],
            lessons: [
              {
                id: "tracking-batch-serial",
                videoId: "1234567890",
                name: "Tracking Batch and Serial Parts",
                description:
                  "Learn how to track batch and serial numbered parts for traceability and quality control.",
                duration: 100,
              },
            ],
          },
          {
            name: "Issuing Parts",
            id: "issuing-parts",
            description:
              "Understand how to issue parts to jobs and track material consumption.",
            challenge: [
              {
                id: "q1",
                question: "What happens when parts are issued to a job?",
                options: [
                  "Inventory levels increase",
                  "Inventory levels decrease",
                  "Customer orders are created",
                  "Suppliers are notified",
                ],
                correctAnswer: 1,
              },
            ],
            lessons: [
              {
                id: "issuing-parts",
                videoId: "1234567890",
                name: "Issuing Parts",
                description:
                  "Learn how to issue parts to jobs and track material consumption accurately.",
                duration: 100,
              },
            ],
          },
          {
            name: "Job Traveler",
            id: "job-traveler",
            description:
              "Master the job traveler system for guiding production processes.",
            challenge: [
              {
                id: "q1",
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
                id: "job-traveler",
                videoId: "1234567890",
                name: "Job Traveler",
                description:
                  "Learn how to use job travelers to guide production processes and provide instructions.",
                duration: 100,
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
        description:
          "Learn the fundamentals of purchasing and procurement in Carbon.",
        icon: <LuShoppingCart />,
        topics: [
          {
            name: "Purchasing Overview",
            id: "purchasing-overview",
            description:
              "Understand the complete purchasing process from supplier selection to payment.",
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
            ],
            lessons: [
              {
                id: "purchasing-overview",
                videoId: "1234567890",
                name: "Purchasing Overview",
                description:
                  "Learn about the complete purchasing process from supplier selection to payment.",
                duration: 100,
              },
            ],
          },
          {
            name: "Supplier Quotes",
            id: "supplier-quotes",
            description:
              "Learn how to manage supplier quotes and compare pricing effectively.",
            challenge: [
              {
                id: "q1",
                question: "Why are supplier quotes important?",
                options: [
                  "To increase inventory",
                  "To compare pricing and select the best supplier",
                  "To reduce quality checks",
                  "To speed up shipping",
                ],
                correctAnswer: 1,
              },
            ],
            lessons: [
              {
                id: "supplier-quotes",
                videoId: "1234567890",
                name: "Supplier Quotes",
                description:
                  "Learn how to manage supplier quotes and compare pricing effectively.",
                duration: 100,
              },
            ],
          },
          {
            name: "Purchase Orders",
            id: "purchase-orders",
            description:
              "Master the creation and management of purchase orders.",
            challenge: [
              {
                id: "q1",
                question: "What is a purchase order?",
                options: [
                  "A customer order",
                  "A formal request to buy goods or services",
                  "A quality inspection report",
                  "A shipping document",
                ],
                correctAnswer: 1,
              },
            ],
            lessons: [
              {
                id: "purchase-orders",
                videoId: "1234567890",
                name: "Purchase Orders",
                description:
                  "Learn how to create and manage purchase orders effectively.",
                duration: 100,
              },
            ],
          },
          {
            name: "Receiving a Purchase Order",
            id: "receiving-purchase-order",
            description:
              "Understand how to receive and inspect purchased goods.",
            challenge: [
              {
                id: "q1",
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
                id: "receiving-purchase-order",
                videoId: "1234567890",
                name: "Receiving a Purchase Order",
                description:
                  "Learn how to receive and inspect purchased goods properly.",
                duration: 100,
              },
            ],
          },
          {
            name: "Purchase Invoices",
            id: "purchase-invoices",
            description:
              "Learn how to process and manage purchase invoices for payment.",
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
            ],
            lessons: [
              {
                id: "purchase-invoices",
                videoId: "1234567890",
                name: "Purchase Invoices",
                description:
                  "Learn how to process and manage purchase invoices for payment.",
                duration: 100,
              },
            ],
          },
        ],
      },
      {
        name: "Advanced Purchasing",
        id: "advanced-purchasing",
        description:
          "Master advanced purchasing techniques and strategic procurement.",
        icon: <LuCreditCard />,
        topics: [
          {
            name: "Purchasing Planning",
            id: "purchasing-planning",
            description:
              "Learn how to plan purchasing activities based on demand and inventory levels.",
            challenge: [
              {
                id: "q1",
                question: "What is purchasing planning based on?",
                options: [
                  "Supplier preferences only",
                  "Demand forecasts and inventory levels",
                  "Customer orders only",
                  "Quality requirements only",
                ],
                correctAnswer: 1,
              },
            ],
            lessons: [
              {
                id: "purchasing-planning",
                videoId: "1234567890",
                name: "Purchasing Planning",
                description:
                  "Learn how to plan purchasing activities based on demand and inventory levels.",
                duration: 100,
              },
            ],
          },
          {
            name: "Historical Costs",
            id: "historical-costs",
            description:
              "Understand how to analyze historical costs for better purchasing decisions.",
            challenge: [
              {
                id: "q1",
                question: "Why are historical costs important?",
                options: [
                  "To increase inventory levels",
                  "To make better purchasing decisions and negotiate prices",
                  "To reduce quality checks",
                  "To speed up shipping",
                ],
                correctAnswer: 1,
              },
            ],
            lessons: [
              {
                id: "historical-costs",
                videoId: "1234567890",
                name: "Historical Costs",
                description:
                  "Learn how to analyze historical costs for better purchasing decisions.",
                duration: 100,
              },
            ],
          },
          {
            name: "Supplier Pricing",
            id: "supplier-pricing",
            description:
              "Master supplier pricing analysis and negotiation strategies.",
            challenge: [
              {
                id: "q1",
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
                id: "supplier-pricing",
                videoId: "1234567890",
                name: "Supplier Pricing",
                description:
                  "Learn how to analyze supplier pricing and develop negotiation strategies.",
                duration: 100,
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
            name: "Non-Conformances",
            id: "non-conformances",
            description:
              "Understand how to track and manage non-conforming materials and products.",
            challenge: [
              {
                id: "q1",
                question: "What is a non-conformance?",
                options: [
                  "A successful product",
                  "A product or material that doesn't meet specifications",
                  "A customer order",
                  "A supplier invoice",
                ],
                correctAnswer: 1,
              },
            ],
            lessons: [
              {
                id: "non-conformances",
                videoId: "1234567890",
                name: "Non-Conformances",
                description:
                  "Learn how to track and manage non-conforming materials and products.",
                duration: 100,
              },
            ],
          },
          {
            name: "Gauges and Calibrations",
            id: "gauges-calibrations",
            description:
              "Master the management of measurement equipment and calibration schedules.",
            challenge: [
              {
                id: "q1",
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
                id: "gauges-calibrations",
                videoId: "1234567890",
                name: "Gauges and Calibrations",
                description:
                  "Learn how to manage measurement equipment and calibration schedules.",
                duration: 100,
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
          "Learn how to integrate with Carbon using its powerful API capabilities.",
        icon: <LuCodeXml />,
        topics: [
          {
            name: "API Keys",
            id: "api-keys",
            description:
              "Understand how to create and manage API keys for secure access to Carbon's API.",
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
            ],
            lessons: [
              {
                id: "api-keys",
                videoId: "1234567890",
                name: "API Keys",
                description:
                  "Learn how to create and manage API keys for secure access to Carbon's API.",
                duration: 100,
              },
            ],
          },
          {
            name: "TypeScript API Client",
            id: "typescript-api-client",
            description:
              "Learn how to use Carbon's TypeScript API client for seamless integration.",
            challenge: [
              {
                id: "q1",
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
            ],
            lessons: [
              {
                id: "typescript-api-client",
                videoId: "1234567890",
                name: "TypeScript API Client",
                description:
                  "Learn how to use Carbon's TypeScript API client for seamless integration.",
                duration: 100,
              },
            ],
          },
          {
            name: "C# API Client",
            id: "csharp-api-client",
            description:
              "Master the C# API client for .NET applications and integrations.",
            challenge: [
              {
                id: "q1",
                question: "What platform is the C# API client designed for?",
                options: [
                  "Web browsers",
                  ".NET applications",
                  "Mobile apps",
                  "Linux systems",
                ],
                correctAnswer: 1,
              },
            ],
            lessons: [
              {
                id: "csharp-api-client",
                videoId: "1234567890",
                name: "C# API Client",
                description:
                  "Learn how to use Carbon's C# API client for .NET applications.",
                duration: 100,
              },
            ],
          },
          {
            name: "Python API Client",
            id: "python-api-client",
            description:
              "Learn how to integrate with Carbon using the Python API client.",
            challenge: [
              {
                id: "q1",
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
            ],
            lessons: [
              {
                id: "python-api-client",
                videoId: "1234567890",
                name: "Python API Client",
                description:
                  "Learn how to integrate with Carbon using the Python API client.",
                duration: 100,
              },
            ],
          },
        ],
      },
      {
        name: "Integrating with Carbon",
        id: "integrating-carbon",
        description:
          "Learn advanced integration techniques and best practices for connecting with Carbon.",
        icon: <LuWebhook />,
        topics: [
          {
            name: "Webhooks",
            id: "webhooks",
            description:
              "Understand how to use webhooks for real-time event notifications from Carbon.",
            challenge: [
              {
                id: "q1",
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
                id: "webhooks",
                videoId: "1234567890",
                name: "Webhooks",
                description:
                  "Learn how to use webhooks for real-time event notifications from Carbon.",
                duration: 100,
              },
            ],
          },
          {
            name: "Integrations",
            id: "integrations",
            description:
              "Master the process of integrating Carbon with other business systems and tools.",
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
            ],
            lessons: [
              {
                id: "integrations",
                videoId: "1234567890",
                name: "Integrations",
                description:
                  "Learn how to integrate Carbon with other business systems and tools.",
                duration: 100,
              },
            ],
          },
          {
            name: "Applications",
            id: "applications",
            description:
              "Learn how to build custom applications that integrate with Carbon's platform.",
            challenge: [
              {
                id: "q1",
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
                id: "applications",
                videoId: "1234567890",
                name: "Applications",
                description:
                  "Learn how to build custom applications that integrate with Carbon's platform.",
                duration: 100,
              },
            ],
          },
        ],
      },
    ],
  },
];
