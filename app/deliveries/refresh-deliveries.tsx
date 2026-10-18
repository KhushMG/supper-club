"use client";
import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
export default function RefreshDeliveries() {
  const router=useRouter(); const [pending,startTransition]=useTransition();
  useEffect(()=>{const timer=setInterval(()=>{if(document.visibilityState==='visible') router.refresh();},30000);return()=>clearInterval(timer);},[router]);
  return <button className="secondary" disabled={pending} onClick={()=>startTransition(()=>router.refresh())}><RefreshCw size={16}/>{pending?"Refreshing…":"Refresh status"}</button>;
}
