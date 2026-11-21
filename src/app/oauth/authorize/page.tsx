import type { Metadata } from "next";
import Consent from "./Consent";

export const metadata: Metadata = {
  title: "Connect to Creed · Creed Handy Manager",
  robots: { index: false, follow: false },
};

/** "Sign in with Creed": the OAuth consent screen for AI apps (MCP). */
export default function AuthorizePage() {
  return <Consent />;
}
