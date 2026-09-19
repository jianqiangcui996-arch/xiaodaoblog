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
  function relTime(iso) {
    const d = new Date(iso); if (isNaN(d)) return '';
    const s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 60) return '刚刚'; if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
    if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
    if (s < 2592000) return Math.floor(s / 86400) + ' 天前';
    return d.toLocaleDateString('zh-CN');
  }

  // ============ 1) 语音朗读（详情页）============
  function initReadAloud() {
    if (!('speechSynthesis' in window) || !POST_SLUG) return;
    const entry = document.querySelector('[itemprop="articleBody"]');
    if (!entry) return;
    const host = entry.closest('.post-inner, .post') || entry.parentElement;
    const bar = document.createElement('div');
    bar.className = 'xd-tools xd-read-aloud';
    bar.innerHTML =
      '<button type="button" class="xd-tool" data-xd="ra" title="语音朗读"><i class="fa fa-volume-up"></i><span>朗读</span></button>' +
      '<button type="button" class="xd-tool" data-xd="ras" title="停止"><i class="fa fa-stop"></i><span>停止</span></button>' +
      '<label class="xd-rate" title="语速"><input type="range" min="0.6" max="1.6" step="0.1" value="1"></label>';
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
    bar.querySelector('[data-xd="ras"]').addEventListener('click', () => { speechSynthesis.cancel(); active = false; bar.querySelector('[data-xd="ra"]').classList.remove('on'); });
    bar.querySelector('input[type=range]').addEventListener('input', e => { rate = parseFloat(e.target.value); });
  }

  // ============ 2) 点赞（详情页）============
  function initFeedback() {
    if (!POST_SLUG || !EXTEND.feedback_api) return;
    const host = document.querySelector('.post-inner, .post') || document.body;
    const row = document.createElement('div');
    row.className = 'xd-tools xd-feedback';
    row.innerHTML =
      '<button type="button" class="xd-tool" data-xd="like"><i class="fa fa-thumbs-o-up"></i><span>喜欢</span><b class="xd-count"></b></button>' +
      '<button type="button" class="xd-tool" data-xd="love"><i class="fa fa-heart-o"></i><span>推荐</span><b class="xd-count"></b></button>';
    const entry = host.querySelector('[itemprop="articleBody"]');
    entry ? entry.parentElement.insertBefore(row, entry) : host.insertBefore(row, host.firstChild);
    const LS = 'xd-fb-' + POST_SLUG;
    const done = JSON.parse(localStorage.getItem(LS) || '{}');

    function markOn(btn, on) { btn.classList.toggle('on', on); }
    markOn(row.querySelector('[data-xd="like"]'), done.like);
    markOn(row.querySelector('[data-xd="love"]'), done.love);

    fetch(EXTEND.feedback_api + '/counts?post=' + encodeURIComponent(POST_SLUG))
      .then(r => r.json())
      .then(j => {
        row.querySelector('[data-xd="like"] .xd-count').textContent = j.like || 0;
        row.querySelector('[data-xd="love"] .xd-count').textContent = j.love || 0;
      }).catch(() => {});

    ['like', 'love'].forEach(t => {
      row.querySelector('[data-xd="' + t + '"]').addEventListener('click', async function () {
        if (done[t]) return;
        try {
          const r = await fetch(EXTEND.feedback_api, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ post: POST_SLUG, type: t }),
          });
          const j = await r.json();
          if (j && j.ok) {
            done[t] = true; localStorage.setItem(LS, JSON.stringify(done));
            markOn(this, true);
            this.querySelector('.xd-count').textContent = j.count;
          }
        } catch (e) {}
      });
    });
  }

  // ============ 3) 评论（详情页）============
  function initComments() {
    if (!POST_SLUG || !EXTEND.comment_api) return;
    const host = document.querySelector('.post-inner, .post');
    if (!host) return;
    const wrap = document.createElement('div');
    wrap.className = 'xd-comments';
    wrap.innerHTML =
      '<h4 class="xd-c-title"><i class="fa fa-comments-o"></i> 评论 <b class="xd-c-total"></b></h4>' +
      '<form class="xd-c-form">' +
      '  <input type="text" name="cname" placeholder="昵称（选填）" maxlength="32" value="' + esc(localStorage.getItem('xd-cname') || '') + '">' +
      '  <textarea name="cbody" rows="3" placeholder="说点什么…（支持 **加粗**、`代码`、链接）" maxlength="2000" required></textarea>' +
      '  <div class="xd-c-form-foot">' +
      '    <span class="xd-c-hint">提交后即刻显示，无需审核</span>' +
      '    <button type="submit" class="btn xd-c-submit"><i class="fa fa-paper-plane"></i> 发表</button>' +
      '  </div>' +
      '</form>' +
      '<ul class="xd-c-list"></ul>';
    host.appendChild(wrap);

    const list = wrap.querySelector('.xd-c-list');
    const total = wrap.querySelector('.xd-c-total');
    const form = wrap.querySelector('form');

    function li(c, reply) {
      const li = document.createElement('li');
      li.className = 'xd-c-item' + (reply ? ' reply' : '');
      const parent = reply ? '<i class="fa fa-arrow-left"></i> 回复 ' : '';
      li.innerHTML =
        '<div class="xd-c-meta"><b class="xd-c-name">' + esc(c.name || '匿名') + '</b>' +
        '<span>' + esc(parent) + relTime(c.ts) + '</span></div>' +
        '<div class="xd-c-body">' + miniMd(c.content) + '</div>' +
        (reply ? '' : '<button type="button" class="xd-c-reply" data-id="' + c.id + '" data-name="' + esc(c.name || '匿名') + '">回复</button>');
      li.querySelector('.xd-c-reply').addEventListener('click', function () {
        const replyBox = form.querySelector('input[data-for]') || document.createElement('input');
        replyBox.setAttribute('data-for', this.dataset.id);
        replyBox.placeholder = '回复 ' + this.dataset.name + '…';
        replyBox.style.display = 'block';
        wrap.querySelector('.xd-c-reply-active')?.remove();
        replyBox.className = 'xd-c-reply-active';
        form.insertBefore(replyBox, form.querySelector('textarea'));
        replyBox.focus();
      });
      return li;
    }

    function render(arr) {
      list.innerHTML = '';
      if (!arr.length) { list.innerHTML = '<li class="xd-c-empty">还没有评论，来抢沙发</li>'; total.textContent = '0'; return; }
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
        .then(r => r.json()).then(render).catch(() => { list.innerHTML = '<li class="xd-c-empty">加载失败</li>'; });
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
      localStorage.setItem('xd-cname', body.name || '');
      const btn = form.querySelector('.xd-c-submit');
      btn.disabled = true; btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> 提交中…';
      try {
        const r = await fetch(EXTEND.comment_api, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const j = await r.json();
        if (j && j.ok) { form.cbody.value = ''; replyFor?.remove(); load(); }
        else alert(j.error || '提交失败');
      } catch (_) { alert('网络错误'); }
      btn.disabled = false; btn.innerHTML = '<i class="fa fa-paper-plane"></i> 发表';
    });
  }

  // ============ 4) 分享重做（替换 Next 的 share 块）============
  function initShare() {
    const shareLinks = document.querySelector('.post-share-links');
    const bar = document.querySelector('.post-reward, .post .post-linkedin, .post-footer');
    if (!bar && !shareLinks) return;
    const title = document.querySelector('.post-title')?.textContent?.trim() || document.title;
    const url = location.href;
    const host = shareLinks ? shareLinks.parentElement : (bar || document.querySelector('[itemprop="articleBody"]')?.parentElement || document.body);
    const wrap = document.createElement('div');
    wrap.className = 'xd-share';
    wrap.innerHTML =
      '<div class="xd-share-row">' +
      '  <button type="button" class="xd-s-item" data-xd-s="copy"><i class="fa fa-link"></i>复制链接</button>' +
      '  <button type="button" class="xd-s-item" data-xd-s="wechat"><i class="fa fa-weixin"></i>微信</button>' +
      '  <button type="button" class="xd-s-item" data-xd-s="weibo"><i class="fa fa-weibo"></i>微博</button>' +
      '  <button type="button" class="xd-s-item" data-xd-s="qq"><i class="fa fa-qq"></i>QQ</button>' +
      '</div>' +
      '<div class="xd-share-qrcode" hidden></div>';
    host.appendChild(wrap);
    if (shareLinks) shareLinks.remove();

    wrap.querySelector('[data-xd-s="copy"]').addEventListener('click', async function () {
      try {
        await navigator.clipboard.writeText(url);
        this.innerHTML = '<i class="fa fa-check"></i>已复制';
        setTimeout(() => { this.innerHTML = '<i class="fa fa-link"></i>复制链接'; }, 1500);
      } catch (e) { prompt('请手动复制', url); }
    });
    wrap.querySelector('[data-xd-s="wechat"]').addEventListener('click', function () {
      const box = wrap.querySelector('.xd-share-qrcode');
      if (!box.hidden) { box.hidden = true; return; }
      box.innerHTML = '<img src="https://api.qrserver.com/v1/create-qr-code/?size=180&data=' + encodeURIComponent(url) + '" alt="QR"> 长按或截图扫码';
      box.hidden = false;
    });
    const open = s => window.open(s, '_blank', 'width=560,height=420');
    wrap.querySelector('[data-xd-s="weibo"]').addEventListener('click', () =>
      open('https://service.weibo.com/share/share.php?url=' + encodeURIComponent(url) + '&title=' + encodeURIComponent(title)));
    wrap.querySelector('[data-xd-s="qq"]').addEventListener('click', () =>
      open('https://connect.qq.com/widget/shareqq/index.html?url=' + encodeURIComponent(url) + '&title=' + encodeURIComponent(title)));
  }

  // ============ 5) UI 层中英切换（不翻译文章正文）============
  const UI_DICT = {
    zh: {
      home: '首页', archives: '归档', categories: '分类', admin: '管理台',
      search: '搜索', site_title: '小道的技术笔记', site_sub: '记录折腾、认知与闭环',
      read: '朗读', stop: '停止', like: '喜欢', love: '推荐', comments: '评论',
      prev: '上一篇', next: '后一篇', footer: 'Powered by Hexo', copy: '复制链接',
      wechat: '微信', weibo: '微博', qq: 'QQ', share: '分享',
    },
    en: {
      home: 'Home', archives: 'Archives', categories: 'Categories', admin: 'Admin',
      search: 'Search', site_title: "Xiaodao's Notes", site_sub: 'Tinkering, cognition & closed loops',
      read: 'Read', stop: 'Stop', like: 'Like', love: 'Love', comments: 'Comments',
      prev: 'Prev', next: 'Next', footer: 'Powered by Hexo', copy: 'Copy Link',
      wechat: 'WeChat', weibo: 'Weibo', qq: 'QQ', share: 'Share',
    },
  };
  function initUiI18n() {
    const lang = localStorage.getItem('xd-ui-lang') || 'zh';
    const d = UI_DICT[lang] || UI_DICT.zh;
    const swap = (sel, key) => { const el = document.querySelector(sel); if (el) el.textContent = d[key]; };
    // 站点标题 / 副标题
    swap('.site-title', 'site_title');
    swap('.site-subtitle', 'site_sub');
    // 菜单项
    document.querySelectorAll('.menu-item').forEach(item => {
      const a = item.querySelector('a'); if (!a) return;
      const t = a.textContent.trim();
      const map = { '首页': 'home', 'Home': 'home', '归档': 'archives', 'Archives': 'archives', '分类': 'categories', 'Categories': 'categories', '管理台': 'admin', 'Admin': 'admin' };
      if (map[t]) a.textContent = d[map[t]];
    });
    // 自定义工具条
    document.querySelectorAll('[data-xd="ra"] span').forEach(e => e.textContent = d.read);
    document.querySelectorAll('[data-xd="ras"] span').forEach(e => e.textContent = d.stop);
    document.querySelectorAll('[data-xd="like"] span').forEach(e => e.textContent = d.like);
    document.querySelectorAll('[data-xd="love"] span').forEach(e => e.textContent = d.like === '喜欢' ? d.love : d.love);
    document.querySelectorAll('[data-xd-s="copy"]').forEach(e => e.lastChild.textContent = d.copy);
    document.querySelectorAll('[data-xd-s="wechat"] i').forEach(e => e.nextSibling ? (e.nextSibling.textContent = d.wechat) : null);
    document.querySelectorAll('[data-xd-s="weibo"] i').forEach(e => e.nextSibling && (e.nextSibling.textContent = d.weibo));
    document.querySelectorAll('[data-xd-s="qq"] i').forEach(e => e.nextSibling && (e.nextSibling.textContent = d.qq));
    // 后/前一篇
    document.querySelectorAll('.post-nav-caps .post-nav-caption, .post-nav-caption').forEach(e => {
      if (e.textContent.includes('前')) e.textContent = d.prev; else if (e.textContent.includes('后')) e.textContent = d.next;
    });
    // 评论标题
    document.querySelectorAll('.xd-c-title').forEach(e => e.lastChild.textContent = ' ' + d.comments + ' ');

    // 语言切换器（复用 Next 的 .languages，若启用；否则自建）
    let sel = document.querySelector('.lang-select');
    if (!sel) {
      const foot = document.querySelector('.footer-inner, .footer') || document.body;
      const div = document.createElement('div');
      div.className = 'xd-lang';
      div.innerHTML = '<button type="button" class="xd-lang-btn" title="切换语言 UI"><i class="fa fa-language"></i><span>' + (lang === 'zh' ? '中文' : 'EN') + '</span></button>';
      foot.insertBefore(div, foot.firstChild);
      sel = document.createElement('input'); sel.type = 'hidden';
      foot.appendChild(sel);
      div.querySelector('.xd-lang-btn').addEventListener('click', () => {
        localStorage.setItem('xd-ui-lang', lang === 'zh' ? 'en' : 'zh');
        location.reload();
      });
      return;
    }
    sel.value = lang;
    sel.addEventListener('change', e => {
      localStorage.setItem('xd-ui-lang', e.target.value);
      location.reload();
    });
  }

  // ============ 6) 首页分类热度条（读 popularity.json）============
  async function initHotCatBar() {
    if (!location.pathname.endsWith('/') && !/^\/en\/?$/.test(location.pathname)) return;
    let data;
    try { data = await (await fetch('/data/popularity.json')).json(); } catch (e) { return; }
    const cats = (data.cats || []).filter(c => c && c.name).slice(0, 8);
    if (!cats.length) return;
    const main = document.querySelector('.content, .main-inner, main, .row') || document.body;
    const bar = document.createElement('div');
    bar.className = 'xd-cat-bar';
    bar.innerHTML = '<div class="xd-cat-bar-inner">' +
      '<span class="xd-cat-bar-label">分类 · 按热度</span>' +
      cats.map(c => '<a class="xd-cat" href="' + esc('/categories/' + encodeURIComponent(c.path) + '/') + '" title="' + c.posts + ' 篇 · 热度 ' + c.hot + '">' +
        '<i class="fa fa-' + (c.hot > 40 ? 'fire' : 'folder-o') + '"></i>' +
        '<b>' + esc(c.name) + '</b><em>' + c.posts + '</em></a>').join('') +
      '</div>';
    main.insertBefore(bar, main.querySelector('.post-block, .home, .post-list') || null);
  }

  // ============ 挂载 ============
  function boot() {
    initUiI18n();
    initShare();
    if (POST_SLUG) { initReadAloud(); initFeedback(); initComments(); }
    initHotCatBar();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
