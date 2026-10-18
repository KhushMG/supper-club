import { database } from "./db";
import { agentStorage } from "./agent-store";
import { publicRun, type AgentRun } from "./agent-types";
export async function saveRun(run: AgentRun) {
  await agentStorage();
  run.updatedAt = new Date().toISOString();
  await database().execute({
    sql: "INSERT INTO agent_runs(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
    args: [run.id, JSON.stringify(run)],
  });
}
export async function getRun(id: string) {
  await agentStorage();
  const r = await database().execute({
    sql: "SELECT value FROM agent_runs WHERE id=?",
    args: [id],
  });
  return r.rows[0]
    ? (JSON.parse(String(r.rows[0].value)) as AgentRun)
    : undefined;
}
export async function allRuns() {
  await agentStorage();
  const r = await database().execute(
    "SELECT value FROM agent_runs ORDER BY rowid DESC LIMIT 20",
  );
  return r.rows.map((x) => JSON.parse(String(x.value)) as AgentRun);
}
export async function listRuns() {
  return (await allRuns()).map(publicRun);
}
export async function claimRun(id: string) {
  await agentStorage();
  const r = await database().execute({
    sql: "UPDATE agent_runs SET lease=? WHERE id=? AND lease<?",
    args: [Date.now() + 300000, id, Date.now()],
  });
  return r.rowsAffected === 1;
}
export async function releaseRun(id: string) {
  await database().execute({
    sql: "UPDATE agent_runs SET lease=0 WHERE id=?",
    args: [id],
  });
}
