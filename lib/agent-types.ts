import type { Plan, Preferences, Recipe } from "./types";
import type { LivePrices } from "./grocery-prices";
import type { ModelItem } from "./agent-model";
export type AgentRun = {
  id: string;
  kind: "planning" | "execution";
  status: "running" | "awaiting_approval" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
  week: string;
  preferences: Preferences;
  feedback: string;
  calls: number;
  cacheHits: number;
  trace: { at: string; tool: string; summary: string; display?: string; failed?: boolean }[];
  currentAction?: string;
  activity?: {at: string; label: string; status: "running" | "done" | "error"; detail?: string}[];
  input: unknown[];
  pending?: ModelItem[];
  catalog: Recipe[];
  recentMeals?: string[];
  unavailablePublishers?: string[];
  offers?: LivePrices;
  candidate?: Plan;
  budgetResearchRequired?: boolean;
  budgetResearchAttempts?: number;
  planId?: string;
  revision?: number;
  error?: string;
  summary?: string;
};
export type AgentRunSummary = Pick<
  AgentRun,
  | "id"
  | "kind"
  | "status"
  | "createdAt"
  | "updatedAt"
  | "calls"
  | "cacheHits"
  | "trace"
  | "currentAction"
  | "activity"
  | "revision"
  | "planId"
  | "error"
  | "summary"
>;
export function publicRun(r: AgentRun): AgentRunSummary {
  const {
    id,
    kind,
    status,
    createdAt,
    updatedAt,
    calls,
    cacheHits,
    trace,
    currentAction,
    activity,
    planId,
    revision,
    error,
    summary,
  } = r;
  return {
    id,
    kind,
    status,
    createdAt,
    updatedAt,
    calls,
    cacheHits,
    trace,
    currentAction,
    activity,
    planId,
    revision,
    error,
    summary,
  };
}
