export const camelCase = (str: string, firstUpper?: boolean): string => {
  const firstLetter = firstUpper ? str[0].toUpperCase() : str[0].toLowerCase();
  const restOfLetters = str
    .slice(1)
    .replace(/_[A-Za-z]/g, (underLetter) => underLetter[1].toUpperCase());
  return `${firstLetter}${restOfLetters}`;
};

export const snakeCase = (str: string): string =>
  str[0].toLowerCase() +
  str
    .slice(1, str.length)
    .replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
