/**
 * Site-wide constants. This file is the only place in the repo where a Stripe URL may appear (RULES §5).
 * Every "Support" link on the site points at our own /support/ page, which reads DONATION_LINKS from here.
 * The extension uses SUPPORT_URL = `${SITE_URL}/support/`.
 */
export const SITE_URL = "https://showsteps.vercel.app";
export const SITE_NAME = "Showsteps";
export const SUPPORT_URL = "/support/";

/** Placeholder until the repo exists. The owner creates it and adds the remote. */
export const GITHUB_URL = "https://github.com/btahir/showsteps";
/** Placeholder: empty until the extension is published. Empty shows "coming soon" instead of a dead link. */
export const CHROME_STORE_URL = "";

export const APP_VERSION = "0.1.0";
export const LICENSE_NAME = "MIT";
export const SITE_TAGLINE = "Click through it once. Get the guide, and a script your agent can replay.";
export const SITE_DESCRIPTION =
  "Free Chrome extension that turns a click-through into a step-by-step guide with screenshots. Nothing uploaded. Exports PDF, HTML, Markdown, DOCX, agent skill.";

export const DONATION_LINKS = {
  once: "https://buy.stripe.com/fZu14m0FO3v050PfqP3ks00",
  monthly: [
    { label: "$5", note: "Supporter", href: "https://buy.stripe.com/9B68wOewEaXsgJxdiH3ks01" },
    { label: "$15", note: "Backer", href: "https://buy.stripe.com/7sYbJ088g3v0gJx4Mb3ks02" },
    { label: "$50", note: "Sponsor", href: "https://buy.stripe.com/28EeVc88g5D80Kz2E33ks03" },
    { label: "$100", note: "Company sponsor", href: "https://buy.stripe.com/00w14m6088PkbpdceD3ks04" },
  ],
} as const;

/** Absolute URL for a site path such as "/support/". */
export const abs = (path: string): string => new URL(path, SITE_URL).toString();

/** Replaces %GITHUB% tokens in content strings. */
export const fill = (s: string): string => s.replaceAll("%GITHUB%", GITHUB_URL);
