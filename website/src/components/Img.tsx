"use client";

import { useState } from "react";

/**
 * Plain <img> that degrades to a labeled placeholder block when the asset
 * is missing (site.ts promises this so photo paths can be swapped freely).
 * Pass sizing via `style` (aspectRatio + width) so the fallback holds the
 * same footprint as the photo it replaces.
 */
export default function Img({
  fallbackLabel = "Photo coming soon",
  style,
  alt,
  ...rest
}: React.ImgHTMLAttributes<HTMLImageElement> & { fallbackLabel?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div
        role="img"
        aria-label={alt}
        style={{
          ...style,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--panel)",
          color: "var(--dim)",
          fontFamily: "var(--font-head)",
          fontSize: 12.5,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          textAlign: "center",
          padding: 12,
        }}
      >
        {fallbackLabel}
      </div>
    );
  }
  return <img alt={alt} style={style} {...rest} onError={() => setFailed(true)} />;
}
