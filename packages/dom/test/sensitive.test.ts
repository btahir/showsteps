import { describe, expect, test } from "vitest";
import { describeElement, isSensitive } from "../src";
import { $, mount } from "./helpers";

const yes: [string, string][] = [
  ["password input", `<input id=t type=password>`],
  ["password, upper-case type", `<input id=t type=PASSWORD>`],
  ["autocomplete cc-number", `<input id=t autocomplete="cc-number">`],
  ["autocomplete cc-csc", `<input id=t autocomplete="cc-csc">`],
  ["autocomplete cc-exp with section prefix", `<input id=t autocomplete="section-pay cc-exp">`],
  ["autocomplete one-time-code", `<input id=t autocomplete="one-time-code">`],
  ["autocomplete new-password", `<input id=t type=text autocomplete="new-password">`],
  ["autocomplete current-password", `<input id=t type=text autocomplete="current-password">`],
  ["name ssn", `<input id=t name="ssn">`],
  ["name card_number", `<input id=t name="card_number">`],
  ["name cardNumber camelCase", `<input id=t name="cardNumber">`],
  ["name credit-card", `<input id=t name="credit-card">`],
  ["name cvv", `<input id=t name="cvv">`],
  ["name iban", `<input id=t name="iban">`],
  ["name otp", `<input id=t name="otp">`],
  ["name pin", `<input id=t name="pin">`],
  ["name pinCode", `<input id=t name="pinCode">`],
  ["name secret", `<input id=t name="client_secret">`],
  ["name api_key", `<input id=t name="api_key">`],
  ["name access-token", `<input id=t name="access-token">`],
  ["textarea named token", `<textarea id=t name="token"></textarea>`],
  ["contenteditable marked by attribute", `<div id=t contenteditable data-showsteps-sensitive>hi</div>`],
  ["data-showsteps-sensitive on button", `<button id=t data-showsteps-sensitive>Reveal</button>`],
  ["data-showsteps-sensitive=true", `<input id=t data-showsteps-sensitive="true">`],
  ["marked ancestor", `<div data-showsteps-sensitive><span id=t>4242</span></div>`],
  ["label mentions card number", `<label for=t>Card number</label><input id=t>`],
  ["placeholder mentions security code", `<input id=t placeholder="Security code">`],
  ["aria-label one-time code", `<input id=t aria-label="One-time code">`],
  ["aria-label social security", `<input id=t aria-label="Social Security number">`],
];

yes.push(
  ["legacy data-stepsnap-sensitive marker", `<div id=t data-stepsnap-sensitive>x</div>`],
  ["name cc-number pair", `<input id=t name="cc_number">`],
  ["name card-cvc pair", `<input id=t name="card-cvc">`],
  ["name account_number", `<input id=t name="account_number">`],
  ["name sortCode", `<input id=t name="sortCode">`],
  ["name tax_id", `<input id=t name="tax_id">`],
  ["name passphrase", `<input id=t name="passphrase">`],
  ["name passcode", `<input id=t name="passcode">`],
  ["data-testid card-number", `<input id=t data-testid="card-number">`],
  ["aria-label recovery code", `<input id=t aria-label="Recovery code">`],
  ["placeholder verification code", `<input id=t placeholder="6-digit verification code">`],
  ["combobox role field named token", `<div id=t role="combobox" aria-label="API key"></div>`],
  ["Stripe iframe by src", `<iframe id=t src="https://js.stripe.com/v3/elements-inner-card.html"></iframe>`],
  ["iframe titled secure card number", `<iframe id=t title="Secure card number input frame"></iframe>`],
  ["iframe named cvv", `<iframe id=t name="cvv-frame"></iframe>`],
);

const no: [string, string][] = [
  ["plain text input", `<input id=t type=text name="email">`],
  ["shipping does not contain token pin", `<input id=t name="shipping_address">`],
  ["spinner class-like name", `<input id=t name="spinner">`],
  ["cc recipients field", `<input id=t name="cc">`],
  ["cardholder name", `<input id=t name="cardholder">`],
  ["pinned checkbox", `<input id=t type=checkbox name="pinned">`],
  ["hidden csrf token is not a field", `<input id=t type=hidden name="csrf_token">`],
  ["div named ssn is not a form field", `<div id=t name="ssn">x</div>`],
  ["plain iframe", `<iframe id=t src="/frame.html" title="Confirmation frame"></iframe>`],
  ["cc as label is not enough", `<input id=t name="cc_recipients">`],
  ["one-time offer text field", `<input id=t name="one_liner">`],
  ["search input", `<input id=t type=search name="q">`],
  ["autocomplete email", `<input id=t autocomplete="email">`],
  ["explicit false overrides password", `<input id=t type=password data-showsteps-sensitive="false">`],
  ["explicit false overrides name", `<input id=t name="pin" data-showsteps-sensitive="false">`],
  ["nearest marker wins (false inside true)", `<div data-showsteps-sensitive><input id=t data-showsteps-sensitive="false" name="x"></div>`],
];

describe("isSensitive", () => {
  for (const [name, html] of yes) test(`sensitive: ${name}`, () => {
    mount(html);
    expect(isSensitive($("#t"), { labelText: document.querySelector("label")?.textContent ?? undefined })).toBe(true);
  });
  for (const [name, html] of no) test(`not sensitive: ${name}`, () => {
    mount(html);
    expect(isSensitive($("#t"))).toBe(false);
  });

  test("marker on the embedding iframe covers content inside it", () => {
    mount(`<input id=t name="email">`);
    const parentDoc = document.implementation.createHTMLDocument("p");
    const frame = parentDoc.createElement("iframe");
    frame.setAttribute("data-showsteps-sensitive", "");
    parentDoc.body.appendChild(frame);
    Object.defineProperty(window, "frameElement", { value: frame, configurable: true });
    try {
      expect(isSensitive($("#t"))).toBe(true);
    } finally {
      delete (window as unknown as Record<string, unknown>).frameElement;
    }
  });

  test("marker on a shadow host covers content inside its shadow root", () => {
    mount(`<acme-vault id=h data-showsteps-sensitive></acme-vault>`);
    const sr = $("#h").attachShadow({ mode: "open" });
    sr.innerHTML = `<span id=s>4242</span>`;
    expect(isSensitive(sr.getElementById("s")!)).toBe(true);
  });

  test("password inside shadow root is sensitive and carries the chain", () => {
    mount(`<acme-login id=h></acme-login>`);
    const sr = $("#h").attachShadow({ mode: "open" });
    sr.innerHTML = `<input id=p type=password>`;
    const d = describeElement(sr.getElementById("p")!);
    expect(d.sensitive).toBe(true);
    expect(d.shadow).toEqual(["acme-login"]);
  });

  test("sensitive by id alone", () => {
    mount(`<input id="card-cvc">`);
    expect(isSensitive($("#card-cvc"))).toBe(true);
  });

  test("describeElement sets sensitive and omits text for sensitive elements", () => {
    mount(`<div id=t data-showsteps-sensitive>Card 4242 4242</div>`);
    const d = describeElement($("#t"));
    expect(d.sensitive).toBe(true);
    expect(d.text).toBeUndefined();
  });

  test("describeElement omits sensitive when false", () => {
    mount(`<input id=t name=email>`);
    expect(describeElement($("#t"))).not.toHaveProperty("sensitive");
  });

  test("describeElement uses the associated label for detection", () => {
    mount(`<label for=t>Card number</label><input id=t>`);
    expect(describeElement($("#t")).sensitive).toBe(true);
  });
});
