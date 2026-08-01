import { describe, it, expect } from "vitest";
import { spliceLogoHeader, stripCrlf } from "./email-format";

describe("spliceLogoHeader", () => {
  it("splices the logo into a solid-gold (#a07810) header, preserving trailing style rules", () => {
    const html = "<div style='background:#a07810;padding:28px;text-align:center'><h1>Biz</h1></div>";
    const result = spliceLogoHeader(html);
    expect(result).toContain("background:#a07810;padding:28px;text-align:center;display:flex");
    expect(result).toContain('src="https://handmadedesignsbysuzi.com/HDBSLogo.jpeg"');
    expect(result).toContain("<h1>Biz</h1>");
  });

  it("splices the logo into a dark-brown (#2d2220) header", () => {
    const html = "<div style='background:#2d2220;padding:20px 28px'><h1 style='color:#d4a017'>Biz</h1></div>";
    const result = spliceLogoHeader(html);
    expect(result).toContain("background:#2d2220;padding:20px 28px;display:flex");
    expect(result).toContain("HDBSLogo.jpeg");
  });

  it("splices the logo into a gradient header", () => {
    const html = "<div style='background:linear-gradient(135deg,#a07810,#d4a017);padding:24px'><div>Biz</div></div>";
    const result = spliceLogoHeader(html);
    expect(result).toContain("linear-gradient(135deg,#a07810,#d4a017);padding:24px;display:flex");
  });

  it("wraps the original inner content in a centered div, preserving it exactly", () => {
    const html = "<div style='background:#a07810'><h1>Title</h1><p>Subtitle</p></div>";
    const result = spliceLogoHeader(html);
    expect(result).toContain('<div style="text-align:center"><h1>Title</h1><p>Subtitle</p></div>');
  });

  it("only replaces the FIRST matching header, not a footer reusing the same color", () => {
    const html = "<div style='background:#2d2220;padding:20px'><h1>Header</h1></div><p>body</p><div style='background:#2d2220;padding:16px'>Footer</div>";
    const result = spliceLogoHeader(html);
    expect(result.match(/HDBSLogo\.jpeg/g)).toHaveLength(1);
    expect(result).toContain("<div style='background:#2d2220;padding:16px'>Footer</div>");
  });

  it("falls back to a masthead bar right after <body> when no header div matches", () => {
    const html = "<html><body style=\"margin:0\"><p>Unusual template shape</p></body></html>";
    const result = spliceLogoHeader(html);
    expect(result).toContain('<body style="margin:0"><div style="text-align:center;background:#2d2220;padding:14px 0">');
    expect(result).toContain("HDBSLogo.jpeg");
    expect(result).toContain("<p>Unusual template shape</p>");
  });

  it("prepends the masthead bar when there's no <body> tag at all", () => {
    const html = "<p>No html wrapper</p>";
    const result = spliceLogoHeader(html);
    expect(result.startsWith('<div style="text-align:center;background:#2d2220;padding:14px 0">')).toBe(true);
    expect(result).toContain("<p>No html wrapper</p>");
  });

  it("handles double-quoted style attributes the same as single-quoted", () => {
    const html = '<div style="background:#a07810;padding:10px"><span>X</span></div>';
    const result = spliceLogoHeader(html);
    expect(result).toContain('background:#a07810;padding:10px;display:flex');
  });
});

describe("stripCrlf", () => {
  it("replaces CR, LF, and CRLF sequences with a single space", () => {
    expect(stripCrlf("line1\r\nline2\nline3\rline4")).toBe("line1 line2 line3 line4");
  });

  it("collapses consecutive newlines into one space, not one per character", () => {
    expect(stripCrlf("a\n\n\nb")).toBe("a b");
  });

  it("leaves a string with no CR/LF unchanged", () => {
    expect(stripCrlf("plain text")).toBe("plain text");
  });

  it("prevents header injection via an embedded fake header line", () => {
    const malicious = "Real Subject\r\nBcc: attacker@evil.com";
    expect(stripCrlf(malicious)).not.toContain("\r\n");
    expect(stripCrlf(malicious)).toBe("Real Subject Bcc: attacker@evil.com");
  });
});
