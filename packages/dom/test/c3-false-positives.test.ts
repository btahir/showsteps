// ACCEPTANCE C3: the classic false positives of naive keyword matching must not be flagged, however the
// text reaches the field (label, aria-label, placeholder). Written by the verifier.
import { expect, test } from "vitest";
import { isSensitive } from "../src";
import { $, mount } from "./helpers";

const NOT_SENSITIVE = ["Passenger name", "Compass heading", "Bypass route", "Address line 1", "Tokenizer settings", "username", "search", "email", "phone", "Passport country", "Social media handle", "Description"];
const SENSITIVE = ["Password", "Card number", "CVV", "API key", "Security code", "One-time code", "Social Security number"];

for (const text of NOT_SENSITIVE) {
  test(`not sensitive: "${text}" as label, aria-label and placeholder`, () => {
    for (const html of [`<label for=t>${text}</label><input id=t>`, `<input id=t aria-label="${text}">`, `<input id=t placeholder="${text}">`]) {
      mount(html);
      expect(isSensitive($("#t"), { labelText: document.querySelector("label")?.textContent ?? undefined }), html).toBe(false);
    }
  });
}
for (const text of SENSITIVE) {
  test(`sensitive: "${text}" as label, aria-label and placeholder`, () => {
    for (const html of [`<label for=t>${text}</label><input id=t>`, `<input id=t aria-label="${text}">`, `<input id=t placeholder="${text}">`]) {
      mount(html);
      expect(isSensitive($("#t"), { labelText: document.querySelector("label")?.textContent ?? undefined }), html).toBe(true);
    }
  });
}

// A passport country or nationality field is not a secret; a passport number is.
test("name and id: passport country, issuing country and nationality fields are not sensitive; passport number still is", () => {
  for (const html of [
    `<select name="passport_country"><option>Canada</option></select>`,
    `<select id="passportCountry"><option>Canada</option></select>`,
    `<select name="passport-issuing-country"><option>Canada</option></select>`,
    `<input name="passport_nationality">`,
  ]) {
    mount(html);
    expect(isSensitive(document.querySelector("select,input")!), html).toBe(false);
  }
  for (const html of [`<input name="passport">`, `<input name="passport_number">`, `<input id="passportNo">`, `<input name="passport_scan_id">`]) {
    mount(html);
    expect(isSensitive(document.querySelector("input")!), html).toBe(true);
  }
});
