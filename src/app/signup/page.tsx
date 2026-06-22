import { redirect } from "next/navigation";

/**
 * The standalone /signup funnel is superseded by the marketing site's
 * sign-in route (/signin?mode=signup → re-skinned Login → store.signup →
 * the gate routes to onboarding). Redirect so any old links or bookmarks
 * don't 404 and there's a single signup path.
 */
export default function SignupRedirect() {
  redirect("/signin?mode=signup");
}
