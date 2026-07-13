import MarkdownIt from "markdown-it";
import { escapeHtml } from "./helpers.js";

const ALLOWED_TAGS = new Set([
  "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "br", "strong", "em", "code", "pre",
  "blockquote", "ul", "ol", "li", "a", "hr",
]);

const ALLOWED_ATTRS = new Set(["href", "target", "rel"]);

const BLOCKED_URL_PREFIXES = ["javascript:", "data:", "vbscript:"];

export const isSafeMarkdownUrl = (url) => {
  const trimmed = String(url || "").trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  for (const prefix of BLOCKED_URL_PREFIXES) {
    if (lower.startsWith(prefix)) return false;
  }
  return /^(https?:\/\/|mailto:|#|\/(?!\/))/i.test(trimmed);
};

const md = new MarkdownIt({ html: false, breaks: false, linkify: false, typographer: false });

const defaultLinkOpen = md.renderer.rules.link_open;
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const hrefIndex = token.attrIndex("href");
  if (hrefIndex >= 0) {
    const href = token.attrs[hrefIndex][1];
    if (!isSafeMarkdownUrl(href)) {
      token.attrs[hrefIndex][1] = "#blocked";
      token.attrs.push(["rel", "noreferrer"]);
    } else {
      token.attrs.push(["target", "_blank"]);
      token.attrs.push(["rel", "noreferrer"]);
    }
  }
  if (defaultLinkOpen) return defaultLinkOpen(tokens, idx, options, env, self);
  return self.renderToken(tokens, idx, options);
};

function sanitizeHtml(html) {
  return html.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)(\s[^>]*)?\/?>/g, (match, tag) => {
    const lower = tag.toLowerCase();
    if (!ALLOWED_TAGS.has(lower)) return escapeHtml(match);

    const fullMatch = match;
    const attrStr = fullMatch.slice(tag.length + 1, fullMatch.endsWith("/>") ? -2 : -1).trim();
    if (!attrStr) return fullMatch;

    let cleanedAttrs = "";
    const attrRegex = /([a-zA-Z][a-zA-Z0-9-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(attrStr)) !== null) {
      const attrName = attrMatch[1].toLowerCase();
      if (ALLOWED_ATTRS.has(attrName)) {
        const attrVal = attrMatch[2] || attrMatch[3] || attrMatch[4] || "";
        cleanedAttrs += ` ${attrMatch[1]}="${escapeHtml(attrVal)}"`;
      }
    }
    return `<${tag}${cleanedAttrs}>`;
  });
}

export function renderMd(text) {
  if (!text) return "";
  const html = md.render(String(text));
  return sanitizeHtml(html);
}

export function bodyToPreviewHtml(value) {
  return renderMd(value);
}
