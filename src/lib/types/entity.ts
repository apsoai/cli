import { Field } from "./field";
import { Index } from "./indices";
import { Association } from "./relationship";

export interface Entity {
  name: string;
  /* eslint-disable-next-line  camelcase */
  created_at?: boolean;
  /* eslint-disable-next-line  camelcase */
  updated_at?: boolean;
  fields?: Field[];
  indexes?: Index[];

  // only used for v1
  associations?: Association[];
}
