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
import { json, type LoaderFunctionArgs } from "@vercel/remix";
import { motion } from "framer-motion";
import { useState } from "react";
import { LuChevronDown, LuChevronUp } from "react-icons/lu";
// import { getQuoteByExternalId } from "~/modules/sales";

export async function loader({ request, params }: LoaderFunctionArgs) {
  // const { id } = params;
  // if (!id) throw notFound("Quote not found");

  // const serviceRole = getCarbonServiceRole();
  // const document = await getQuoteByExternalId(serviceRole, id);
  // if (!document.data || !document.data.documentId)
  //   throw notFound("Quote not found");
  // const quoteId = document.data.documentId;

  return json({});
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
export default function Quote({
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
}: QuoteProps) {
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
}
