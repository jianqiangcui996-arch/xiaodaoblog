#!/usr/bin/env python3
"""从已发布的 hexo 产物 HTML 还原 source/_posts/*.md。
用法：python3 restore_posts.py [public_root] [posts_dir]
说明：
- HTML 正文是 marked 的产物，直接包回 markdown（hexo 渲染后等价）
- front-matter 从 meta 标签还原：date / title / categories / tags
- categories 做扁平化清洗（见 RECAT 映射表）
"""
import os
import re
import sys
import html as html_mod
from pathlib import Path
from urllib.parse import unquote

PUBLIC = Path(sys.argv[1] if len(sys.argv) > 1 else "/opt/1panel/www/blog-public")
POSTS = Path(sys.argv[2] if len(sys.argv) > 2 else str(Path(__file__).parent.parent / "source" / "_posts"))

# ---- 分类清洗映射：(原分类路径列表) -> 新分类 ----
# 原有：认知/AI, 折腾/AI, AI/商业, 网络, 服务器管理, 455(测试), 12(测试), 无分类
# 新方案：扁平 6 类，二级只留「认知/前沿」
RECAT = {
    ("认知", "AI"):       ["认知", "前沿"],
    ("AI", "商业"):       ["AI", "商业"],
    ("折腾", "AI"):       ["折腾"],
    ("网络",):            ["网络"],
    ("服务器管理",):      ["服务器"],
    ("455",):            ["折腾"],   # 测试分类 123 文，归折腾
    ("12",):             ["折腾"],   # 测试分类，归折腾
    ():                  ["折腾"],   # 无分类默认归折腾（旧站习惯）
}

CAT_URL = {
    "认知": "认知", "前沿": "AI", "AI": "AI", "商业": "商业",
    "折腾": "折腾", "网络": "网络", "服务器": "服务器管理",
}


def get_meta(html, name):
    m = re.search(r'<meta property="%s" content="([^"]*)"' % name, html)
    return html_mod.unescape(m.group(1)) if m else None


def get_title(html):
    m = re.search(r'<title>([^|]*)\|', html)
    return html_mod.unescape(m.group(1).strip()) if m else None


def get_categories(html):
    m = re.search(r'<div class="article-category">(.*?)</div>', html, re.S)
    if not m:
        return []
    links = re.findall(r'<a class="article-category-link" href="/categories/(.*?)/?">([^<]*)</a>', m.group(1))
    # 取最后一个（最深的）锚点的路径，去掉重复
    if not links:
        return []
    raw = links[-1][0]
    return [unquote(x) for x in raw.split("/") if x]


def get_tags(html):
    m = re.search(r'<ul class="article-tag-list"[^>]*>(.*?)</ul>', html, re.S)
    if not m:
        return []
    return [unquote(t) for t in re.findall(r'<a class="article-tag-list-link" href="/tags/(.*?)/" rel="tag">', m.group(1))]


def get_body(html):
    """提取 .article-entry 内部，把 <h2 id=".."><a class="headerlink" ...></a> 的锚点剥掉"""
    m = re.search(r'<div class="e-content article-entry"[^>]*>(.*?)</div>\s*<footer class="article-footer">', html, re.S)
    if not m:
        m = re.search(r'<div class="e-content article-entry"[^>]*>(.*)</div>', html, re.S)
    body = m.group(1)
    # 剥掉 headerlink 锚点，保留 h2 自身
    body = re.sub(r'<h2 id="([^"]*)"><a href="#\1" class="headerlink"[^>]*></a>', r'<h2 id="\1">', body)
    body = re.sub(r'<h3 id="([^"]*)"><a href="#\1" class="headerlink"[^>]*></a>', r'<h3 id="\1">', body)
    return body.strip()


def yaml_list(items):
    if not items:
        return "[]"
    return "[" + ", ".join(repr(i).replace("'", "") for i in items) + "]"


def main():
    POSTS.mkdir(parents=True, exist_ok=True)
    post_files = sorted(PUBLIC.glob("2026/*/*/*/*.html"), key=lambda p: str(p))
    stats = {}
    for f in post_files:
        h = f.read_text(encoding="utf-8", errors="ignore")
        if '<article' not in h:
            continue
        date = get_meta(h, "article:published_time")
        title = get_title(h)
        cats = get_categories(h)
        tags = get_tags(h)
        body = get_body(h)
        if not date or not title:
            print("SKIP (no meta):", f)
            continue
        # 文件名：YYYY-MM-DD-slug.md（与旧站 2026/MM/DD/slug 一致）
        d = date[:10]
        dpath = str(f.relative_to(PUBLIC))
        slug = unquote(dpath.split("/")[-2])
        # 文件名里把空格/特殊字符保留（hexo 文件名即 slug，与 URL 无关）
        fname = f"{d}-{slug}.md"
        # 分类清洗
        key = tuple(cats)
        new_cats = RECAT.get(key, ["折腾"])
        out = f"---\ntitle: {title}\ndate: {d} 00:00:00 +08:00\ncategories: {yaml_list(new_cats)}\ntags: {yaml_list(tags)}\n---\n\n{body}\n"
        (POSTS / fname).write_text(out, encoding="utf-8")
        stats[tuple(new_cats)] = stats.get(tuple(new_cats), 0) + 1
        print(f"OK {fname}  cats={cats}->{new_cats}  tags={tags}")
    print("\n--- 新分类分布 ---")
    for k, v in sorted(stats.items(), key=lambda x: -x[1]):
        print(f"  {v:3d}  {k}")
    print(f"共 {sum(stats.values())} 篇")


if __name__ == "__main__":
    main()
