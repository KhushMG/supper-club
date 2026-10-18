import {
  cacheKey,
  cached,
  cachePut,
  reserveCall,
  recordTokens,
} from "./agent-store";
export type ModelItem = {
  type: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  [key: string]: unknown;
};
export type ModelReply = {
  output: ModelItem[];
  usage?: { input_tokens: number; output_tokens: number };
};
export type AgentTool = {
  type: "function";
  name: string;
  description: string;
  strict: true;
  parameters: Record<string, unknown>;
};
export function tool(
  name: string,
  description: string,
  properties: Record<string, unknown> = {},
): AgentTool {
  return {
    type: "function",
    name,
    description,
    strict: true,
    parameters: {
      type: "object",
      properties,
      required: Object.keys(properties),
      additionalProperties: false,
    },
  };
}
export function compactInput(input: unknown[]): unknown[] {
  const parsed = input.map((value) => {
    const item = value as Record<string, unknown>;
    if (item.type !== "function_call_output" || typeof item.output !== "string")
      return undefined;
    try {
      return JSON.parse(item.output);
    } catch {
      return undefined;
    }
  });
  const latestProducts = parsed.findLastIndex((data) =>
    Array.isArray(data?.products),
  );
  const latestRecipes = parsed.findLastIndex((data) =>
    Array.isArray(data?.recipes),
  );
  return input.map((value, index) => {
    const item = value as Record<string, unknown>;
    if (item.type !== "function_call_output" || typeof item.output !== "string")
      return value;
    try {
      const data = parsed[index];
      if (!data) return value;
      if (Array.isArray(data.recipes))
        data.recipes = data.recipes.map((r: Record<string, unknown>) => ({
          id: r.id,
          title: r.title,
          cuisine: r.cuisine,
          minutes: r.minutes,
          ingredients:
            index === latestRecipes && Array.isArray(r.ingredients)
              ? r.ingredients.slice(0, 4)
              : undefined,
        }));
      delete data.availableRecipes;
      if (index !== latestProducts && Array.isArray(data.products)) {
        data.productCount = data.products.length;
        data.superseded =
          "Historical quote. Use the latest basket for current prices and product choices.";
        delete data.products;
        delete data.simulationQuote;
      }
      if (Array.isArray(data.products)) {
        const unique = new Map<string, Record<string, unknown>>();
        for (const p of data.products) {
          const old = unique.get(p.ingredient);
          if (old) {
            old.packages = Number(old.packages || 0) + Number(p.packages || 0);
            old.cents =
              old.cents !== undefined && p.cents !== undefined
                ? Number(old.cents) + Number(p.cents)
                : undefined;
          } else
            unique.set(p.ingredient, {
              ...p,
              alternatives: p.alternatives
                ?.slice(0, 2)
                .map((a: Record<string, unknown>) => ({
                  productId: a.productId,
                  size: a.size,
                  regularCents: a.regularCents,
                  description: String(a.description).slice(0, 70),
                })),
            });
        }
        data.products = [...unique.values()];
      }
      return { ...item, output: JSON.stringify(data) };
    } catch {
      return value;
    }
  });
}
export async function callModel(
  input: unknown[],
  tools: AgentTool[],
  instructions: string,
  allowCache: boolean,
): Promise<{ reply: ModelReply; cacheHit: boolean }> {
  if (!process.env.OPENAI_API_KEY)
    throw new Error("Configure OPENAI_API_KEY to run the AI agent.");
  const body = {
    model: "gpt-4.1-mini",
    store: false,
    instructions,
    input: compactInput(input),
    tools,
    parallel_tool_calls: false,
    tool_choice: "required",
    max_output_tokens: 1800,
  };
  const encoded = JSON.stringify(body);
  if (Buffer.byteLength(encoded) > 45000)
    throw new Error(
      "Agent context limit reached. Start a narrower plan to keep AI spend low.",
    );
  const key = "model-v1:" + cacheKey(body);
  if (allowCache) {
    const hit = await cached<ModelReply>(key);
    if (hit) return { reply: hit, cacheHit: true };
  }
  const day = await reserveCall();
  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + process.env.OPENAI_API_KEY,
      "Content-Type": "application/json",
    },
    body: encoded,
    signal: AbortSignal.timeout(45000),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(
      `OpenAI request failed (${r.status}, ${e.error?.code || "unavailable"}). No automatic paid retry.`,
    );
  }
  const reply = (await r.json()) as ModelReply;
  await recordTokens(
    day,
    reply.usage?.input_tokens || 0,
    reply.usage?.output_tokens || 0,
  );
  if (!Array.isArray(reply.output))
    throw new Error("Model returned no tool calls.");
  if (allowCache) await cachePut(key, reply, 86400000);
  return { reply, cacheHit: false };
}
