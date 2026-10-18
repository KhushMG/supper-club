"use client";
import { useState } from "react";
import { Utensils } from "lucide-react";

export function RecipeImage({ src, className = "", loading }: {
  src?: string;
  className?: string;
  loading?: "eager" | "lazy";
}) {
  const [failedSource, setFailedSource] = useState<string>();
  const [loadedSource, setLoadedSource] = useState<string>();
  const usable = !!src && /^https:\/\//i.test(src) && failedSource !== src;
  const loaded = usable && loadedSource === src;
  return (
    <span className={`recipe-photo ${className}`}>
      {!loaded && <span className="recipe-photo-fallback" aria-hidden="true">
        <Utensils size={32} strokeWidth={1.2} />
      </span>}
      {usable && <img src={src} alt="" loading={loading}
        style={{ opacity: loaded ? 1 : 0 }}
        onLoad={(event) => {
          if (event.currentTarget.naturalWidth > 0) setLoadedSource(src);
          else setFailedSource(src);
        }}
        onError={() => setFailedSource(src)} />}
    </span>
  );
}
