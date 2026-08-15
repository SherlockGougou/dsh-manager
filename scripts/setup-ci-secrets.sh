#!/bin/bash
# 配置 GitHub Actions 签名/公证 Secrets（在【你自己的终端】运行）
# 用法：./scripts/setup-ci-secrets.sh <p12文件路径>
set -e
cd "$(dirname "$0")/.."

if [ $# -lt 1 ]; then
  echo "用法: ./scripts/setup-ci-secrets.sh <p12文件路径>"
  exit 1
fi
P12="$1"
if [ ! -f "$P12" ]; then
  echo "✗ 找不到文件: $P12"
  exit 1
fi

# ── 大小校验（GitHub Secrets 上限 64KB） ────────────────────────
B64_SIZE=$(base64 < "$P12" | wc -c | tr -d ' ')
echo "p12: $P12（base64 后 ${B64_SIZE} 字节，上限 65536）"
if [ "$B64_SIZE" -gt 65536 ]; then
  echo ""
  echo "✗ 超过 64KB 上限。说明：你用 security export -t certs 导出了整个钥匙串。"
  echo "  请改用【钥匙串访问】只导出单张证书："
  echo "    1) 打开 钥匙串访问 (Keychain Access)"
  echo "    2) 左侧选「登录」，类别选「我的证书」"
  echo "    3) 右键 Developer ID Application: Gou QingLin (DCS654Q2V3) → 导出"
  echo "    4) 选 .p12 格式，设一个密码（记住它，下一步要用）"
  echo "    5) 重新运行: ./scripts/setup-ci-secrets.sh <新导出的.p12>"
  exit 1
fi

echo ""
echo "== [1/5] 上传 CSC_LINK（p12 base64） =="
base64 < "$P12" | gh secret set CSC_LINK

echo "== [2/5] CSC_KEY_PASSWORD（p12 导出时设置的密码） =="
read -rsp "请输入 p12 密码: " P12_PASS; echo ""
[ -n "$P12_PASS" ] || { echo "✗ 密码为空"; exit 1; }
printf '%s' "$P12_PASS" | gh secret set CSC_KEY_PASSWORD

echo "== [3/5] APPLE_ID（公证用 Apple ID 邮箱） =="
read -rp "请输入 Apple ID 邮箱: " APPLE_ID
[ -n "$APPLE_ID" ] || { echo "✗ 为空"; exit 1; }
printf '%s' "$APPLE_ID" | gh secret set APPLE_ID

echo "== [4/5] APPLE_APP_SPECIFIC_PASSWORD（appleid.apple.com 生成的专用密码） =="
read -rsp "请输入 App 专用密码: " APP_PASS; echo ""
[ -n "$APP_PASS" ] || { echo "✗ 为空"; exit 1; }
printf '%s' "$APP_PASS" | gh secret set APPLE_APP_SPECIFIC_PASSWORD

echo "== [5/5] APPLE_TEAM_ID =="
printf '%s' "DCS654Q2V3" | gh secret set APPLE_TEAM_ID

echo ""
echo "✅ Secrets 配置完成，当前已配置："
gh secret list
echo ""
echo "下次推送 v* tag 时，CI 将自动签名+公证 macOS 产物（工作流按 APPLE_ID 是否存在自动切换）。"
