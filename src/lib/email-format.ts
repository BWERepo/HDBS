// Ports mailer.php's _emailLogoHeader() and _noCrlf() — the two pieces of every outbound email
// in this codebase, applied unconditionally by sendEmail() regardless of which template called
// it. That's why they live here rather than in any one template file, and why email-sender.ts
// applies them centrally rather than leaving it to each caller.

const LOGO_IMG =
  '<img src="https://handmadedesignsbysuzi.com/HDBSLogo.jpeg" alt="" style="height:50px;width:auto;flex-shrink:0;border:0">';

// Matches the first header div using one of the three background colors/gradients every
// template's colored masthead uses. Quote-char backreference (\1) lets it handle both '...' and
// "..." attribute quoting without two separate patterns.
const HEADER_PATTERN =
  /<div\s+style=(['"])((?:(?!\1).)*?background\s*:\s*(?:#a07810|#2d2220|linear-gradient\(\s*135deg\s*,\s*#a07810\s*,\s*#d4a017\s*\))(?:(?!\1).)*)\1([^>]*)>([\s\S]*?)<\/div>/i;

/**
 * Splices the brand logo into a template's own colored header block, turning it into a flex row
 * so the logo sits beside the title/subtitle rather than in a separate masthead bar. Falls back
 * to a plain masthead bar above the body if no matching header is found (an unexpected template
 * shape), so the logo still appears somewhere rather than silently vanishing.
 */
export function spliceLogoHeader(html: string): string {
  const match = HEADER_PATTERN.exec(html);
  if (match) {
    const [full, quote, style, attrsRest, inner] = match as unknown as [string, string, string, string, string];
    const newStyle = `${style.replace(/[; ]+$/, "")};display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap`;
    const replacement = `<div style=${quote}${newStyle}${quote}${attrsRest}>${LOGO_IMG}<div style="text-align:center">${inner}</div></div>`;
    return html.slice(0, match.index) + replacement + html.slice(match.index + full.length);
  }

  const fallback = `<div style="text-align:center;background:#2d2220;padding:14px 0">${LOGO_IMG}</div>`;
  const bodyMatch = /<body[^>]*>/i.exec(html);
  if (bodyMatch) {
    const insertAt = bodyMatch.index + bodyMatch[0].length;
    return html.slice(0, insertAt) + fallback + html.slice(insertAt);
  }
  return fallback + html;
}

/** Strips CR/LF so a value can't inject extra SMTP/email headers. Every header-line value
 *  (subject, from name/email, recipients) is user- or order-data-derived somewhere upstream, so
 *  this is applied unconditionally, matching mailer.php's _noCrlf(). */
export function stripCrlf(s: string): string {
  return s.replace(/[\r\n]+/g, " ");
}
