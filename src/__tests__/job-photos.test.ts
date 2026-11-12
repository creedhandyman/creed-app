import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

jest.mock("@/lib/i18n", () => ({ t: (k: string) => k }));
jest.mock("@/lib/job-photo-upload", () => ({ uploadJobPhoto: jest.fn() }));
jest.mock("@/components/CameraModal", () => ({ __esModule: true, default: () => null }));

import JobPhotos from "@/components/JobPhotos";

const h = React.createElement;
const rooms = JSON.stringify({
  photos: [{ url: "https://x/a.jpg", type: "before" }, { url: "https://x/b.jpg", type: "after" }],
  workOrder: [{ done: false }],
});

describe("JobPhotos (Jobs tab)", () => {
  it("shows Work mode's Before / Work / After picker and Camera / Upload", () => {
    const html = renderToStaticMarkup(h(JobPhotos, { jobId: "j1", rooms, onView: () => {} }));
    expect(html).toContain("wv.before");
    expect(html).toContain("wv.work");
    expect(html).toContain("wv.after");
    expect(html).toContain("jobs.takePhoto");
    expect(html).toContain("common.upload");
  });
  it("tags each photo and shows the X only when removing is allowed", () => {
    const withX = renderToStaticMarkup(h(JobPhotos, { jobId: "j1", rooms, onView: () => {}, onRemove: () => {} }));
    expect((withX.match(/aria-label="jobs.removePhoto"/g) || []).length).toBe(2);
    const noX = renderToStaticMarkup(h(JobPhotos, { jobId: "j1", rooms, onView: () => {} }));
    expect(noX).not.toContain("jobs.removePhoto");
  });
  it("a finished job starts on After; mid-job keeps the default", () => {
    const done = renderToStaticMarkup(h(JobPhotos, { jobId: "j1", rooms: "{}", status: "complete", onView: () => {} }));
    // the pressed button is the After one
    expect(done).toMatch(/aria-pressed="true"[^>]*>wv\.after</);
    const fresh = renderToStaticMarkup(h(JobPhotos, { jobId: "j1", rooms: "{}", status: "accepted", onView: () => {} }));
    expect(fresh).toMatch(/aria-pressed="true"[^>]*>wv\.before</);
  });
  it("no photos yet still offers the picker (the old screen hid the section)", () => {
    const html = renderToStaticMarkup(h(JobPhotos, { jobId: "j1", rooms: "{}", onView: () => {} }));
    expect(html).toContain("jobs.photosHeading");
    expect(html).toContain("jobs.takePhoto");
  });
});
