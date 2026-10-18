"use client";
import {useState,useTransition} from "react";
import {useRouter} from "next/navigation";
import {fulfillmentLabels,type Fulfillment} from "@/lib/simulated-provider";
export default function NextDeliveryStage({planId,batchId,stage}:{planId:string;batchId:string;stage:Fulfillment["stage"]}) {
  const router=useRouter();
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const [pending,startTransition]=useTransition();
  const next=stage==='confirmed'?'shopping':stage==='shopping'?'out_for_delivery':stage==='out_for_delivery'?'delivered':undefined;
  async function advance(){
    setBusy(true);setError("");
    try {
      const response=await fetch('/api/sandbox/next-stage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({planId,batchId,expectedStage:stage})});
      if(!response.ok) throw new Error((await response.json()).error || 'Could not advance delivery.');
      startTransition(()=>router.refresh());
    }catch(e){setError(e instanceof Error?e.message:'Could not advance delivery.');}
    finally{setBusy(false);}
  }
  return <div className="delivery-demo-step">
    {next ? <><button className="secondary" disabled={busy||pending} onClick={advance}>{busy||pending?'Updating…':`Next stage: ${fulfillmentLabels[next]}`}</button><p className="muted">Demo control · switches this delivery to manual progress.</p></> : <p role="status">{stage==='delivered'?'Delivery complete. Your test order and receipt are saved.':'This test delivery was cancelled.'}</p>}
    {error&&<p role="alert" className="error">{error}</p>}
  </div>;
}
