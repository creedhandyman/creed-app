import { formParams, twilioSignature, validTwilioSignature } from "../lib/twilio-signature";

const url = "https://www.creedhm.com/api/sms/inbound";
const params = { From: "+13165550142", To: "+13165550000", Body: "STOP", MessageSid: "SM123" };

describe("twilio signature", () => {
  it("accepts a correctly signed request", () => {
    const sig = twilioSignature("secret-token", url, params);
    expect(validTwilioSignature("secret-token", sig, url, params)).toBe(true);
  });

  it("doesn't depend on field order", () => {
    const sig = twilioSignature("secret-token", url, params);
    const reordered = { MessageSid: "SM123", Body: "STOP", To: "+13165550000", From: "+13165550142" };
    expect(validTwilioSignature("secret-token", sig, url, reordered)).toBe(true);
  });

  it("rejects tampering, a wrong token, a wrong URL or no signature", () => {
    const sig = twilioSignature("secret-token", url, params);
    expect(validTwilioSignature("secret-token", sig, url, { ...params, Body: "START" })).toBe(false);
    expect(validTwilioSignature("other-token", sig, url, params)).toBe(false);
    expect(validTwilioSignature("secret-token", sig, "https://evil.example/api/sms/inbound", params)).toBe(false);
    expect(validTwilioSignature("secret-token", null, url, params)).toBe(false);
    expect(validTwilioSignature(undefined, sig, url, params)).toBe(false);
  });

  it("parses Twilio's form body", () => {
    expect(formParams("From=%2B13165550142&Body=Running+late%3F")).toEqual({ From: "+13165550142", Body: "Running late?" });
  });
});
