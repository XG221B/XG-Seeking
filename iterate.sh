#!/bin/bash
# ===========================================
#  XG-Seeking 两阶段自迭代
#  Phase 1: 代码质量审查 → 修复
#  Phase 2: 构建 + API 验证 → 修复
#  两阶段均通过或达到最大轮数则结束
# ===========================================
#  用法: bash iterate.sh [轮数]
#  示例: bash iterate.sh 5

set -euo pipefail

TURNS=${1:-5}
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL="xg-seeking-self-iterate"
START_TIME=$(date '+%H:%M:%S')
PHASE1_CLEAN=0
PHASE2_CLEAN=0
P1_RESULT=""
P2_RESULT=""

cd "$PROJECT_DIR" || { echo "ERROR: cannot enter $PROJECT_DIR"; exit 1; }

echo "==============================================="
echo "  XG-Seeking 两阶段自迭代"
echo "  项目: $PROJECT_DIR"
echo "  轮数: $TURNS  |  开始: $START_TIME"
echo "==============================================="

for i in $(seq 1 "$TURNS"); do
    echo ""
    echo "========== 第 $i / $TURNS 轮 =========="

    # ── Phase 1: 代码质量 ──
    echo ""
    echo ">>> Phase 1: 代码质量审查 ..."
    P1_OUTPUT=$(hermes chat -m deepseek-v4-pro -s "$SKILL" -q "Phase 1 — 代码质量审查。逐条检查：死代码、命名规范（Rust snake_case, JS camelCase, CSS kebab-case）、错误处理（JS invoke 都有 catch，Rust 无 unwrap）、构建清洁度（npm run build 退 出 0, cargo clippy 无 warning）、i18n 覆盖（所有面向用户的字符串都通过 t()）、冗余代码。发现问题立即修复。回复 PHASE1_CLEAN 或 PHASE1_FIXED。" 2>&1)
    echo "$P1_OUTPUT"

    if echo "$P1_OUTPUT" | grep -q "PHASE1_CLEAN"; then
        PHASE1_CLEAN=1
    elif echo "$P1_OUTPUT" | grep -q "PHASE1_FIXED"; then
        P1_RESULT="FIXED"
    else
        P1_RESULT="UNKNOWN"
    fi

    # ── Phase 2: 功能验证 ──
    echo ""
    echo ">>> Phase 2: 功能验证 ..."
    # 先确保本地 server 可用于 API 测试
    node local-server.mjs &
    SERVER_PID=$!
    sleep 2

    P2_OUTPUT=$(hermes chat -m deepseek-v4-pro -s "$SKILL" -q "Phase 2 — 功能验证。1. npm run build 确认成功。2. 对 localhost:1420 做 curl API 测试：笔记 CRUD（创建→保存→重读→删除→回收站→恢复→永久删除），思维导图 CRUD（创建→加节点→保存→重读→删除→回收站→恢复），设置读写，安全检查（路径穿越拦截、空 ID 拒绝）。3. 确认本轮改动没破坏已有功能。回复 PHASE2_CLEAN 或 PHASE2_FIXED。" 2>&1)
    echo "$P2_OUTPUT"

    kill $SERVER_PID 2>/dev/null || true

    if echo "$P2_OUTPUT" | grep -q "PHASE2_CLEAN"; then
        PHASE2_CLEAN=1
    elif echo "$P2_OUTPUT" | grep -q "PHASE2_FIXED"; then
        P2_RESULT="FIXED"
    else
        P2_RESULT="UNKNOWN"
    fi

    # ── 判断 ──
    if [ "$PHASE1_CLEAN" -eq 1 ] && [ "$PHASE2_CLEAN" -eq 1 ]; then
        echo ""
        echo "==============================================="
        echo "  PASS  两阶段均无问题"
        echo "  结束: $(date '+%H:%M:%S') | 共 $i 轮"
        echo "==============================================="
        exit 0
    fi
done

echo ""
echo "==============================================="
echo "  达到最大轮数 $TURNS，迭代结束"
echo "  结束: $(date '+%H:%M:%S')"
echo "==============================================="
exit 0
