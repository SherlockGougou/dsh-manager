#!/bin/bash
# 本地签名 + 公证 macOS 产物（在【你自己的终端】运行，无需沙箱限制）
# 前置：1) 已用 notarytool 存储凭据（见下方首次运行提示）
#       2) 钥匙串中有 Developer ID Application 证书
set -e
cd "$(dirname "$0")/.."

# ── 首次运行：存储 Apple 公证凭据 ─────────────────────────────
if ! xcrun notarytool history --keychain-profile dsh-manager >/dev/null 2>&1; then
  echo ""
  echo "============================================================"
  echo " 首次使用：请先存储 Apple 公证凭据（只需一次）"
  echo " 1) 打开 https://appleid.apple.com → 登录 → 登录与安全 → App 专用密码"
  echo "    生成一个专用密码（名称随意，如 dsh-manager）"
  echo " 2) 复制下面命令，替换 <你的AppleID邮箱> 和 <专用密码> 后执行："
  echo ""
  echo "   xcrun notarytool store-credentials \\"
  echo "     \"dsh-manager\" --apple-id \"<你的AppleID邮箱>\" \\"
  echo "     --team-id \"DCS654Q2V3\" --password \"<专用密码>\""
  echo ""
  echo " 3) 完成后重新运行本脚本"
  echo "============================================================"
  exit 1
fi

echo "== [1/3] 构建签名版（自动使用 Developer ID 证书） =="
export APPLE_KEYCHAIN_PROFILE=dsh-manager
export CSC_IDENTITY_AUTO_DISCOVERY=true
pnpm dist:mac

echo ""
echo "== [2/3] 验证签名与公证状态 =="
for APP in "dist/mac-arm64/DSH Manager.app" "dist/mac/DSH Manager.app"; do
  if [ -d "$APP" ]; then
    echo "--- $APP ---"
    codesign -dv "$APP" 2>&1 | grep -E "Signature|TeamIdentifier|Authority=Developer ID" | head -4
    xcrun stapler validate "$APP" 2>&1 | head -2 || echo "（未盖章，公证可能未完成）"
    spctl -a -vv "$APP" 2>&1 | head -3
  fi
done

echo ""
echo "== [3/3] 完成 =="
echo "产物: dist/*.dmg / dist/*-mac.zip"
echo "分发前请在【全新未装过本应用的机器/账号】下载测试，确认无 Gatekeeper 拦截。"
echo ""
echo "提示：如 spctl 显示 accepted(source=Notarized Developer ID)，即公证成功。"
