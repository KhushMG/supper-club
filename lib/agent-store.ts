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
// Conservative prepaid call reservations: at most $0.025/call for the fixed
// model and byte/output caps in agent-model. Failed requests consume a slot too.
export async function reserveCall() {
  await agentStorage();
  const day = new Date().toISOString().slice(0, 10);
  const tx = await database().transaction("write");
  try {
    const r = await tx.execute("SELECT day,calls FROM agent_usage");
    const lifetime = r.rows.reduce((n, x) => n + Number(x.calls), 0);
    const daily = Number(r.rows.find((x) => x.day === day)?.calls || 0);
    if (daily >= 20 || lifetime >= 200)
      throw new Error(
        "AI spending guard reached. Maximum 20 calls/day and 200 total calls; review usage before increasing limits.",
      );
    await tx.execute({
      sql: "INSERT INTO agent_usage(day,calls) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET calls=calls+1",
      args: [day],
    });
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  } finally {
    tx.close();
  }
  return day;
}
export async function recordTokens(day: string, input: number, output: number) {
  await database().execute({
    sql: "UPDATE agent_usage SET input_tokens=input_tokens+?, output_tokens=output_tokens+? WHERE day=?",
    args: [input, output, day],
  });
}
export async function usageSummary() {
  await agentStorage();
  const r = await database().execute(
    "SELECT SUM(calls) calls,SUM(input_tokens) input,SUM(output_tokens) output FROM agent_usage",
  );
  const x = r.rows[0];
  return {
    calls: Number(x.calls || 0),
    estimatedUsd:
      (Number(x.input || 0) * 0.4 + Number(x.output || 0) * 1.6) / 1e6,
    dailyCallLimit: 20,
    lifetimeCallLimit: 200,
  };
}
