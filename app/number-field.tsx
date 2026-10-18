"use client";
import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: number;
  onValueChange: (value: number) => void;
};
export function NumberField({value,onValueChange,...props}:Props) {
  const [draft,setDraft]=useState(Number.isFinite(value)?String(value):"");
  const lastValue=useRef(value);
  const input=useRef<HTMLInputElement>(null);
  const decimal=props.step !== undefined && props.step !== 1 && props.step !== "1";
  useEffect(()=>{
    const n=Number(draft);
    const message = draft && props.min !== undefined && n < Number(props.min) ? `Enter at least ${props.min}.`
      : draft && props.max !== undefined && n > Number(props.max) ? `Enter no more than ${props.max}.` : "";
    input.current?.setCustomValidity(message);
  },[draft,props.min,props.max]);
  useEffect(()=>{
    if(!Object.is(lastValue.current,value)) setDraft(Number.isFinite(value)?String(value):"");
    lastValue.current=value;
  },[value]);
  return <input {...props} ref={input} type="text" inputMode={decimal?"decimal":"numeric"} pattern={decimal?"[0-9]+([.][0-9]{1,2})?":"[0-9]+"} value={draft} onChange={event=>{
    // Keep an empty editing state and decimal fractions, but never carry an
    // existing zero into the next whole number (e.g. 0 + 200 becomes 200).
    const text = event.target.value.replace(/^(-?)0+(?=\d)/, "$1");
    setDraft(text);
    const next=text===""?(props.required?NaN:0):Number(text);
    lastValue.current=next;
    onValueChange(next);
  }}/>;
}
