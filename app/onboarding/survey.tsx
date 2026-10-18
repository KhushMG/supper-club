"use client";
import { NumberField } from "../number-field";
import { DIET_OPTIONS, CERTIFICATION_NOTE } from "@/lib/diets";
import { US_TIMEZONES } from "@/lib/timezones";
import { useState } from "react";
import { defaults } from "@/lib/domain";
import type { Preferences } from "@/lib/types";
const cuisines = ["Italian", "Mexican", "Indian", "Thai", "Mediterranean", "Japanese", "American"];
const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export default function Survey({name}:{name:string}) {
  const [step,setStep]=useState(0), [busy,setBusy]=useState(false), [error,setError]=useState("");
  const [preferences,setPreferences]=useState<Preferences>({...defaults,cuisines:[],zip:"",tipCents:0,servings:NaN,budgetCents:NaN});
  const [exclusions,setExclusions]=useState("");
  function update<K extends keyof Preferences>(key:K,value:Preferences[K]) {setPreferences(p=>({...p,[key]:value}));}
  async function next(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    if(step<2) {setStep(step+1);return;}
    setBusy(true);
    try {
      const response=await fetch("/api/onboarding",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...preferences,exclusions:exclusions.split(",").map(x=>x.trim()).filter(Boolean)})});
      if(!response.ok) throw new Error("Couldn't save your preferences. Check your answers and try again.");
      window.location.href="/";
    } catch(e) {setError(e instanceof Error?e.message:"Please try again.");setBusy(false);}
  }
  return <main className="profile-page"><section className="profile-card survey-card">
    <p className="eyebrow">WELCOME, {name.toUpperCase()}</p>
    <p className="muted">Step {step+1} of 3</p>
    <progress value={step+1} max={3} aria-label="Survey progress"/>
    <form onSubmit={next}>
      {step===0&&<><h1>What sounds good?</h1><p>Choose the cuisines you want for your dinners.</p><div className="survey-choices">{cuisines.map(c=><button type="button" key={c} aria-pressed={preferences.cuisines.includes(c)} onClick={()=>update("cuisines",preferences.cuisines.includes(c)?preferences.cuisines.filter(x=>x!==c):[...preferences.cuisines,c])}>{c}</button>)}</div>
        <label>Dietary preference<select value={preferences.diet} onChange={e=>update("diet",e.target.value as Preferences["diet"])}>{DIET_OPTIONS.map(({value,label})=><option key={value} value={value}>{label}</option>)}</select></label>
        {(preferences.diet === "halal" || preferences.diet === "kosher") && <p className="muted">{CERTIFICATION_NOTE}</p>}
        <label>Ingredients to avoid (optional)<input value={exclusions} onChange={e=>setExclusions(e.target.value)} placeholder="For example, mushrooms, peanuts" maxLength={500}/></label></>}
      {step===1&&<><h1>Your dinner routine</h1><label>People at the table<NumberField placeholder="e.g. 2" min={1} max={12} required value={preferences.servings} onValueChange={value=>update("servings",value)}/></label>
        <p>Which nights should we plan?</p><div className="survey-choices">{days.map((d,i)=><button type="button" key={d} aria-pressed={preferences.days.includes(i)} onClick={()=>update("days",preferences.days.includes(i)?preferences.days.filter(x=>x!==i):[...preferences.days,i])}>{d}</button>)}</div>
        <label>When do you start cooking?<select value={preferences.cookingTime} onChange={e=>update("cookingTime",e.target.value)}>{Array.from({length:48},(_,i)=>{const h=Math.floor(i/2),m=i%2?"30":"00";return <option key={i} value={`${String(h).padStart(2,"0")}:${m}`}>{h%12||12}:{m} {h<12?"AM":"PM"}</option>;})}</select></label>
        <label>Time zone<select value={preferences.timezone} onChange={e=>update("timezone",e.target.value)}>{US_TIMEZONES.map(z=><option key={z.value} value={z.value}>{z.label}</option>)}</select></label></>}
      {step===2&&<><h1>Make it fit your week</h1><label>Weekly budget ($)<NumberField placeholder="e.g. 200" min={1} max={1000} step="0.01" required value={preferences.budgetCents/100} onValueChange={value=>update("budgetCents",Math.round(value*100))}/></label><p className="muted">Your whole order must fit this cap, including fees and tax.</p>
        <label>ZIP code<input inputMode="numeric" pattern="[0-9]{5}" maxLength={5} required value={preferences.zip} onChange={e=>update("zip",e.target.value)}/></label>
        <p>Save your preferences, then select Find new dinners on your dashboard when you're ready. You'll review the meals before approving an order.</p></>}
      {error&&<p role="alert">{error}</p>}
      <div className="profile-actions">{step>0&&<button type="button" className="secondary" disabled={busy} onClick={()=>setStep(step-1)}>Back</button>}<button className="primary" disabled={busy||(step===0&&!preferences.cuisines.length)||(step===1&&!preferences.days.length)}>{busy?"Saving…":step===2?"Save preferences & continue":"Continue"}</button></div>
    </form>
  </section></main>;
}
