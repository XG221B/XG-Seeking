#!/bin/bash
# API functional tests for XG-Seeking
API="http://127.0.0.1:1420/api"
PASS=0
FAIL=0
RESULTS=""

pass() { PASS=$((PASS+1)); RESULTS="$RESULTS\nPASS: $1"; }
fail() { FAIL=$((FAIL+1)); RESULTS="$RESULTS\nFAIL: $1 (got: $2)"; }

echo "=== Notes CRUD ==="

# Create
CREATE=$(curl -s -X POST "$API/create_note" -H "Content-Type: application/json" -d '{}')
NOTE_ID=$(echo "$CREATE" | python -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "Created note: $NOTE_ID"
pass "create_note"

# Save
SAVE=$(curl -s -X POST "$API/save_note" -H "Content-Type: application/json" \
  -d "{\"id\":\"$NOTE_ID\",\"title\":\"Test Note Title\",\"body\":\"Hello world body\"}")
if echo "$SAVE" | python -c "import sys,json; d=json.load(sys.stdin); assert d['title']=='Test Note Title', d"; then
  pass "save_note"
else
  fail "save_note" "$SAVE"
fi

# Re-read
LIST=$(curl -s -X POST "$API/list_notes" -H "Content-Type: application/json" -d '{}')
if echo "$LIST" | python -c "
import sys,json
notes=json.load(sys.stdin)
assert any(n['id']=='$NOTE_ID' and n['title']=='Test Note Title' for n in notes), 'not found'
"; then
  pass "re-read note in list"
else
  fail "re-read note in list" "$LIST"
fi

# Soft delete
DEL_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/delete_note" \
  -H "Content-Type: application/json" -d "{\"id\":\"$NOTE_ID\"}")
if [ "$DEL_CODE" = "204" ]; then pass "delete_note (soft) -> 204"
else fail "delete_note (soft) -> 204" "$DEL_CODE"; fi

# Note should NOT be in list_notes
LIST2=$(curl -s -X POST "$API/list_notes" -H "Content-Type: application/json" -d '{}')
if echo "$LIST2" | python -c "
import sys,json
notes=json.load(sys.stdin)
assert not any(n['id']=='$NOTE_ID' for n in notes), 'found deleted note'
"; then
  pass "deleted note not in list_notes"
else
  fail "deleted note not in list_notes" "$LIST2"
fi

# Should be in trash
TRASH=$(curl -s -X POST "$API/list_trash" -H "Content-Type: application/json" -d '{}')
if echo "$TRASH" | python -c "
import sys,json
notes=json.load(sys.stdin)
assert any(n['id']=='$NOTE_ID' for n in notes), 'not in trash'
"; then
  pass "note in trash"
else
  fail "note in trash" "$TRASH"
fi

# Restore
RESTORE=$(curl -s -X POST "$API/restore_note" -H "Content-Type: application/json" \
  -d "{\"id\":\"$NOTE_ID\"}")
if echo "$RESTORE" | python -c "
import sys,json; d=json.load(sys.stdin); assert d['title']=='Test Note Title', d
"; then
  pass "restore_note"
else
  fail "restore_note" "$RESTORE"
fi

# Verify restored in list
LIST3=$(curl -s -X POST "$API/list_notes" -H "Content-Type: application/json" -d '{}')
if echo "$LIST3" | python -c "
import sys,json
notes=json.load(sys.stdin)
assert any(n['id']=='$NOTE_ID' for n in notes), 'restored note missing'
"; then
  pass "restored note in list_notes"
else
  fail "restored note in list_notes" "$LIST3"
fi

# Delete again for perm delete
curl -s -o /dev/null -X POST "$API/delete_note" -H "Content-Type: application/json" -d "{\"id\":\"$NOTE_ID\"}"

# Permanent delete
PERM_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/delete_permanently" \
  -H "Content-Type: application/json" -d "{\"id\":\"$NOTE_ID\"}")
if [ "$PERM_CODE" = "204" ]; then pass "delete_permanently -> 204"
else fail "delete_permanently -> 204" "$PERM_CODE"; fi

# Verify gone from trash
TRASH2=$(curl -s -X POST "$API/list_trash" -H "Content-Type: application/json" -d '{}')
if echo "$TRASH2" | python -c "
import sys,json
notes=json.load(sys.stdin)
assert not any(n['id']=='$NOTE_ID' for n in notes), 'perm deleted note in trash'
"; then
  pass "perm deleted note gone from trash"
else
  fail "perm deleted note gone from trash" "$TRASH2"
fi

echo ""
echo "=== Mindmaps CRUD ==="

# Create
MM_CREATE=$(curl -s -X POST "$API/create_mindmap" -H "Content-Type: application/json" -d '{}')
MM_ID=$(echo "$MM_CREATE" | python -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "Created mindmap: $MM_ID"
pass "create_mindmap"

# Save with nodes
MM_SAVE=$(curl -s -X POST "$API/save_mindmap" -H "Content-Type: application/json" \
  -d "{\"id\":\"$MM_ID\",\"title\":\"Test Mindmap\",\"nodes\":[{\"id\":\"n1\",\"text\":\"root\",\"children\":[]},{\"id\":\"n2\",\"text\":\"child\",\"children\":[]}]}")
if echo "$MM_SAVE" | python -c "
import sys,json; d=json.load(sys.stdin)
assert d['title']=='Test Mindmap', d
assert len(d['nodes'])==2, d
"; then
  pass "save_mindmap"
else
  fail "save_mindmap" "$MM_SAVE"
fi

# Re-read
MM_LIST=$(curl -s -X POST "$API/list_mindmaps" -H "Content-Type: application/json" -d '{}')
if echo "$MM_LIST" | python -c "
import sys,json
maps=json.load(sys.stdin)
assert any(m['id']=='$MM_ID' and m['title']=='Test Mindmap' for m in maps), 'not found'
"; then
  pass "re-read mindmap in list"
else
  fail "re-read mindmap in list" "$MM_LIST"
fi

# Soft delete
MM_DEL_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/delete_mindmap" \
  -H "Content-Type: application/json" -d "{\"id\":\"$MM_ID\"}")
if [ "$MM_DEL_CODE" = "204" ]; then pass "delete_mindmap -> 204"
else fail "delete_mindmap -> 204" "$MM_DEL_CODE"; fi

# In trash
MM_TRASH=$(curl -s -X POST "$API/list_mindmap_trash" -H "Content-Type: application/json" -d '{}')
if echo "$MM_TRASH" | python -c "
import sys,json
maps=json.load(sys.stdin)
assert any(m['id']=='$MM_ID' for m in maps), 'not in trash'
"; then
  pass "mindmap in trash"
else
  fail "mindmap in trash" "$MM_TRASH"
fi

# Restore
MM_RESTORE=$(curl -s -X POST "$API/restore_mindmap" -H "Content-Type: application/json" \
  -d "{\"id\":\"$MM_ID\"}")
if echo "$MM_RESTORE" | python -c "
import sys,json; d=json.load(sys.stdin); assert d['title']=='Test Mindmap', d
"; then
  pass "restore_mindmap"
else
  fail "restore_mindmap" "$MM_RESTORE"
fi

# Delete again + perm delete
curl -s -o /dev/null -X POST "$API/delete_mindmap" -H "Content-Type: application/json" -d "{\"id\":\"$MM_ID\"}"
MM_PERM_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/delete_mindmap_permanently" \
  -H "Content-Type: application/json" -d "{\"id\":\"$MM_ID\"}")
if [ "$MM_PERM_CODE" = "204" ]; then pass "delete_mindmap_permanently -> 204"
else fail "delete_mindmap_permanently -> 204" "$MM_PERM_CODE"; fi

MM_TRASH2=$(curl -s -X POST "$API/list_mindmap_trash" -H "Content-Type: application/json" -d '{}')
if echo "$MM_TRASH2" | python -c "
import sys,json
maps=json.load(sys.stdin)
assert not any(m['id']=='$MM_ID' for m in maps), 'perm deleted in trash'
"; then
  pass "perm deleted mindmap gone"
else
  fail "perm deleted mindmap gone" "$MM_TRASH2"
fi

echo ""
echo "=== Settings ==="

GET_SET=$(curl -s -X POST "$API/get_settings" -H "Content-Type: application/json" -d '{}')
if echo "$GET_SET" | python -c "import sys,json; d=json.load(sys.stdin); assert 'language' in d"; then
  pass "get_settings"
else
  fail "get_settings" "$GET_SET"
fi

SAVE_SET_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/save_settings" \
  -H "Content-Type: application/json" -d '{"language":"en","title":"VerifySettings"}')
if [ "$SAVE_SET_CODE" = "204" ]; then pass "save_settings -> 204"
else fail "save_settings -> 204" "$SAVE_SET_CODE"; fi

VERIFY_SET=$(curl -s -X POST "$API/get_settings" -H "Content-Type: application/json" -d '{}')
if echo "$VERIFY_SET" | python -c "
import sys,json; d=json.load(sys.stdin); assert d['title']=='VerifySettings', d
"; then
  pass "settings persisted"
else
  fail "settings persisted" "$VERIFY_SET"
fi

# Restore default
curl -s -o /dev/null -X POST "$API/save_settings" -H "Content-Type: application/json" \
  -d '{"language":"zh","title":"寻找心灵的碎片..."}'

echo ""
echo "=== Security ==="

# Path traversal
TRAV_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:1420/../etc/passwd")
if [ "$TRAV_CODE" = "403" ]; then pass "path traversal blocked -> 403"
else fail "path traversal blocked -> 403" "$TRAV_CODE"; fi

TRAV_CODE2=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:1420/..%2F..%2Fetc%2Fpasswd")
if [ "$TRAV_CODE2" = "403" ]; then pass "url-encoded traversal blocked -> 403"
else fail "url-encoded traversal blocked -> 403" "$TRAV_CODE2"; fi

# Empty ID
EMPTY_ID=$(curl -s -X POST "$API/save_note" -H "Content-Type: application/json" \
  -d '{"id":"","title":"x","body":"x"}')
if echo "$EMPTY_ID" | grep -q "Invalid"; then
  pass "empty ID rejected"
else
  fail "empty ID rejected" "$EMPTY_ID"
fi

# Invalid ID chars
INV_ID=$(curl -s -X POST "$API/save_note" -H "Content-Type: application/json" \
  -d '{"id":"../../../etc","title":"x","body":"x"}')
if echo "$INV_ID" | grep -q "Invalid"; then
  pass "path-traversal ID rejected"
else
  fail "path-traversal ID rejected" "$INV_ID"
fi

echo ""
echo "=============================="
echo -e "$RESULTS"
echo ""
echo "TOTAL: $PASS passed, $FAIL failed"
