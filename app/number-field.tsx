"use client";
import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: number;
  onValueChange: (value: number) => void;
};
export function NumberField({value,onValueChange,...props}:Props) {
  const [draft,setDraft]=useState(Number.isFinite(value)?String(value):"");
  const lastValue=useRef(value);
  useEffect(()=>{
    if(!Object.is(lastValue.current,value)) setDraft(Number.isFinite(value)?String(value):"");
    lastValue.current=value;
  },[value]);
  return <input {...props} type="number" value={draft} onChange={event=>{
    setDraft(event.target.value);
    const next=event.target.value===""?(props.required?NaN:0):Number(event.target.value);
    lastValue.current=next;
    onValueChange(next);
  }}/>;
}
