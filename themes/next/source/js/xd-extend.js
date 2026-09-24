// 小道博客扩展：语音朗读 / 点赞 / 评论 / 分享重做 / UI 中英切换 / 分类热度条
// 由 hexo 主题发布到 /js/xd-extend.js，bodyEnd 注入
(function () {
  'use strict';

  const EXTEND = (function () {
    try { return JSON.parse(document.querySelector('.next-config[data-name="extend"]')?.textContent || '{}'); }
    catch (e) { return {}; }
  })();

  // 从 URL 推导文章 slug：/2026-10-05-标题/ -> 2026-10-05-标题（与 hexo-rebuild 的 md 文件名一致）
  const POST_SLUG = (function () {
    const m = location.pathname.match(/^\/?(\d{4})\/(\d{2})\/(\d{2})\/(.+?)\/?$/);
    if (!m) return null;
    return m[1] + '-' + m[2] + '-' + m[3] + '-' + decodeURIComponent(m[4].replace(/\/$/, ''));
  })();

  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function miniMd(t) {
    let s = esc(t);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" referrerpolicy="no-referrer">$1</a>');
    s = s.replace(/\n/g, '<br>');
    return s;
  }
  function relTime(iso, lang) {
    const d = new Date(iso); if (isNaN(d)) return '';
    const s = Math.floor((Date.now() - d.getTime()) / 1000);
    const en = lang === 'en';
    if (s < 60) return en ? 'now' : '刚刚';
    if (s < 3600) return Math.floor(s / 60) + (en ? ' min ago' : ' 分钟前');
    if (s < 86400) return Math.floor(s / 3600) + (en ? ' hour ago' : ' 小时前');
    if (s < 2592000) return Math.floor(s / 86400) + (en ? ' day ago' : ' 天前');
    return d.toLocaleDateString(en ? 'en-US' : 'zh-CN');
  }

  // UI 文案字典（不翻译文章正文；与 source/_data/ui-i18n.json 对应）
  const UI_I18N = {
    zh: {
      home: '首页', archives: '归档', categories: '分类', tags: '标签', admin: '管理台',
      search: '搜索', site_title: '小道的技术笔记', site_sub: '记录折腾、认知与闭环',
      read: '朗读', stop: '停止', like: '喜欢', love: '推荐', comments: '评论',
      prev: '上一篇', next: '后一篇', copy: '复制链接', copy_ok: '已复制',
      wechat: '微信', weibo: '微博', qq: 'QQ',
      widget_categories: '分类', cat_by_hot: '分类 · 按热度', hot: '热度', posts: '篇',
      c_empty: '还没有评论，来抢沙发', c_loading: '加载失败',
      c_hint: '提交后即刻显示，无需审核', c_send: '发表', c_sending: '提交中…',
      c_err: '提交失败', name_ph: '昵称（选填）', comment_ph: '说点什么…（支持 **加粗**、`代码`、链接）',
      reply: '回复', anon: '匿名', net_err: '网络错误', read_rate: '语速',
    },
    en: {
      home: 'Home', archives: 'Archives', categories: 'Categories', tags: 'Tags', admin: 'Admin',
      search: 'Search', site_title: "Xiaodao's Tech Notes", site_sub: 'Tinkering, cognition & closed loops',
      read: 'Read', stop: 'Stop', like: 'Like', love: 'Love', comments: 'Comments',
      prev: 'Prev', next: 'Next', copy: 'Copy link', copy_ok: 'Copied',
      wechat: 'WeChat', weibo: 'Weibo', qq: 'QQ',
      widget_categories: 'Categories', cat_by_hot: 'Categories by heat', hot: 'heat', posts: 'posts',
      c_empty: 'No comments yet — be the first', c_loading: 'Load failed',
      c_hint: 'Comments appear instantly, no moderation', c_send: 'Post', c_sending: 'Submitting…',
      c_err: 'Failed', name_ph: 'Name (optional)', comment_ph: 'Say something… (**bold**, `code`, links)',
      reply: 'Reply', anon: 'anon', net_err: 'Network error', read_rate: 'Speed',
    },
  };
  let CUR_LANG = localStorage.getItem('xd-ui-lang') || 'zh';
  function T() { return UI_I18N[CUR_LANG] || UI_I18N.zh; }

  // ============ 1) 语音朗读（详情页）============
  function initReadAloud() {
    if (!('speechSynthesis' in window) || !POST_SLUG) return;
    const entry = document.querySelector('[itemprop="articleBody"]');
    if (!entry) return;
    const host = entry.closest('.post-inner, .post') || entry.parentElement;
    const d = T();
    const bar = document.createElement('div');
    bar.className = 'xd-tools xd-read-aloud';
    bar.innerHTML =
      '<button type="button" class="xd-tool" data-xd="ra" title="' + d.read + '"><i class="fa fa-volume-up"></i><span>' + d.read + '</span></button>' +
      '<button type="button" class="xd-tool" data-xd="ras" title="' + d.stop + '"><i class="fa fa-stop"></i><span>' + d.stop + '</span></button>' +
      '<label class="xd-rate" title="' + d.read_rate + '"><input type="range" min="0.6" max="1.6" step="0.1" value="1"></label>';
    host.prepend(bar);
    let chunks = [], idx = 0, rate = 1, active = false;
    function collect() {
      chunks = [];
      const nodes = entry.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote');
      nodes.forEach(el => {
        if (el.closest('.xd-tools, .xd-comments, .xd-share, .post-reward, .post-share-links')) return;
        const t = el.innerText.trim();
        if (t && t.length > 1) chunks.push(t);
      });
    }
    function step() {
      if (idx >= chunks.length) { active = false; bar.querySelector('[data-xd="ra"]').classList.remove('on'); return; }
      const u = new SpeechSynthesisUtterance(chunks[idx++]);
      u.lang = 'zh-CN'; u.rate = rate;
      u.onend = step;
      u.onerror = () => { active = false; bar.querySelector('[data-xd="ra"]').classList.remove('on'); };
      speechSynthesis.speak(u);
    }
    bar.querySelector('[data-xd="ra"]').addEventListener('click', () => {
      if (active) { speechSynthesis.cancel(); active = false; bar.querySelector('[data-xd="ra"]').classList.remove('on'); return; }
      collect(); idx = 0; active = true; bar.querySelector('[data-xd="ra"]').classList.add('on'); step();
    });
    bar.querySelector('[data-xd="ras"]').addEventListener('click', () => {
      speechSynthesis.cancel(); active = false;
      bar.querySelector('[data-xd="ra"]').classList.remove('on');
    });
    bar.querySelector('input[type=range]').addEventListener('input', e => { rate = parseFloat(e.target.value); });
  }

  // ============ 2) 点赞（详情页）============
  function initFeedback() {
    if (!POST_SLUG || !EXTEND.feedback_api) return;
    const host = document.querySelector('.post-inner, .post') || document.body;
    const d = T();
    const row = document.createElement('div');
    row.className = 'xd-tools xd-feedback';
    row.innerHTML =
      '<button type="button" class="xd-tool" data-xd="like"><i class="fa fa-thumbs-o-up"></i><span>' + d.like + '</span><b class="xd-count"></b></button>' +
      '<button type="button" class="xd-tool" data-xd="love"><i class="fa fa-heart-o"></i><span>' + d.love + '</span><b class="xd-count"></b></button>';
    const entry = host.querySelector('[itemprop="articleBody"]');
    entry ? entry.parentElement.insertBefore(row, entry) : host.insertBefore(row, host.firstChild);
    const LS = 'xd-fb-' + POST_SLUG;
    let done = {};
    try { done = JSON.parse(localStorage.getItem(LS) || '{}'); } catch (e) { done = {}; }

    function markOn(btn, on) { btn.classList.toggle('on', on); }
    markOn(row.querySelector('[data-xd="like"]'), !!done.like);
    markOn(row.querySelector('[data-xd="love"]'), !!done.love);

    fetch(EXTEND.feedback_api + '/counts?post=' + encodeURIComponent(POST_SLUG))
      .then(r => { if (r.ok !== true) throw new Error('http ' + r.status); return r.json(); })
      .then(j => {
        row.querySelector('[data-xd="like"] .xd-count').textContent = j.like || 0;
        row.querySelector('[data-xd="love"] .xd-count').textContent = j.love || 0;
      })
      .catch(() => {
        row.querySelector('[data-xd="like"] .xd-count').textContent = '0';
        row.querySelector('[data-xd="love"] .xd-count').textContent = '0';
      });

    ['like', 'love'].forEach(t => {
      row.querySelector('[data-xd="' + t + '"]').addEventListener('click', async function () {
        if (done[t]) return;
        const btn = this;
        btn.disabled = true;
        try {
          const r = await fetch(EXTEND.feedback_api, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ post: POST_SLUG, type: t }),
          });
          let j = {};
          try { j = await r.json(); } catch (e) {}
          if (j && j.ok) {
            done[t] = true;
            try { localStorage.setItem(LS, JSON.stringify(done)); } catch (e) {}
            markOn(btn, true);
            btn.querySelector('.xd-count').textContent = j.count;
          } else alert((j && j.error) || d.net_err);
        } catch (e) { alert(d.net_err); }
        btn.disabled = false;
      });
    });
  }

  // ============ 3) 评论（详情页）============
  function initComments() {
    if (!POST_SLUG || !EXTEND.comment_api) return;
    const host = document.querySelector('.post-inner, .post');
    if (!host) return;
    const d = T();
    const wrap = document.createElement('div');
    wrap.className = 'xd-comments';
    wrap.innerHTML =
      '<h4 class="xd-c-title"><i class="fa fa-comments-o"></i> <span>' + d.comments + '</span> <b class="xd-c-total"></b></h4>' +
      '<form class="xd-c-form">' +
      '  <input type="text" name="cname" placeholder="' + esc(d.name_ph) + '" maxlength="32" value="' + esc(localStorage.getItem('xd-cname') || '') + '">' +
      '  <textarea name="cbody" rows="3" placeholder="' + esc(d.comment_ph) + '" maxlength="2000" required></textarea>' +
      '  <div class="xd-c-form-foot">' +
      '    <span class="xd-c-hint">' + d.c_hint + '</span>' +
      '    <button type="submit" class="btn xd-c-submit"><i class="fa fa-paper-plane"></i> ' + d.c_send + '</button>' +
      '  </div>' +
      '</form>' +
      '<ul class="xd-c-list"></ul>';
    host.appendChild(wrap);

    const list = wrap.querySelector('.xd-c-list');
    const total = wrap.querySelector('.xd-c-total');
    const form = wrap.querySelector('form');

    function li(c, reply) {
      const item = document.createElement('li');
      item.className = 'xd-c-item' + (reply ? ' reply' : '');
      const parent = reply ? '<i class="fa fa-arrow-left"></i> ' + d.reply + ' ' : '';
      const replyBtn = reply ? '' :
        '<button type="button" class="xd-c-reply" data-id="' + c.id + '" data-name="' + esc(c.name || d.anon) + '">' + d.reply + '</button>';
      item.innerHTML =
        '<div class="xd-c-meta"><b class="xd-c-name">' + esc(c.name || d.anon) + '</b>' +
        '<span>' + esc(parent) + relTime(c.ts, CUR_LANG) + '</span></div>' +
        '<div class="xd-c-body">' + miniMd(c.content) + '</div>' +
        replyBtn;
      const rb = item.querySelector('.xd-c-reply');
      if (rb) rb.addEventListener('click', function () {
        const replyBox = form.querySelector('input[data-for]') || document.createElement('input');
        replyBox.setAttribute('data-for', this.dataset.id);
        replyBox.placeholder = d.reply + ' ' + this.dataset.name + '\u2026';
        replyBox.style.display = 'block';
        wrap.querySelector('.xd-c-reply-active')?.remove();
        replyBox.className = 'xd-c-reply-active';
        form.insertBefore(replyBox, form.querySelector('textarea'));
        replyBox.focus();
      });
      return item;
    }

    function render(arr) {
      list.innerHTML = '';
      if (!arr.length) { list.innerHTML = '<li class="xd-c-empty">' + d.c_empty + '</li>'; total.textContent = ''; return; }
      total.textContent = arr.length;
      const top = arr.filter(c => !c.parent);
      const kids = arr.filter(c => c.parent);
      top.forEach(c => {
        list.appendChild(li(c, false));
        kids.filter(k => k.parent === c.id).forEach(k => list.appendChild(li(k, true)));
      });
    }

    function load() {
      fetch(EXTEND.comment_api + '?post=' + encodeURIComponent(POST_SLUG))
        .then(r => { if (r.ok !== true) throw new Error('http ' + r.status); return r.json(); })
        .then(arr => render(Array.isArray(arr) ? arr : []))
        .catch(() => {
          list.innerHTML = '<li class="xd-c-empty">' + d.c_loading + '（' + EXTEND.comment_api + '?post=' + encodeURIComponent(POST_SLUG) + '）</li>';
          total.textContent = '';
        });
    }
    load();

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const replyFor = form.querySelector('input[data-for]');
      const parent = replyFor ? parseInt(replyFor.dataset.for, 10) : null;
      const body = {
        post: POST_SLUG,
        name: form.cname.value.trim(),
        content: form.cbody.value.trim(),
        parent: parent || undefined,
      };
      if (!body.content) return;
      try { localStorage.setItem('xd-cname', body.name || ''); } catch (err) {}
      const btn = form.querySelector('.xd-c-submit');
      btn.disabled = true; btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> ' + d.c_sending;
      try {
        const r = await fetch(EXTEND.comment_api, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        let j = {};
        try { j = await r.json(); } catch (err) {}
        if (j && j.ok) { form.cbody.value = ''; replyFor?.remove(); load(); }
        else alert((j && j.error) || d.c_err);
      } catch (_) { alert(d.net_err); }
      btn.disabled = false; btn.innerHTML = '<i class="fa fa-paper-plane"></i> ' + d.c_send;
    });
  }

  // ============ 4) 分享重做（替换 Next 的 share 块）============
  function initShare() {
    const shareLinks = document.querySelector('.post-share-links');
    const bar = document.querySelector('.post-reward, .post .post-linkedin, .post-footer');
    if (!bar && !shareLinks) return;
    const d = T();
    const title = document.querySelector('.post-title')?.textContent?.trim() || document.title;
    const url = location.href;
    const host = shareLinks ? shareLinks.parentElement : (bar || document.querySelector('[itemprop="articleBody"]')?.parentElement || document.body);
    const wrap = document.createElement('div');
    wrap.className = 'xd-share';
    wrap.innerHTML =
      '<div class="xd-share-row">' +
      '  <button type="button" class="xd-s-item" data-xd-s="copy"><i class="fa fa-link"></i><span class="xd-label">' + d.copy + '</span></button>' +
      '  <button type="button" class="xd-s-item" data-xd-s="wechat"><i class="fa fa-weixin"></i><span class="xd-label">' + d.wechat + '</span></button>' +
      '  <button type="button" class="xd-s-item" data-xd-s="weibo"><i class="fa fa-weibo"></i><span class="xd-label">' + d.weibo + '</span></button>' +
      '  <button type="button" class="xd-s-item" data-xd-s="qq"><i class="fa fa-qq"></i><span class="xd-label">' + d.qq + '</span></button>' +
      '</div>' +
      '<div class="xd-share-qrcode" hidden></div>';
    host.appendChild(wrap);
    if (shareLinks) shareLinks.remove();

    wrap.querySelector('[data-xd-s="copy"]').addEventListener('click', async function () {
      const btn = this;
      try {
        await navigator.clipboard.writeText(url);
        btn.querySelector('.xd-label').textContent = d.copy_ok;
        setTimeout(() => { btn.querySelector('.xd-label').textContent = d.copy; }, 1500);
      } catch (e) { prompt('Copy', url); }
    });
    wrap.querySelector('[data-xd-s="wechat"]').addEventListener('click', function () {
      const box = wrap.querySelector('.xd-share-qrcode');
      if (!box.hidden) { box.hidden = true; return; }
      const hint = CUR_LANG === 'en' ? 'Scan or screenshot' : '\u957f\u6309\u6216\u622a\u56fe\u626b\u7801';
      box.innerHTML = '<img src="https://api.qrserver.com/v1/create-qr-code/?size=180&data=' + encodeURIComponent(url) + '" alt="QR"> ' + hint;
      box.hidden = false;
    });
    const open = s => window.open(s, '_blank', 'width=560,height=420');
    wrap.querySelector('[data-xd-s="weibo"]').addEventListener('click', () =>
      open('https://service.weibo.com/share/share.php?url=' + encodeURIComponent(url) + '&title=' + encodeURIComponent(title)));
    wrap.querySelector('[data-xd-s="qq"]').addEventListener('click', () =>
      open('https://connect.qq.com/widget/shareqq/index.html?url=' + encodeURIComponent(url) + '&title=' + encodeURIComponent(title)));
  }

  // ============ 5) UI 层中英切换（不翻译文章正文）============
  function applyUiText() {
    const d = T();
    const swap = (sel, key) => { const el = document.querySelector(sel); if (el) el.textContent = d[key]; };
    swap('.site-title', 'site_title');
    swap('.site-subtitle', 'site_sub');
    document.querySelectorAll('.menu-item').forEach(item => {
      const a = item.querySelector('a'); if (!a) return;
      const t = a.textContent.trim();
      const map = { '\u9996\u9875': 'home', Home: 'home', '\u5f52\u6863': 'archives', Archives: 'archives',
                    '\u5206\u7c7b': 'categories', Categories: 'categories',
                    '\u7ba1\u7406\u53f0': 'admin', admin: 'admin', Admin: 'admin' };
      if (map[t]) a.textContent = d[map[t]];
    });
    document.querySelectorAll('[data-xd="ra"] span').forEach(e => e.textContent = d.read);
    document.querySelectorAll('[data-xd="ras"] span').forEach(e => e.textContent = d.stop);
    document.querySelectorAll('[data-xd="like"] span').forEach(e => e.textContent = d.like);
    document.querySelectorAll('[data-xd="love"] span').forEach(e => e.textContent = d.love);
    document.querySelectorAll('.post-nav-caps .post-nav-caption, .post-nav-caption').forEach(e => {
      if (e.textContent.includes('\u524d')) e.textContent = d.prev;
      else if (e.textContent.includes('\u540e')) e.textContent = d.next;
    });
    document.querySelectorAll('.xd-c-title span').forEach(e => e.textContent = d.comments);
    document.querySelectorAll('.xd-cat-bar-label').forEach(e => e.textContent = d.cat_by_hot);
  }

  // 语言切换按钮：挂在站点概览侧栏（#hot-categories-widget / .site-overview-wrap），
  // 找不到就挂页脚；任何页面都有入口
  function mountLangToggle() {
    let host = document.querySelector('#hot-categories-widget') ||
               document.querySelector('.site-overview-wrap') ||
               document.querySelector('.footer-inner') ||
               document.querySelector('.footer') ||
               document.body;
    let btn = host.querySelector('.xd-lang-btn');
    if (!btn) {
      const div = document.createElement('div');
      div.className = 'xd-lang';
      host.appendChild(div);
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'xd-lang-btn';
      div.appendChild(btn);
      btn.addEventListener('click', () => {
        localStorage.setItem('xd-ui-lang', CUR_LANG === 'zh' ? 'en' : 'zh');
        location.reload();
      });
    }
    const label = CUR_LANG === 'zh' ? '\u4e2d\u6587' : 'EN';
    btn.title = CUR_LANG === 'zh' ? 'Switch UI to English' : '\u5207\u6362\u4e3a\u4e2d\u6587';
    btn.innerHTML = '<i class="fa fa-language"></i><span>' + label + '</span>';
  }

  // ============ 6) 首页分类热度条（读 popularity.json）============
  async function initHotCatBar() {
    if (!location.pathname.endsWith('/') && !/^\/en\/?$/.test(location.pathname)) return;
    let data;
    try { data = await (await fetch('/data/popularity.json')).json(); } catch (e) { return; }
    const cats = (data.cats || []).filter(c => c && c.name).slice(0, 8);
    if (!cats.length) return;
    const d = T();
    const main = document.querySelector('.content, .main-inner, main, .row') || document.body;
    const bar = document.createElement('div');
    bar.className = 'xd-cat-bar';
    bar.innerHTML = '<div class="xd-cat-bar-inner">' +
      '<span class="xd-cat-bar-label">' + d.cat_by_hot + '</span>' +
      cats.map(c => '<a class="xd-cat" href="' + esc('/categories/' + encodeURIComponent(c.path) + '/') + '" title="' + c.posts + ' ' + d.posts + ' \u00b7 ' + d.hot + ' ' + c.hot + '">' +
        '<i class="fa fa-' + (c.hot > 40 ? 'fire' : 'folder-o') + '"></i>' +
        '<b>' + esc(c.name) + '</b><em>' + c.posts + '</em></a>').join('') +
      '</div>';
    main.insertBefore(bar, main.querySelector('.post-block, .home, .post-list') || null);
  }

  // ============ 挂载 ============
  function boot() {
    mountLangToggle();
    applyUiText();
    initShare();
    if (POST_SLUG) { initReadAloud(); initFeedback(); initComments(); }
    initHotCatBar();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
