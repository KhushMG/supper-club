"use client";
import { useEffect, useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
export default function RefreshDeliveries({planId,canDemo}:{planId:string;canDemo:boolean}) {
  const [error,setError]=useState("");
  const [starting,setStarting]=useState(false);
  const router=useRouter(); const [pending,startTransition]=useTransition();
  useEffect(()=>{const timer=setInterval(()=>{if(document.visibilityState==='visible') router.refresh();},15000);return()=>clearInterval(timer);},[router]);
  async function demo() {
    setStarting(true);setError("");
    try {
      const r=await fetch("/api/sandbox/demo",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({planId})});
      if(!r.ok) throw new Error((await r.json()).error || "Could not start demo.");
      router.refresh();
    } catch(e) {setError(e instanceof Error?e.message:"Could not start demo.");}
    finally {setStarting(false);}
  }
  return <div><button className="secondary" disabled={pending} onClick={()=>startTransition(()=>router.refresh())}><RefreshCw size={16}/>{pending?"Refreshing…":"Refresh status"}</button><details className="demo-controls"><summary>Demo controls</summary><p>Run confirmed test deliveries through a 2½-minute timeline.</p><button className="secondary" disabled={!canDemo || starting} onClick={demo}>{starting?"Starting…":"Run fast delivery demo"}</button>{error&&<p role="alert">{error}</p>}</details></div>;
}
