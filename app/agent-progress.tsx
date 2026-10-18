import {useEffect,useRef} from 'react';
import type {AgentRunSummary} from '@/lib/agent-types';

export function AgentProgress({run, compact = false}: {run?: AgentRunSummary; compact?: boolean}) {
  const log = useRef<HTMLOListElement>(null);
  const follow = useRef(true);
  const activity = run?.activity?.length ? run.activity : [
    ...(run?.trace || []).filter(s=>s.display).map(s=>({at:s.at,label:s.display!,status:s.failed?'error':'done',detail:undefined})),
    ...(run?.currentAction ? [{at:'current',label:run.currentAction,status:'running',detail:undefined}] : []),
  ];
  useEffect(()=>{if(follow.current && log.current) log.current.scrollTop=log.current.scrollHeight;},[activity.length,run?.currentAction]);
  if (compact && !activity.length) return null;
  const history=<ol ref={log} className="agent-conversation" role={compact?undefined:'log'} aria-label="Live agent actions" aria-live="polite" aria-relevant="additions text" onScroll={e=>{const el=e.currentTarget;follow.current=el.scrollHeight-el.scrollTop-el.clientHeight<40;}}>
    {activity.map((step,i)=><li key={`${run?.id}-${step.at}-${i}`} className={`agent-message ${step.status}`}>
      <span className="agent-message-mark" aria-hidden="true">{step.status==='running'?'•':step.status==='error'?'↳':'✓'}</span>
      <div><p>{step.label}</p>{step.detail && <small>{step.detail}</small>}</div>
    </li>)}
    {!activity.length && <li className="agent-message"><span className="agent-message-mark" aria-hidden="true">•</span><p>Getting your dinner search started…</p></li>}
    {run?.status==='running' && activity.length>0 && !activity.some(a=>a.status==='running') && <li className="agent-next">Reviewing the results and choosing the next step…</li>}
  </ol>;
  if(compact) return <details className="agent-progress agent-progress-saved"><summary>How your agent built this plan</summary>{history}</details>;
  return <section className="agent-progress agent-progress-live" aria-label="Agent progress">
    <div className="agent-log-heading"><span>YOUR DINNER ASSISTANT</span><span>{run?.status==='awaiting_approval'?'Ready':'Live'}</span></div>
    {history}
    <p className="agent-log-footnote">Real actions as they happen. Your approval comes before ordering.</p>
  </section>;
}
