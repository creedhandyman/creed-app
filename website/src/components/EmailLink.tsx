"use client";

import { useEffect, useState } from "react";
import { SITE } from "@/lib/site";

/** Mail link that never appears in the page HTML as a plain address (spam
 *  scrapers read raw HTML); it's assembled in the browser after load. */
export default function EmailLink({
  label,
  className,
  style,
}: {
  label?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [user, domain] = SITE.email.split("@");
  const [addr, setAddr] = useState<string | null>(null);
  useEffect(() => setAddr(`${user}@${domain}`), [user, domain]);
  const text = label ?? (addr || `${user} [at] ${domain}`);
  return (
    <a href={addr ? `mailto:${addr}` : undefined} className={className} style={style}>
      {text}
    </a>
  );
}
