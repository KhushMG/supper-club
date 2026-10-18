import { allRuns } from "./agent-runs";
import { driveAgent } from "./ai-agent";
import { runOrderAgent } from "./order-agent";
import { mutate, readState } from "./db";
import { processDue, log } from "./domain";
export async function runJobs() {
  const now = new Date();
  const acquired = await mutate((s) => {
    if (s.jobLeaseUntil && new Date(s.jobLeaseUntil) > now) return false;
    s.jobLeaseUntil = new Date(now.getTime() + 5 * 60000).toISOString();
    return true;
  });
  if (!acquired) return { skipped: true };
  try {
    const pending = await readState();
    for (const plan of pending.plans.filter(
      (p) => p.autoOrder && p.status === "approved",
    ))
      await runOrderAgent(plan.id, undefined, now);
    await mutate((s) => {
      let count = 0;
      for (const p of s.plans) count += processDue(p, now);
      s.lastJobAt = now.toISOString();
      if (count)
        log(s, `Scheduled runner submitted ${count} sandbox order(s).`);
    });
    // Weekly planning always requires an explicit human authorization.
    for (const run of (await allRuns())
      .filter((r) => r.status === "running")
      .slice(0, 1))
      await driveAgent(run.id);
    return { ok: true };
  } catch (e) {
    await mutate((s) =>
      log(
        s,
        "Scheduled job needs attention. Check server logs and integration configuration.",
      ),
    );
    throw e;
  } finally {
    await mutate((s) => {
      delete s.jobLeaseUntil;
    });
  }
}
