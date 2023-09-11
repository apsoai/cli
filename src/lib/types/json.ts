export type JSONValue =
  | string
  | number
  | boolean
  | undefined
  | { [x: string]: JSONValue }
  | Array<JSONValue>;
