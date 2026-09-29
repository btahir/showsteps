// Timestamps with the local UTC offset ("2026-09-28T22:42:00.000-07:00") instead of UTC "Z", so
// every export shows the date the person recorded on (a late-evening recording in California is
// not "29 September"). Still ISO 8601, still sortable per guide, accepted by validateGuide.
export function localIso(d: Date = new Date()): string {
  const pad = (n: number, w = 2) => String(Math.trunc(Math.abs(n))).padStart(w, "0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}` +
    `${sign}${pad(off / 60)}:${pad(off % 60)}`
  );
}
