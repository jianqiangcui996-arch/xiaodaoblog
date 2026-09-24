#!/usr/bin/env bash
# 小道博客发布脚本：hexo-rebuild 源 → 生成 → 同步 openresty 静态产物
# 用法：./publish.sh [regenerate-data]   (regenerate-data 会先跑 gen_popularity.py)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

# 关键：hexo 日期解析依赖系统时区；机器是 UTC，必须显式 Asia/Shanghai
# 另：new_post_name 保持 :title.md（默认），勿改回 :date-:title.md——
# 否则 parseFilename 会用文件名中的年份覆盖 front-matter date，URL 全变 2026/01/01
export TZ=Asia/Shanghai

# 每次发布都重新生成分类热度数据（访问日志会持续增长）；
# 传 regenerate-data 时也走同一逻辑（保留旧用法兼容）
LOG="/opt/1panel/apps/openresty/openresty/log/blog.dingdao.me.access.log"
[[ -f "$LOG" ]] && python3 tools/gen_popularity.py "$LOG" source/_data

npx hexo clean
npx hexo generate
# 先清目标目录里的历史遗留 HTML（旧日期 URL、旧文章），再覆盖拷贝，
# 否则删除/改名后的文章会以"还能访问"的形式残留在站点上
rm -rf /opt/1panel/www/blog-public/*
cp -rf public/* /opt/1panel/www/blog-public/
echo "✓ 已发布到 /opt/1panel/www/blog-public (blog.dingdao.me)"
