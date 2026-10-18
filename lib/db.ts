import { createClient, type Client } from "@libsql/client";
import { defaults } from "./domain";
import type { State } from "./types";
let client: Client | undefined;
let ready: Promise<void> | undefined;
export function database() {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL || "file:supper.db";
    if (
      process.env.VERCEL &&
      !url.startsWith("libsql://") &&
      !url.startsWith("https://")
    )
      throw new Error(
        "Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN before deploying. Local SQLite is for local development only.",
      );
    client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  }
  return client;
}
export async function setup() {
  if (!ready)
    ready = (async () => {
      await database().execute(
        "CREATE TABLE IF NOT EXISTS household (id INTEGER PRIMARY KEY CHECK (id = 1), state TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0)",
      );
      const initial: State = {
        preferences: structuredClone(defaults),
        plans: [],
        payments: [],
        events: [],
      };
      await database().execute({
        sql: "INSERT OR IGNORE INTO household (id,state) VALUES (1,?)",
        args: [JSON.stringify(initial)],
      });
    })();
  try {
    await ready;
  } catch (e) {
    ready = undefined;
    throw e;
  }
}
export async function readState(): Promise<State> {
  await setup();
  const r = await database().execute("SELECT state FROM household WHERE id=1");
  return JSON.parse(String(r.rows[0].state));
}
// Network calls must happen outside this serializable write transaction.
export async function mutate<T>(fn: (state: State) => T): Promise<T> {
  await setup();
  const tx = await database().transaction("write");
  try {
    const r = await tx.execute("SELECT state FROM household WHERE id=1");
    const state: State = JSON.parse(String(r.rows[0].state));
    const result = fn(state);
    await tx.execute({
      sql: "UPDATE household SET state=?, revision=revision+1 WHERE id=1",
      args: [JSON.stringify(state)],
    });
    await tx.commit();
    return result;
  } catch (e) {
    await tx.rollback();
    throw e;
  } finally {
    tx.close();
  }
}
