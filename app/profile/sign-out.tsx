"use client";
import { useState } from "react";
export function SignOut() {
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  return <><button className="secondary" disabled={busy} onClick={async()=>{
    setBusy(true);setError("");
    try {
      const response=await fetch("/api/logout",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
      if (!response.ok) throw new Error("Could not sign out. Try again.");
      location.href="/login";
    } catch(error) {setError(error instanceof Error?error.message:"Could not sign out.");setBusy(false);}
  }}>{busy?"Signing out…":"Sign out"}</button>{error&&<p role="alert" className="error">{error}</p>}</>;
}
