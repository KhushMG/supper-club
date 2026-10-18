import type {AgentRunSummary} from '@/lib/agent-types';

export function AgentProgress({run, compact = false}: {run?: AgentRunSummary; compact?: boolean}) {
  const steps = (run?.trace || []).filter(step => step.display);
  if (compact && !steps.length) return null;
  const history = <ol className="agent-steps">{steps.map((step, i) => <li key={`${step.at}-${i}`} className={step.failed ? 'step-retry' : ''}>
    <span aria-hidden="true">{step.failed ? '↳' : '✓'}</span><span>{step.display}</span>
  </li>)}</ol>;
  if (compact) return <details className="agent-progress agent-progress-saved"><summary>How your agent built this plan</summary>{history}</details>;
  return <section className="agent-progress" aria-label="Agent progress">
    <p className="agent-current" role="status"><span className="agent-dot" aria-hidden="true" />{run?.currentAction || 'Choosing the next action from the results so far…'}</p>
    {steps.length > 0 && <ol className="agent-steps">{steps.slice(-3).map((step,i) => <li key={`${step.at}-${i}`} className={step.failed ? 'step-retry' : ''}><span aria-hidden="true">{step.failed ? '↳' : '✓'}</span><span>{step.display}</span></li>)}</ol>}
    {steps.length > 3 && <details><summary>View all {steps.length} steps</summary>{history}</details>}
    <small>Live actions from your agent · no purchase without order approval</small>
  </section>;
}
