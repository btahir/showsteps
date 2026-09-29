import { SITE_NAME, SITE_URL, SITE_DESCRIPTION, GITHUB_URL, APP_VERSION, abs } from "../config/site";

export const softwareApplication = () => ({
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: SITE_NAME,
  applicationCategory: "BusinessApplication",
  applicationSubCategory: "Documentation tool",
  operatingSystem: "Chrome (Windows, macOS, Linux)",
  softwareVersion: APP_VERSION,
  description: SITE_DESCRIPTION,
  url: SITE_URL,
  license: `${GITHUB_URL}/blob/main/LICENSE`,
  isAccessibleForFree: true,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  featureList: [
    "Records clicks, typing, selections and page changes in Chrome",
    "Screenshot per step with the click target highlighted",
    "Automatic blur of password and card fields",
    "Export to PDF, HTML, Markdown, DOCX",
    "Agent skill export: SKILL.md, steps.json, Playwright replay.spec.ts",
    "Stores everything locally; no account, no upload",
  ],
  softwareHelp: abs("/docs/agents/"),
});

export const faqPage = (items: { q: string; a: string }[]) => ({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: items.map((f) => ({
    "@type": "Question",
    name: f.q.replace(/<[^>]+>/g, ""),
    acceptedAnswer: { "@type": "Answer", text: f.a.replace(/<[^>]+>/g, "").replace(/&ldquo;|&rdquo;/g, '"').replace(/&rsquo;/g, "'") },
  })),
});

export const breadcrumbs = (trail: { name: string; path: string }[]) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: trail.map((t, i) => ({
    "@type": "ListItem",
    position: i + 1,
    name: t.name,
    item: abs(t.path),
  })),
});

export const article = (o: { headline: string; description: string; path: string; dateModified: string }) => ({
  "@context": "https://schema.org",
  "@type": "TechArticle",
  headline: o.headline,
  description: o.description,
  url: abs(o.path),
  dateModified: o.dateModified,
  author: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
});
