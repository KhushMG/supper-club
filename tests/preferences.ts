import { defaults as emptyPreferences } from "../lib/domain";
// Explicit cuisine choices for test households, never application defaults.
export const defaults = { ...emptyPreferences, cuisines: ["Italian", "Mexican", "Indian"] };
