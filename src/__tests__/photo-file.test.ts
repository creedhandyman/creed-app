import { jobPhotoPath } from "../lib/photo-file";

const HOST = "abc.supabase.co";
const pub = (p: string) => `https://${HOST}/storage/v1/object/public/receipts/${p}`;

describe("jobPhotoPath", () => {
  it("accepts job-photo folders", () => {
    expect(jobPhotoPath(pub("gallery/1731200000000_ab12.jpg"), HOST)).toBe("gallery/1731200000000_ab12.jpg");
    expect(jobPhotoPath(pub("gallery/0fd8b308-6e13-4b78-b02f-89ab175535e1/1731_x.jpg"), HOST)).toBe("gallery/0fd8b308-6e13-4b78-b02f-89ab175535e1/1731_x.jpg");
    expect(jobPhotoPath(pub("quickquote/1_a.jpg"), HOST)).toBe("quickquote/1_a.jpg");
    expect(jobPhotoPath(pub("leads/1_a.jpg"), HOST)).toBe("leads/1_a.jpg");
  });

  it("never offers logos, avatars, the card, equipment, texted-in photos or private receipts", () => {
    for (const p of ["logos/org_1.png", "avatars/u_1.jpg", "card/org_1.png", "equipment/1_a.jpg", "sms/org/SM1_0.jpg", "0fd8b308-6e13-4b78-b02f-89ab175535e1/job/1_a.jpg"]) {
      expect(jobPhotoPath(pub(p), HOST)).toBeNull();
    }
  });

  it("rejects other hosts, other buckets, and odd paths", () => {
    expect(jobPhotoPath(`https://evil.example/storage/v1/object/public/receipts/gallery/1.jpg`, HOST)).toBeNull();
    expect(jobPhotoPath(`http://${HOST}/storage/v1/object/public/receipts/gallery/1.jpg`, HOST)).toBeNull();
    expect(jobPhotoPath(`https://${HOST}/storage/v1/object/public/receipts-private/gallery/1.jpg`, HOST)).toBeNull();
    expect(jobPhotoPath(pub("gallery/../logos/org.png"), HOST)).toBeNull();
    expect(jobPhotoPath(pub("gallery/a%20b.jpg"), HOST)).toBeNull();
    expect(jobPhotoPath(pub("gallery/%25.jpg"), HOST)).toBeNull();
    expect(jobPhotoPath(pub("gallery/a*b.jpg"), HOST)).toBeNull();
    expect(jobPhotoPath("", HOST)).toBeNull();
    expect(jobPhotoPath(null, HOST)).toBeNull();
    expect(jobPhotoPath("not a url", HOST)).toBeNull();
  });
});
