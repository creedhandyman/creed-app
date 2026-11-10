import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

jest.mock("@/lib/back-layer", () => ({ useBackLayer: jest.fn() }));
jest.mock("@/lib/i18n", () => ({ t: (k: string) => k }));

import SettingsCategories from "@/components/SettingsCategories";

const h = React.createElement;

describe("SettingsCategories (the short settings list)", () => {
  const categories = [
    { id: "profile", icon: "worker", title: "Your Profile", sub: "Name and rate", content: h("div", null, "PROFILE-SETTINGS") },
    { id: "notif", icon: "bell", title: "Notifications", sub: "Texts and push", badge: "On", content: h("div", null, "NOTIF-SETTINGS") },
  ];

  it("shows one row per category with its one-line summary, and none of the settings themselves", () => {
    const html = renderToStaticMarkup(h(SettingsCategories, { categories }));
    expect(html).toContain("Your Profile");
    expect(html).toContain("Name and rate");
    expect(html).toContain("Notifications");
    expect(html).toContain("Texts and push");
    expect(html).toContain(">On<"); // the status badge
    expect(html).not.toContain("PROFILE-SETTINGS");
    expect(html).not.toContain("NOTIF-SETTINGS");
    expect((html.match(/<button/g) || []).length).toBe(2); // two tappable rows
  });

  it("puts the footer (sign out, support…) under the list", () => {
    const html = renderToStaticMarkup(h(SettingsCategories, { categories, footer: h("button", null, "SIGN-OUT") }));
    expect(html.indexOf("SIGN-OUT")).toBeGreaterThan(html.indexOf("Notifications"));
  });

  it("an empty list renders without crashing (e.g. a role with no categories)", () => {
    expect(() => renderToStaticMarkup(h(SettingsCategories, { categories: [] }))).not.toThrow();
  });
});
