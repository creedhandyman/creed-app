import Link from "next/link";
import { SERVICE_INDEX } from "@/lib/site";

/** "Handyman services in {city}, KS" — every service people search for,
 *  grouped and linked to the page that covers it. */
export default function ServiceIndex({ city = "Wichita" }: { city?: string }) {
  return (
    <div className="sx">
      <h2 className="h2 sx-h">Handyman services in {city}, KS</h2>
      <p className="sub">
        Home repair, small repairs, and full rental turnovers. Everything below is
        work we do around {city} every week.
      </p>
      <div className="sx-grid">
        {SERVICE_INDEX.map((g) => (
          <div className="sx-group" key={g.slug}>
            <Link href={`/services/${g.slug}`} className="sx-label">{g.label} →</Link>
            <ul>
              {g.items.map((it) => (
                <li key={it}>
                  {it.startsWith("Handyman for property managers") ? (
                    <Link href="/property-managers">{it}</Link>
                  ) : (
                    <Link href={`/services/${g.slug}`}>{it}</Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
