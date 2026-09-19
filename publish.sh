#!/usr/bin/env bash
# 小道博客发布脚本：hexo-rebuild 源 → 生成 → 同步 openresty 静态产物
# 用法：./publish.sh [regenerate-data]   (regenerate-data 会先跑 gen_popularity.py)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

# 关键：hexo 日期解析依赖系统时区；机器是 UTC，必须显式 Asia/Shanghai
# 另：new_post_name 保持 :title.md（默认），勿改回 :date-:title.md——
# 否则 parseFilename 会用文件名中的年份覆盖 front-matter date，URL 全变 2026/01/01
export TZ=Asia/Shanghai

if [[ "${1:-}" == "regenerate-data" ]]; then
  LOG="/opt/1panel/apps/openresty/openresty/log/blog.dingdao.me.access.log"
  [[ -f "$LOG" ]] && python3 tools/gen_popularity.py "$LOG" source/_data
fi

npx hexo clean
npx hexo generate
cp -rf public/* /opt/1panel/www/blog-public/
echo "✓ 已发布到 /opt/1panel/www/blog-public (blog.dingdao.me)"
