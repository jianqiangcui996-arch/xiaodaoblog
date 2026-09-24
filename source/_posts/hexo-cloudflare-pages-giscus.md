---
title: 把 Hexo 博客搬上 Cloudflare Pages：关机也不掉线，改 GitHub 即发布
date: 2026-09-24
categories: [服务器]
tags: [Hexo, Cloudflare Pages, Giscus, 静态博客, 部署]
---

> 起因很朴素：博客一直跑在家里一台 Windows 的 Hyper-V Ubuntu 虚拟机里，靠 Cloudflare Tunnel 暴露公网。**电脑一关、VM 一停，博客就 502**。我想把它变成"读永远在线、写和评论都不依赖家里电脑"。这篇记录整个迁移到 Cloudflare Pages + GitHub 自动构建 + Giscus 评论的过程，以及踩到的坑。

## 目标

- **读**：任何人任何时间都能打开，家里电脑关机也在线。
- **写**：改文章不需要开家里那台机器，在 GitHub 上改 `.md` 提交即发布。
- **评论**：访客能留言、我能管理，且**不用自己养一个后端**。

## 最终架构

```
GitHub 仓库(xiaodaoblog, Hexo 源码)
      │  push 触发
      ▼
Cloudflare Pages ── 自动构建 npx hexo generate → public
      │  自定义域 blog.dingdao.me / www.dingdao.me
      ▼
访客 ──► 静态站(永远在线)
        ├─ 评论: Giscus ⇄ GitHub Discussions(零后端)
        └─ 统计: Cloudflare Web Analytics(免费、无 Cookie)
```

关键点：**Cloudflare Tunnel 是出站的**，所以"服务在哪跑"和"域名能不能通"解耦了——静态内容一旦交给 Pages CDN，就跟家里机器彻底无关。

## 第一步：静态产物上 Pages

Hexo `generate` 出来的 `public/` 是纯静态。用 `wrangler` 直接部署：

```bash
npm i -g wrangler
wrangler login                       # 浏览器授权一次
wrangler pages project create blog --production-branch main
wrangler pages deploy ./public --project-name blog
```

拿到 `blog-xxx.pages.dev` 后，在 Pages 项目里绑定自定义域 `blog.dingdao.me`。因为域名本来就在 Cloudflare，改一条 CNAME 即可：把原来指向 `<tunnel-id>.cfargotunnel.com` 的记录改成 `<project>.pages.dev`（保持橙云 proxied）。

## 第二步：评论换成 Giscus

原来是自己写的评论接口（Flask + SQLite），家里 VM 一关评论就废。换成 [Giscus](https://giscus.app)——评论数据存在 **GitHub Discussions**，零后端、免费、永久在线。

三步：
1. 仓库开 **Discussions**，装 **giscus GitHub App**（授权到该仓库）。
2. 在 giscus.app 选好映射方式（我用 `pathname`，每篇文章 URL 对应一个 discussion）、语言 `zh-CN`，拿到 `data-repo-id` / `data-category-id`。
3. 把嵌入片段塞进主题的文章页（用 `is_post()` 只在文章页渲染），同时把旧的自建评论接口关掉。

## 第三步：源码进 GitHub + 自动构建

把 Hexo 源码（排除 `node_modules` / `public` / `db.json`）推到一个 GitHub 仓库，然后让 Pages **连这个仓库自动构建**。

**这里踩了最大的一个坑**：在 Cloudflare 后台连上 GitHub 后，默认 **Build command 是空的**，Pages 不会执行 `hexo generate`，直接把源码仓库当产物部署 → 根路径 **404**。必须显式设置：

```
Build command:  npx hexo generate
Output directory:  public
```

配好后，**在 GitHub 上改 `.md` → 提交 → Pages 自动重新构建发布**，全程不用碰家里电脑。

> 推送用 **Deploy Key**（仓库级 SSH 公钥，比账号级 token 安全）比账号级令牌干净；GitHub 对"加部署密钥/装第三方 App"会弹 **sudo 二次验证（2FA）**，这一下得本人输验证码。

## 第四步：访客统计

用 **Cloudflare Web Analytics**：免费、无 Cookie、不跟踪跨站，Pages 项目里一键开启会自动注入 beacon。能看到**来源(referrer)、各页面、平均停留时间、国家/设备/浏览器**。想要更细的"访问路径/会话流转"，可以换自托管的 Umami。

## 踩坑清单（速查）

| 坑 | 现象 | 解法 |
|---|---|---|
| Pages 连 Git 后不构建 | 站点 404 / 部署的是源码 | 设 `npx hexo generate` + 输出 `public` |
| 自定义域不生效 | 一直指向旧隧道 | 把 CNAME 从 `*.cfargotunnel.com` 改到 `*.pages.dev` |
| 评论迁 Giscus 后旧接口还在 | 页面出现两套评论 | 关掉主题里自建评论的 `comment_api` 配置 |
| 中文标题 slug | URL 里是编码后的中文 | 正常，permalink 用 `:title` 即可 |
| 点赞/喜欢依赖后端 | 关机后失效 | 用 `_worker.js` 代理 `/api` 回后端，或改用 Giscus 的 reactions |

## 结果

- 博客 + 门户现在跑在 Pages CDN，**家里电脑关机照样在线**；
- 写文章 = 在 GitHub 改 `.md` 提交，几十秒后自动上线；
- 评论 = GitHub Discussions，我能直接在 GitHub 后台管理垃圾评论；
- 统计 = Cloudflare Web Analytics。

家里那台机器从此只需要在"跑动态服务（面板/网关/智能家居）"时才开机，博客这条线彻底解耦了。
