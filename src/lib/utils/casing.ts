export function camelCase(str: string): string {
  return str
    // Insert a space before all caps that are followed by lower case (for PascalCase)
    .replace(/([\da-z])([A-Z])/g, '$1 $2')
    // Replace all separators with spaces
    .replace(/[ _-]+/g, ' ')
    // Lowercase the string, then uppercase the first letter of each word (except the first)
    .toLowerCase()
    .replace(/ (\w)/g, (_, c) => c ? c.toUpperCase() : '')
    // Remove spaces
    .replace(/ /g, '');
}

export const snakeCase = (str: string): string =>
  str[0].toLowerCase() +
  str
    .slice(1, str.length)
    .replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

export function pascalCase(str: string): string {
  const c = camelCase(str);
  return c.charAt(0).toUpperCase() + c.slice(1);
}
