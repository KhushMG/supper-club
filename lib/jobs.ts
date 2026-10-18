import { mutate, readState } from "./db";
import { discover } from "./recipes";
import { nextMonday, makePlan, processDue, log } from "./domain";
import { formatInTimeZone } from "date-fns-tz";
export async function runJobs() {
  const now = new Date();
  const acquired = await mutate((s) => {
    if (s.jobLeaseUntil && new Date(s.jobLeaseUntil) > now) return false;
    s.jobLeaseUntil = new Date(now.getTime() + 5 * 60000).toISOString();
    return true;
  });
  if (!acquired) return { skipped: true };
  try {
    await mutate((s) => {
      let count = 0;
      for (const p of s.plans) count += processDue(p, now);
      s.lastJobAt = now.toISOString();
      if (count)
        log(s, `Scheduled runner submitted ${count} sandbox order(s).`);
    });
    const s = await readState(),
      p = s.preferences;
    const localDay = Number(formatInTimeZone(now, p.timezone, "i")),
      hour = Number(formatInTimeZone(now, p.timezone, "H"));
    const week = nextMonday(now, p.timezone);
    if (
      p.recurring &&
      ((localDay === 5 && hour >= 9) || localDay === 6 || localDay === 7) &&
      !s.plans.some((x) => x.week === week) &&
      s.lastGeneratedWeek !== week
    ) {
      const result = await discover(p, "");
      const plan = makePlan(result.recipes, p, week, "", result.mode);
      await mutate((s) => {
        if (!s.plans.some((x) => x.week === week)) {
          s.plans.unshift(plan);
          s.activePlanId = plan.id;
          s.lastGeneratedWeek = week;
          log(s, "Next week’s draft is ready for approval.");
        }
      });
    }
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
