"use client";
import { useState } from "react";
import { Utensils } from "lucide-react";

export function RecipeImage({ src, className = "", loading }: {
  src?: string;
  className?: string;
  loading?: "eager" | "lazy";
}) {
  const [failedSource, setFailedSource] = useState<string>();
  const usable = !!src && /^https:\/\//i.test(src) && failedSource !== src;
  if (!usable) return (
    <span className={`recipe-photo-fallback ${className}`} role="img" aria-label="Recipe photo unavailable">
      <Utensils aria-hidden="true" size={32} strokeWidth={1.2} />
    </span>
  );
  // The surrounding card/modal supplies the recipe name. Empty alt prevents a
  // broken remote photo from rendering its description over the card.
  return <img src={src} alt="" className={className} loading={loading}
    onError={() => setFailedSource(src)} />;
}
