// Constants shared by the engine and the app: the label colours and the ID prefix rule (docs/02 §3, docs/05 §6).

/** The 11 label colours (docs/05 §6), in the order new groups take them. */
export const LABEL_COLORS = [
  'green',
  'orange',
  'red',
  'blue',
  'purple',
  'teal',
  'navy',
  'yellow',
  'grey',
  'pink',
  'dark',
] as const;

/** A sheet's ID prefix: 1 to 6 capital letters or digits and "-" (docs/02 §3). */
export const ID_PREFIX = /^[A-Z0-9]{1,6}-$/;
