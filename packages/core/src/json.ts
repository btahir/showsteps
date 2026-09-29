/** JSON with object keys sorted at every level, 2-space indent, trailing newline. Same value, same bytes. */
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(o).sort()) if (o[k] !== undefined) out[k] = sort(o[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(sort(value), null, 2) + "\n";
}
