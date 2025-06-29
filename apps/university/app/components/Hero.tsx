export function Hero({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full bg-[linear-gradient(to_bottom_right,#f7f5ff_35.67%,#c9fff8_88.95%)] dark:bg-[linear-gradient(to_bottom_right,#0e0338_35.67%,#1b433e_88.95%)]">
      <div className="flex flex-col gap-6 w-full px-4 max-w-5xl mx-auto my-20 mb-28">
        {children}
      </div>
    </div>
  );
}
