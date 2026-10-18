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
    // Keep an empty editing state and decimal fractions, but never carry an
    // existing zero into the next whole number (e.g. 0 + 200 becomes 200).
    const text = event.target.value.replace(/^(-?)0+(?=\d)/, "$1");
    setDraft(text);
    const next=text===""?(props.required?NaN:0):Number(text);
    lastValue.current=next;
    onValueChange(next);
  }}/>;
}
