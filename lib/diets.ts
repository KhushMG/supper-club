export const DIET_OPTIONS = [
  {value:"none",label:"No dietary preference"},
  {value:"vegetarian",label:"Vegetarian"},
  {value:"vegan",label:"Vegan"},
  {value:"halal",label:"Halal"},
  {value:"kosher",label:"Kosher"},
] as const;
export type Diet = typeof DIET_OPTIONS[number]["value"];
export const CERTIFICATION_NOTE = "Halal and kosher choices guide recipe matching. Ingredient certification and preparation practices are not verified; check product labels before cooking.";
