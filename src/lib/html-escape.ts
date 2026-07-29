// Ported verbatim from BusinessWebExpress/src/lib/html-escape.ts, where it exists because five
// byte-identical private copies had drifted across five files and a sixth escaped only three of
// the five characters. Keep it as the single escaper here too.
//
// Escapes the five characters that matter in both element text and quoted attribute values, so a
// caller doesn't have to know which context it's building. Entities render back as the original
// character, so escaping text that turns out not to have needed it is never visible to the reader.
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
