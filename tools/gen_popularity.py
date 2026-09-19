#!/usr/bin/env python3
"""读取 openresty access log + source/_posts front-matter，生成分类热度 JSON。
写入 source/_data/popularity.json 供主题读取（分类横排 widget 按热度排序）。

用法：python3 gen_popularity.py <access.log> [outdir]
"""
import re
import sys
import json
import time
import yaml
from pathlib import Path

LOG_RE = re.compile(
    r"^(?P<ip>\S+)\s+\S+\s+\S+\s+\[(?P<time>[^\]]+)\]\s+"
    r'"(?P<method>\S+) (?P<path>\S+) (?P<proto>[^"]+)"\s+(?P<status>\d+)'
)
POST_URL_RE = re.compile(r"^/(\d{4})/(\d{2})/(\d{2})/(.+?)/?$")


def read_log(path, days=30):
    """统计近 days 天每篇文章路径的 PV。返回 {YYYY-MM-DD-slug: pv}"""
    cutoff = time.time() - days * 86400
    pv = {}
    for line in open(path, encoding="utf-8", errors="ignore"):
        m = LOG_RE.match(line)
        if not m:
            continue
        try:
            ts = time.mktime(time.strptime(m.group("time"), "%d/%b/%Y:%H:%M:%S"))
        except ValueError:
            continue
        if ts < cutoff:
            continue
        pm = POST_URL_RE.match(m.group("path"))
        if pm:
            key = "%s-%s-%s-%s" % pm.groups()
            pv[key] = pv.get(key, 0) + 1
    return pv


def read_posts(posts_dir):
    """返回 [{date, slug, title, categories, tags}]"""
    posts = []
    for f in sorted(Path(posts_dir).glob("*.md")):
        text = f.read_text(encoding="utf-8")
        m = re.match(r"^---\n(.*?)\n---\n?(.*)$", text, re.DOTALL)
        if not m:
            continue
        try:
            meta = yaml.safe_load(m.group(1)) or {}
        except yaml.YAMLError:
            meta = {}
        stem = f.stem  # YYYY-MM-DD-title
        date = str(meta.get("date", ""))[:10]
        if not re.match(r"\d{4}-\d{2}-\d{2}", date):
            date = stem[:10]
        slug = f.stem[11:]
        posts.append({
            "date": date,
            "slug": slug,
            "key": date + "-" + slug,
            "title": meta.get("title", slug),
            "categories": meta.get("categories", []) or [],
            "tags": meta.get("tags", []) or [],
        })
    return posts


def main():
    log = sys.argv[1]
    outdir = sys.argv[2] if len(sys.argv) > 2 else "source/_data"
    posts_dir = Path(__file__).resolve().parent.parent / "source" / "_posts"
    pv = read_log(log)
    posts = read_posts(posts_dir)

    # 一级分类热度聚合
    cat_pv, cat_count = {}, {}
    for p in posts:
        top = p["categories"][0] if p["categories"] else "未分类"
        cat_pv[top] = cat_pv.get(top, 0) + pv.get(p["key"], 0)
        cat_count[top] = cat_count.get(top, 0) + 1

    cats = []
    for name in set(cat_pv) | set(cat_count):
        cats.append({
            "name": name,
            "path": name,
            "posts": cat_count.get(name, 0),
            "pv": cat_pv.get(name, 0),
            "hot": cat_pv.get(name, 0) + cat_count.get(name, 0) * 10,
        })
    cats.sort(key=lambda c: (-c["hot"], -c["posts"], c["name"]))

    out = Path(outdir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "popularity.json").write_text(
        json.dumps({"cats": cats, "generated": time.strftime("%Y-%m-%d")}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print("wrote", out / "popularity.json")
    print(json.dumps(cats, ensure_ascii=False))


if __name__ == "__main__":
    main()
