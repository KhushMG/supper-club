import type {Plan} from '@/lib/types';
import {money} from '@/lib/domain';

export function OrderReview({plan,onClose,onConfirm}: {plan:Plan;onClose:()=>void;onConfirm:()=>void}) {
 const lines=plan.retailBasket?.batches.flatMap(b=>b.lines).filter(l=>(l.packages || 0)>0) || [];
 const subtotal=plan.retailBasket?.subtotalCents ?? plan.batches.reduce((s,b)=>s+b.subtotalCents,0);
 return <div className="modal-backdrop"><section className="modal order-review" role="dialog" aria-modal="true" aria-labelledby="order-review-title">
  <button className="close" aria-label="Close order review" onClick={onClose}>×</button>
  <span className="eyebrow">REVIEW YOUR ORDER</span>
  <h2 id="order-review-title">Ready to stock your kitchen?</h2>
  <p>{plan.meals.length} dinners · {plan.preferences.servings} {plan.preferences.servings===1?'person':'people'} · {plan.retailBasket?.storeName || 'Your grocery basket'}</p>
  <p className="checkout-demo"><strong>Demo mode.</strong> {plan.retailBasket?.environment === "certification" ? "Products use Kroger certification data." : "Kroger product prices are real."} Payment, delivery, and checkout charges are simulated. No real charge or grocery delivery.</p>
  {plan.aiSummary?.includes("Some dinners repeat after budget recovery") && <p>Some dinners repeat after budget recovery to keep whole-package costs within your cap.</p>}
  <details><summary>Your dinners</summary><ul>{plan.meals.map(m=><li key={m.day}>{m.recipe.title}</li>)}</ul></details>
  <div className="checkout-items" aria-label="Order items"><table><thead><tr><th scope="col">Item</th><th scope="col">Packs</th><th scope="col">Price</th></tr></thead><tbody>{lines.map((line,i)=><tr key={i}><td>{line.description || line.name}<small>{line.size}{line.name !== line.description ? ` · For ${line.name}` : ''}</small></td><td>{line.packages}</td><td>{money(line.totalCents || 0)}</td></tr>)}</tbody></table></div>
  <dl className="checkout-totals"><div><dt>Groceries</dt><dd>{money(subtotal)}</dd></div><div><dt>Delivery</dt><dd>{money(plan.simulationQuote?.feeCents || 0)}</dd></div><div><dt>Tax</dt><dd>{money(plan.simulationQuote?.taxCents || 0)}</dd></div><div><dt>Tip</dt><dd>{money(plan.batches.reduce((s,b)=>s+b.tipCents,0))}</dd></div><div className="checkout-total"><dt>Total</dt><dd>{money(plan.totalCents)}</dd></div></dl>
  <p>Within your {money(plan.preferences.budgetCents)} weekly cap. Confirming authorizes the agent to pay and place this exact order in demo mode.</p>
  <div className="checkout-actions"><button className="secondary" onClick={onClose}>Keep reviewing</button><button className="primary" onClick={onConfirm}>Confirm &amp; place order · {money(plan.totalCents)}</button></div>
 </section></div>;
}
