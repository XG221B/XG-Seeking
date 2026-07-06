with open('src/main.js','r',encoding='utf-8') as f:
    js = f.read()

# 1. Add sourceMode to state
idx = js.index('  previewMode: false,')
end = js.index('\n};', idx)
old = js[idx:end+4]
new = old.replace('previewMode: false,', 'sourceMode: true,\n  previewMode: false,')
js = js[:idx] + new + js[end+4:]

# 2. Replace A+/A- buttons with dropdown in toolbar HTML
old_btns = '<button class="toolbar-btn" id="fontDown" title="${t("fontSizeDown")}">A-</button>\n      <button class="toolbar-btn" id="fontUp" title="${t("fontSizeUp")}">A+</button>'
new_btns = '<select class="toolbar-select" id="fontSize" title="${t("fontSizeUp")}">\n        <option value="10">10px</option>\n        <option value="12" selected>12px</option>\n        <option value="14">14px</option>\n        <option value="16">16px</option>\n        <option value="18">18px</option>\n        <option value="20">20px</option>\n        <option value="24">24px</option>\n        <option value="28">28px</option>\n        <option value="32">32px</option>\n      </select>'
js = js.replace(old_btns, new_btns)

# 3. Replace the font toolbar handler
old_h_start = js.index('// Font size/color toolbar — discrete sizes')
old_h_end = js.index('\n  }\n', old_h_start + 500) + 5

new_h = """// Font size/color toolbar — dropdown + color picker
  const fontSize = document.getElementById("fontSize");
  const fontColor = document.getElementById("fontColor");
  if (fontSize && fontColor) {
    fontSize.addEventListener("change", () => {
      const px = parseInt(fontSize.value);
      const b = document.getElementById("body");
      if (!b) return;
      b.focus();
      const sel = window.getSelection();
      if (!sel.rangeCount || sel.isCollapsed) return;
      const range = sel.getRangeAt(0);
      const text = range.toString();
      if (!text) return;
      range.deleteContents();
      const span = document.createElement("span");
      span.style.fontSize = px + "px";
      span.textContent = text;
      range.insertNode(span);
      // Re-select the inserted span
      sel.removeAllRanges();
      const newRange = document.createRange();
      newRange.selectNodeContents(span);
      sel.addRange(newRange);
    });
    fontColor.addEventListener("input", () => {
      const b = document.getElementById("body");
      if (b) { b.focus(); document.execCommand("styleWithCSS", false, true); document.execCommand("foreColor", false, fontColor.value); }
    });
  }

"""

js = js[:old_h_start] + new_h + js[old_h_end:]

# 4. Change preview toggle to sourceMode
js = js.replace('state.previewMode = !state.previewMode;', 'state.sourceMode = !state.sourceMode;')

# 5. Editor: source mode (textarea) vs preview mode (rendered markdown)
old_render = '(state.previewMode'
new_render = '(!state.sourceMode'
js = js.replace(old_render, new_render)

# 6. Keep contenteditable for edit + add textarea for source
old_editor = '<div class="body" id="body" contenteditable="true"'
new_editor = '<textarea class="body" id="body"'
# Only replace the second one (in the renderEditor false branch)
first = js.index(old_editor)
second = js.index(old_editor, first + 1)
js = js[:second] + new_editor + js[second + len(old_editor):]

# Fix closing tag
old_close = '>${note.body.replace(/\\n/g, "<br>")}</div>`)'
new_close = '>${escapeHtml(note.body)}</textarea>`)'
pos = js.index(old_close, second)
if pos < js.index('(state.previewMode', second):  # check it's the right one
    js = js[:pos] + new_close + js[pos + len(old_close):]

# 7. Auto-save reads value from textarea
js = js.replace('note.body = body.innerHTML;', 'note.body = body.value;')

with open('src/main.js','w',encoding='utf-8') as f:
    f.write(js)
print('Done')
