import { getCarbonServiceRole } from "@carbon/auth";
// import { getCarbonServiceRole, notFound } from "@carbon/auth";
import {
  Avatar,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Label,
  RadioGroup,
  RadioGroupItem,
} from "@carbon/react";
import { useLoaderData } from "@remix-run/react";
import { json, type LoaderFunctionArgs } from "@vercel/remix";
import { motion } from "framer-motion";
import { useState } from "react";
import { LuChevronDown, LuChevronUp } from "react-icons/lu";
import { getQuoteByExternalId } from "~/modules/sales";

enum QuoteState {
  Valid,
  Expired,
  NotFound,
}

export async function loader({ params }: LoaderFunctionArgs) {
  const { id } = params;
  if (!id) {
    return json({
      state: QuoteState.NotFound,
      data: null,
    });
  }

  const serviceRole = getCarbonServiceRole();
  const quote = await getQuoteByExternalId(serviceRole, id);

  if (quote.error) {
    return json({
      state: QuoteState.NotFound,
      data: null,
    });
  }

  if (
    quote.data.expirationDate &&
    new Date(quote.data.expirationDate) < new Date()
  ) {
    return json({
      state: QuoteState.Expired,
      data: null,
    });
  }

  return json({
    state: QuoteState.Valid,
    data: {
      quote: quote.data,
    },
  });
}

type OptionType = {
  id: number;
  quantity: number;
  price: number;
  leadTime: string;
};

type LineItemType = {
  id: number;
  thumbnail: string;
  description: string;
  longDescription: string;
  options: OptionType[];
};

type QuoteProps = {
  companyName: string;
  companyLogo: string;
  customerName: string;
  customerEmail: string;
  lineItems: LineItemType[];
};

// Header Component
const Header = ({
  companyName,
  companyLogo,
  customerName,
  customerEmail,
}: Omit<QuoteProps, "lineItems">) => (
  <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between space-y-4 sm:space-y-0 pb-7">
    <div className="flex items-center space-x-4">
      <Avatar size="lg" name={companyName} />

      <div>
        <CardTitle className="text-3xl">{companyName}</CardTitle>
        <p className="text-lg text-muted-foreground">Digital Quote</p>
      </div>
    </div>
    <div className="text-right">
      <p className="text-xl font-medium">{customerName}</p>
      <p className="text-lg text-muted-foreground">{customerEmail}</p>
    </div>
  </CardHeader>
);

// LineItem Component
const LineItem = ({
  item,
  isOpen,
  toggleOpen,
  selectedOption,
  onOptionChange,
}: {
  item: LineItemType;
  isOpen: boolean;
  toggleOpen: () => void;
  selectedOption: number;
  onOptionChange: (optionId: number) => void;
}) => {
  const currentOption =
    item.options.find((option) => option.id === selectedOption) ||
    item.options[0];

  return (
    <motion.div
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="border-b border-input py-6"
    >
      <div
        className="flex flex-col sm:flex-row items-start sm:items-center justify-between cursor-pointer"
        onClick={toggleOpen}
      >
        <div className="flex items-center space-x-6 mb-4 sm:mb-0">
          <img
            src={item.thumbnail}
            alt={item.description}
            className="w-24 h-24 object-cover rounded"
          />
          <div>
            <p className="font-medium text-xl mb-2">{item.description}</p>
            <p className="text-muted-foreground">{item.longDescription}</p>
          </div>
        </div>
        <div className="flex items-center space-x-4">
          <p className="font-medium text-xl">
            ${currentOption.price.toFixed(2)}
          </p>
          {isOpen ? <LuChevronUp size={24} /> : <LuChevronDown size={24} />}
        </div>
      </div>
      <motion.div
        initial="collapsed"
        animate={isOpen ? "open" : "collapsed"}
        variants={{
          open: { opacity: 1, height: "auto" },
          collapsed: { opacity: 0, height: 0 },
        }}
        transition={{ duration: 0.3 }}
        className="mt-6 space-y-4 overflow-hidden"
      >
        <RadioGroup
          value={selectedOption.toString()}
          onValueChange={(value) => onOptionChange(parseInt(value))}
        >
          {item.options.map((option) => (
            <div
              key={option.id}
              className="flex items-center space-x-2 p-3 rounded hover:bg-muted/30"
            >
              <RadioGroupItem
                value={option.id.toString()}
                id={`option-${item.id}-${option.id}`}
              />
              <Label
                htmlFor={`option-${item.id}-${option.id}`}
                className="flex-grow cursor-pointer"
              >
                <div className="flex justify-between items-center">
                  <span className="text-lg">Qty: {option.quantity}</span>
                  <span className="text-lg font-medium">
                    ${option.price.toFixed(2)}
                  </span>
                  <span className="text-lg">Lead time: {option.leadTime}</span>
                </div>
              </Label>
            </div>
          ))}
        </RadioGroup>
      </motion.div>
    </motion.div>
  );
};

// LineItems Component
const LineItems = ({
  lineItems,
  selectedOptions,
  onOptionChange,
}: {
  lineItems: LineItemType[];
  selectedOptions: Record<number, number>;
  onOptionChange: (itemId: number, optionId: number) => void;
}) => {
  const [openItems, setOpenItems] = useState<number[]>([]);

  const toggleOpen = (id: number) => {
    setOpenItems((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  return (
    <div className="space-y-6">
      {lineItems.map((item) => (
        <LineItem
          key={item.id}
          item={item}
          isOpen={openItems.includes(item.id)}
          toggleOpen={() => toggleOpen(item.id)}
          selectedOption={selectedOptions[item.id]}
          onOptionChange={(optionId) => onOptionChange(item.id, optionId)}
        />
      ))}
    </div>
  );
};

// Main Quote Component
const Quote = ({
  companyName = "Acme Inc.",
  companyLogo = "/placeholder.svg?height=50&width=50",
  customerName = "John Doe",
  customerEmail = "john@example.com",
  lineItems = [
    {
      id: 1,
      thumbnail: "/placeholder.svg?height=200&width=200",
      description: "Premium Widget",
      longDescription:
        "High-quality widget with advanced features for improved productivity.",
      options: [
        { id: 1, quantity: 10, price: 100, leadTime: "1 week" },
        { id: 2, quantity: 20, price: 180, leadTime: "2 weeks" },
        { id: 3, quantity: 50, price: 400, leadTime: "1 month" },
      ],
    },
    {
      id: 2,
      thumbnail: "/placeholder.svg?height=200&width=200",
      description: "Deluxe Gadget",
      longDescription:
        "State-of-the-art gadget designed for maximum efficiency and performance.",
      options: [
        { id: 4, quantity: 5, price: 50, leadTime: "3 days" },
        { id: 5, quantity: 15, price: 130, leadTime: "1 week" },
        { id: 6, quantity: 30, price: 240, leadTime: "2 weeks" },
      ],
    },
  ],
}: QuoteProps) => {
  const [selectedOptions, setSelectedOptions] = useState<
    Record<number, number>
  >(() =>
    lineItems.reduce(
      (acc, item) => ({ ...acc, [item.id]: item.options[0].id }),
      {}
    )
  );
  const [taxRate, setTaxRate] = useState(0.1); // 10% tax rate

  const onOptionChange = (itemId: number, optionId: number) => {
    setSelectedOptions((prev) => ({ ...prev, [itemId]: optionId }));
  };

  const subtotal = lineItems.reduce((sum, item) => {
    const selectedOption = item.options.find(
      (option) => option.id === selectedOptions[item.id]
    );
    return sum + (selectedOption?.price || 0);
  }, 0);
  const tax = subtotal * taxRate;
  const total = subtotal + tax;

  return (
    <Card className="w-full max-w-5xl mx-auto">
      <Header
        companyName={companyName}
        companyLogo={companyLogo}
        customerName={customerName}
        customerEmail={customerEmail}
      />
      <CardContent>
        <LineItems
          lineItems={lineItems}
          selectedOptions={selectedOptions}
          onOptionChange={onOptionChange}
        />
        <div className="mt-8 space-y-2">
          <div className="flex justify-between items-center text-sm text-muted-foreground">
            <p>Subtotal:</p>
            <p>${subtotal.toFixed(2)}</p>
          </div>
          <div className="flex justify-between items-center text-sm text-muted-foreground">
            <p>Tax ({(taxRate * 100).toFixed(0)}%):</p>
            <p>${tax.toFixed(2)}</p>
          </div>
          <div className="flex justify-between items-center pt-2">
            <p className="text-2xl font-bold">Total:</p>
            <p className="text-2xl font-bold">${total.toFixed(2)}</p>
          </div>
        </div>
        <Button size="lg" className="w-full mt-6 text-lg">
          Accept Quote
        </Button>
      </CardContent>
    </Card>
  );
};

const ErrorMessage = ({
  title,
  message,
}: {
  title: string;
  message: string;
}) => {
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        delay: 0.3,
        when: "beforeChildren",
        staggerChildren: 0.2,
      },
    },
  };

  const itemVariants = {
    hidden: { y: 20, opacity: 0 },
    visible: {
      y: 0,
      opacity: 1,
    },
  };

  return (
    <motion.div
      className="flex min-h-screen flex-col items-center justify-center p-4 text-center"
      initial="hidden"
      animate="visible"
      variants={containerVariants}
    >
      <motion.div
        className="w-full max-w-md space-y-8"
        variants={containerVariants}
      >
        <motion.div
          className="relative mx-auto h-24 w-24"
          variants={itemVariants}
        >
          <svg
            className="absolute inset-0"
            viewBox="0 0 100 100"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <motion.circle
              cx="50"
              cy="50"
              r="45"
              stroke="hsl(var(--muted))"
              strokeWidth="10"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 2, ease: "easeInOut" }}
            />
            <motion.path
              d="M50 5 A45 45 0 0 1 95 50"
              stroke="hsl(var(--primary))"
              strokeWidth="10"
              strokeLinecap="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{
                duration: 2,
                ease: "easeInOut",
              }}
            />
          </svg>
          <motion.div
            className="absolute inset-0 flex items-center justify-center"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{
              delay: 0.5,
              type: "spring",
              stiffness: 200,
              damping: 10,
            }}
          >
            <span className="text-2xl font-bold text-muted-foreground">!</span>
          </motion.div>
        </motion.div>
        <motion.h1
          className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl"
          variants={itemVariants}
        >
          {title}
        </motion.h1>
        <motion.p
          className="text-lg text-muted-foreground"
          variants={itemVariants}
        >
          {message}
        </motion.p>
      </motion.div>
    </motion.div>
  );
};

export default function ExternalQuote() {
  const { state, data } = useLoaderData<typeof loader>();

  switch (state) {
    case QuoteState.Valid:
      return <pre>{JSON.stringify(data, null, 2)}</pre>;
    case QuoteState.Expired:
      return (
        <ErrorMessage
          title="Quote expired"
          message="Oops! The link you're trying to access has expired or is no longer valid."
        />
      );
    case QuoteState.NotFound:
      return (
        <ErrorMessage
          title="Quote not found"
          message="Oops! The link you're trying to access is not valid."
        />
      );
  }
}
