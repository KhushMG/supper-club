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
export async function recordTokens(day: string, input: number, output: number) {
  await database().execute({
    sql: "UPDATE agent_usage SET input_tokens=input_tokens+?, output_tokens=output_tokens+? WHERE day=?",
    args: [input, output, day],
  });
}
export async function reserveSearchFee(day: string) {
  // $0.01 search fee + a conservative $0.0032 search-token allowance.
  await database().execute({
    sql: "INSERT INTO agent_search_fees(day,micro_usd) VALUES(?,13200) ON CONFLICT(day) DO UPDATE SET micro_usd=micro_usd+13200",
    args: [day],
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
  return {
    calls: Number(x.calls || 0),
    estimatedUsd:
      (Number(x.input || 0) * 0.4 +
        Number(x.output || 0) * 1.6 +
        Number(fees.rows[0].total || 0)) /
      1e6,
    dailyCallLimit: null,
    lifetimeCallLimit: null,
  };
}
