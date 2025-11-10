import { Unique } from "./constraints";
import { Field } from "./field";
import { Index } from "./indices";
import { Association } from "./relationship";

export interface Entity {
  name: string;
  /* eslint-disable-next-line  camelcase */
  created_at?: boolean;
  /* eslint-disable-next-line  camelcase */
  updated_at?: boolean;
  primaryKeyType?: 'serial' | 'uuid';
  fields?: Field[];
  indexes?: Index[];
  uniques?: Unique[];

  // only used for v1
  associations?: Association[];
}
