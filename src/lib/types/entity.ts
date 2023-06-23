import { Field } from "./field";
import { Association } from "./relationship";
import { Index } from "./indices";

export interface Entity {
  name: string;
  /* eslint-disable-next-line  camelcase */
  created_at?: boolean;
  /* eslint-disable-next-line  camelcase */
  updated_at?: boolean;
  fields?: Field[];
  associations?: Association[];
  indexes?: Index[];
}
