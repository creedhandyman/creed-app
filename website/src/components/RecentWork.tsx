import { RECENT } from "@/lib/site";

/** "Recent work" photo reel. Desktop: drifts slowly and pauses on hover
 *  (the list is rendered twice so the loop is seamless). Touch screens and
 *  reduced-motion visitors get a plain swipeable row instead. */
export default function RecentWork() {
  const tile = (r: (typeof RECENT)[number], hidden: boolean) => (
    <figure className="rw-tile" key={(hidden ? "dup-" : "") + r.src} aria-hidden={hidden || undefined}>
      <img src={r.src} alt={hidden ? "" : `${r.caption} — recent Creed Handyman job in Wichita`} loading="lazy" />
      <figcaption>{r.caption}</figcaption>
    </figure>
  );
  return (
    <div className="rw">
      <div className="rw-track">
        {RECENT.map((r) => tile(r, false))}
        {RECENT.map((r) => tile(r, true))}
      </div>
    </div>
  );
}
