import { TooltipProvider } from "../../Tooltip";
import type { EditorComponent } from "../types";
import BlockQuote from "./BlockQuote";
import Bold from "./Bold";
import Code from "./Code";
import CodeBlock from "./CodeBlock";
import { HeadingOne, HeadingThree, HeadingTwo } from "./Heading";
import HorizontalRule from "./HorizontalRule";
import Italic from "./Italic";
import OrderedList from "./OrderedList";
import Paragraph from "./Paragraph";
import Strike from "./Strike";
import UnorderedList from "./UnorderedList";

const Toolbar: EditorComponent = ({ editor }) => {
  return (
    <TooltipProvider>
      <div className="w-full border-b border-border p-2">
        <div className="flex flex-wrap gap-2">
          <Paragraph editor={editor} />
          <HeadingOne editor={editor} />
          <HeadingTwo editor={editor} />
          <HeadingThree editor={editor} />

          {/* Inline styles */}
          <Bold editor={editor} />
          <Italic editor={editor} />
          <Strike editor={editor} />
          <Code editor={editor} />

          {/* Block styles */}
          <UnorderedList editor={editor} />
          <OrderedList editor={editor} />
          <CodeBlock editor={editor} />
          <BlockQuote editor={editor} />
          <HorizontalRule editor={editor} />
        </div>
      </div>
    </TooltipProvider>
  );
};

export default Toolbar;
