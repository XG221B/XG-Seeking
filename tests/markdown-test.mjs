import assert from "node:assert/strict";
import { renderMd } from "../src/markdown.js";

assert.equal(renderMd("hello"), "<p>hello</p>\n");
assert.equal(renderMd("**bold**"), "<p><strong>bold</strong></p>\n");
assert.equal(
  renderMd("[x](https://example.com)"),
  '<p><a href="https://example.com" target="_blank" rel="noreferrer">x</a></p>\n',
);

const structured = renderMd("# Heading\n\n- one\n- two\n\n`**literal**`");
assert.match(structured, /^<h1>Heading<\/h1>\n<ul>\n<li>one<\/li>\n<li>two<\/li>\n<\/ul>\n<p><code>\*\*literal\*\*<\/code><\/p>\n$/);

const rawHtml = renderMd('<img src=x onerror="alert(1)">\n\n<script>alert(1)</script>');
assert.ok(!rawHtml.includes("<img"));
assert.ok(!rawHtml.includes("<script>"));
assert.ok(rawHtml.includes("&lt;img"));

const unsafeLink = renderMd("[unsafe](javascript:alert(1))");
assert.ok(!unsafeLink.includes('href="javascript:'));

console.log("Markdown tests passed.");
