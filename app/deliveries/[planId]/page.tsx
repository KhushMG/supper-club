import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Truck, CalendarDays, CheckCircle2 } from "lucide-react";
import { verify } from "@/lib/auth";
import { readState } from "@/lib/db";
import { DAYS, money } from "@/lib/domain";
import RefreshDeliveries from "../refresh-deliveries";
export const dynamic = "force-dynamic";
export default async function DeliveryWeek({params}:{params:Promise<{planId:string}>}) {
  const {planId}=await params;
  if(!verify((await cookies()).get("supper_session")?.value)) redirect("/login?next="+encodeURIComponent(`/deliveries/${planId}`));
  const state=await readState();
  const plan=state.plans.find(p=>p.id===planId);
  if(!plan) notFound();
  const paid=state.payments.some(p=>p.planId===plan.id&&p.revision===plan.revision&&p.status==='paid');
  const approved=plan.status==='approved'&&plan.approvedRevision===plan.revision;
  const date=(value:string)=>new Intl.DateTimeFormat('en-US',{timeZone:plan.preferences.timezone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(value));
  const week=new Intl.DateTimeFormat('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(plan.week+'T12:00:00Z'));
  const status=plan.status==='paused'?'Paused':paid?'Test payment confirmed':approved?'Awaiting test payment':'Awaiting approval';
  return <main className="delivery-record-page">
    <nav className="record-nav" aria-label="Kitchen sections"><Link href="/">This week</Link><Link href="/groceries">Grocery list</Link><Link href="/deliveries" aria-current="page">Deliveries</Link><Link href="/activity">Activity</Link></nav>
    <header className="delivery-record-heading"><div><p className="eyebrow">YOUR DELIVERIES</p><h1>Week of {week}</h1><p className="muted">{plan.batches.length} scheduled deliveries · {plan.preferences.servings} {plan.preferences.servings===1?'person':'people'}</p></div><RefreshDeliveries/></header>
    <section className="panel delivery-receipt-summary"><div><CheckCircle2 size={20}/><strong>{status}</strong></div><div><span>Weekly total</span><strong>{money(plan.totalCents)}</strong></div><p>Test fulfillment · No real groceries were purchased. Times below are scheduled targets for the simulation.</p><small>Week reference: {plan.id}</small></section>
    <div className="delivery-record-list">{plan.batches.map((batch,index)=>{
      const lines=plan.retailBasket?.batches.find(b=>b.batchId===batch.id)?.lines;
      const current=batch.status==='scheduled'&&!paid?'Awaiting checkout':batch.status==='scheduled'?'Scheduled':batch.status==='submitted'?'Submitted (simulation)':batch.status==='delivered'?'Delivered (simulation)':batch.status==='held'?'On hold':'Cancelled';
      return <section className="panel delivery-record-card" id={batch.id} key={batch.id}>
        <header><div className="icon-circle"><Truck size={24}/></div><div><h2>Delivery {index+1}</h2><p>{batch.days.map(day=>DAYS[day]).join(' · ')}</p></div><span className="delivery-status">{current}</span></header>
        <dl className="delivery-facts"><div><dt><CalendarDays size={16}/> Scheduled arrival</dt><dd>{date(batch.deliveryAt)}</dd></div><div><dt>Time zone</dt><dd>{plan.preferences.timezone.replaceAll('_',' ')}</dd></div><div><dt>Order reference</dt><dd>{batch.orderId || 'Not submitted yet'}</dd></div><div><dt>Delivery reference</dt><dd>{batch.id}</dd></div></dl>
        {batch.reason&&<p className="alert error">{batch.reason}</p>}
        <h3>Dinners in this delivery</h3><ul className="delivery-meals">{plan.meals.filter(m=>batch.days.includes(m.day)).map(m=><li key={m.day}><span>{DAYS[m.day]}</span>{m.recipe.title}</li>)}</ul>
        <details><summary>View groceries ({lines?.length ?? batch.groceries.length} items)</summary><ul className="delivery-items">{lines?lines.map((line,i)=><li key={i}><span>{line.description || line.name}<small>{line.size || 'Package size not confirmed'}{line.issue?' · Price unconfirmed':''}</small></span><strong>{line.packages!==undefined?`${line.packages} × `:''}{line.totalCents!==undefined?money(line.totalCents):'Included in test estimate'}</strong></li>):batch.groceries.map((line,i)=><li key={i}><span>{line.name}</span><strong>{line.packages} packages · {money(line.totalCents)}</strong></li>)}</ul></details>
        <footer><span>Delivery total (test)</span><strong>{money(batch.totalCents)}</strong></footer>
      </section>;
    })}</div>
    <p className="muted record-footnote">Status refreshes every 30 seconds while this page is open. Scheduled processing follows the approved week.</p>
  </main>;
}
