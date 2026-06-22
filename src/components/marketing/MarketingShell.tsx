"use client";
import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { Icon } from "@/components/Icon";

/** Single swappable product name (wordmark + titles + footer). */
export const PRODUCT_NAME = "Creed Handy Manager";

function Brand({ small }: { small?: boolean }) {
  return (
    <span className="brand" style={small ? { fontSize: 15 } : undefined}>
      <span className="blogo" style={small ? { width: 28, height: 28, fontSize: 14 } : undefined}>C</span>
      Creed&nbsp;<b>Handy&nbsp;Manager</b>
    </span>
  );
}

/**
 * Sticky blurred nav + footer that wrap every marketing page. The whole tree
 * is scoped under `.mkt` (see app/marketing.css) so the dark-only marketing
 * styles can't leak into the authed app.
 */
export default function MarketingShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const on = (p: string) => path === p;
  // Signed-in visitors never see the marketing site — bounce them into the
  // app. Also doubles as the post-login redirect from /signin (once login
  // sets the store user, this fires and routes to "/" → the app gate).
  const user = useStore((s) => s.user);
  const router = useRouter();
  useEffect(() => {
    if (user) router.replace("/");
  }, [user, router]);
  return (
    <div className="mkt">
      <nav>
        <div className="wrap nav">
          <Link href="/" aria-label="Creed Handy Manager home"><Brand /></Link>
          <div className="nlinks">
            <Link className={`navlink hide${on("/features") ? " on" : ""}`} href="/features">Features</Link>
            <Link className={`navlink hide${on("/pricing") ? " on" : ""}`} href="/pricing">Pricing</Link>
            <Link className="navlink hide" href="/signin">Sign in</Link>
            <Link className="btn btn-glow" href="/signin?mode=signup"><Icon name="rocket" size={18} /> Get Started</Link>
          </div>
        </div>
      </nav>

      {children}

      <footer>
        <div className="wrap footrow">
          <Brand small />
          <div className="flinks">
            <Link href="/features">Features</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/signin">Sign in</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/contact">Contact</Link>
          </div>
          <div>© 2026 Creed Handyman LLC</div>
        </div>
      </footer>
    </div>
  );
}
