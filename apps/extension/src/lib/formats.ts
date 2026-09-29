// Export formats offered in the UI (kept apart from the exporters so pages load them lazily).
import { PROJECT_EXT } from "../config";

export type ExportFormat = "markdown" | "html" | "pdf" | "docx" | "skill" | "project";

export const FORMATS: { id: ExportFormat; label: string; hint: string; ext: string }[] = [
  { id: "pdf", label: "PDF", hint: "Print-ready document", ext: ".pdf" },
  { id: "html", label: "HTML", hint: "One self-contained page", ext: ".html" },
  { id: "markdown", label: "Markdown", hint: "guide.md + images, zipped", ext: ".zip" },
  { id: "docx", label: "Word", hint: "Editable .docx", ext: ".docx" },
  { id: "skill", label: "Agent skill", hint: "SKILL.md, steps.json, replay.spec.ts", ext: ".zip" },
  { id: "project", label: "Showsteps project", hint: "Re-open later or hand to an agent", ext: PROJECT_EXT },
];
