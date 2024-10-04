export const capitalize = (words: string) => {
  const [first, ...otherLetters] = words;
  return [first.toLocaleUpperCase(), ...otherLetters].join("");
};
