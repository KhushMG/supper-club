import { tokenCostMicroUsd } from "./ai-models";
import { createHash } from "node:crypto";
import { database, setup } from "./db";
let initialized: Promise<void> | undefined;
export async function agentStorage() {
  await setup();
  if (!initialized)
    initialized = (async () => {
      await database().execute(
        "CREATE TABLE IF NOT EXISTS agent_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER NOT NULL)",
      );
      await database().execute(
        "CREATE TABLE IF NOT EXISTS agent_runs (id TEXT PRIMARY KEY, value TEXT NOT NULL, lease INTEGER NOT NULL DEFAULT 0)",
      );
      await database().execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS one_active_planner ON agent_runs(json_extract(value, '$.kind')) WHERE json_extract(value, '$.kind')='planning' AND json_extract(value, '$.status')='running'",
      );
      await database().execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS one_execution_revision ON agent_runs(json_extract(value, '$.planId'),json_extract(value, '$.revision')) WHERE json_extract(value, '$.kind')='execution'",
      );
      await database().execute(
        "CREATE TABLE IF NOT EXISTS agent_search_fees (day TEXT PRIMARY KEY, micro_usd INTEGER NOT NULL DEFAULT 0)",
      );
      await database().execute(
        "CREATE TABLE IF NOT EXISTS agent_usage (day TEXT PRIMARY KEY, calls INTEGER NOT NULL DEFAULT 0, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0)",
      );
      await database().execute("CREATE TABLE IF NOT EXISTS agent_token_costs (day TEXT PRIMARY KEY, micro_usd REAL NOT NULL DEFAULT 0)");
      // Preserve historical 4.1-mini estimates; new usage records its own model rates.
      await database().execute("INSERT OR IGNORE INTO agent_token_costs(day,micro_usd) SELECT day,input_tokens*0.4+output_tokens*1.6 FROM agent_usage");
    })();
  await initialized;
}
export const cacheKey = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export async function cached<T>(key: string): Promise<T | undefined> {
  await agentStorage();
  const r = await database().execute({
    sql: "SELECT value FROM agent_cache WHERE key=? AND expires>?",
    args: [key, Date.now()],
  });
  return r.rows[0] ? (JSON.parse(String(r.rows[0].value)) as T) : undefined;
}
export async function cachePut(key: string, value: unknown, ttl: number) {
  await agentStorage();
  await database().execute({
    sql: "INSERT OR REPLACE INTO agent_cache(key,value,expires) VALUES(?,?,?)",
    args: [key, JSON.stringify(value), Date.now() + ttl],
  });
  await database().execute({
    sql: "DELETE FROM agent_cache WHERE expires<?",
    args: [Date.now()],
  });
}
// Count requests before sending, including failures, without a lifetime cutoff.
export async function reserveCall() {
  await agentStorage();
  const day = new Date().toISOString().slice(0, 10);
  await database().execute({
    sql: "INSERT INTO agent_usage(day,calls) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET calls=calls+1",
    args: [day],
  });
  return day;
}
export async function recordTokens(day: string, input: number, output: number, model = "gpt-4.1-mini", cachedInput = 0) {
  await database().execute({
    sql: "UPDATE agent_usage SET input_tokens=input_tokens+?, output_tokens=output_tokens+? WHERE day=?",
    args: [input, output, day],
  });
  await database().execute({
    sql:"INSERT INTO agent_token_costs(day,micro_usd) VALUES(?,?) ON CONFLICT(day) DO UPDATE SET micro_usd=micro_usd+excluded.micro_usd",
    args:[day,tokenCostMicroUsd(input,output,model,cachedInput)],
  });
}
export async function reserveSearchFee(day: string, model = "gpt-4.1-mini") {
  // Legacy mini search bills 8k extra tokens; Luna content tokens use model usage.
  await database().execute({
    sql: "INSERT INTO agent_search_fees(day,micro_usd) VALUES(?,?) ON CONFLICT(day) DO UPDATE SET micro_usd=micro_usd+excluded.micro_usd",
    args: [day, model === "gpt-4.1-mini" ? 13200 : 10000],
  });
}
export async function usageSummary() {
  await agentStorage();
  const r = await database().execute(
    "SELECT SUM(calls) calls,SUM(input_tokens) input,SUM(output_tokens) output FROM agent_usage",
  );
  const x = r.rows[0];
  const fees = await database().execute(
    "SELECT SUM(micro_usd) total FROM agent_search_fees",
  );
  const costs = await database().execute("SELECT SUM(micro_usd) total FROM agent_token_costs");
  return {
    calls: Number(x.calls || 0),
    estimatedUsd:
      (Number(costs.rows[0].total || 0) +
        Number(fees.rows[0].total || 0)) /
      1e6,
    dailyCallLimit: null,
    lifetimeCallLimit: null,
  };
}
