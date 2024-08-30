export function scrollIntoView(element: HTMLElement | undefined | null) {
  element?.scrollIntoView({
    inline: "nearest",
    block: "nearest",
  });
}
