// Explicit model choices; no automatic escalation to higher-cost models.
export const AGENT_MODEL = "gpt-6-luna";
export const RECIPE_SEARCH_MODEL = "gpt-6-luna";
export const tokenCostMicroUsd = (input: number, output: number, model: string, cachedInput = 0) => {
  const cached = Math.min(input, Math.max(0, cachedInput));
  const rates = model === "gpt-6-luna" ? {input:0.10,cached:0.01,output:0.50} : {input:0.40,cached:0.10,output:1.60};
  return (input-cached)*rates.input + cached*rates.cached + output*rates.output;
};
