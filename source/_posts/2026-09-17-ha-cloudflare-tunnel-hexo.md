---
title: 家用虚拟机外网访问收口：HA、博客与 Cloudflare Tunnel 一次打通
date: 2026-09-17 00:00:00 +08:00
categories: [网络]
tags: [Cloudflare, Hexo, Home-Assistant, Tunnels]
---

<blockquote>
<p>上一篇聊了 Cloudflare Tunnel 解决面板暴露给外网的问题；这篇是收口篇：把<br>Home Assistant 和博客也挂到同一个隧道上，顺带踩坑记录一个 HA 2026.8 的<br>“反直觉”变更——http 配置从 YAML 迁到了 UI，写错位置会拖垮整个站点。</p>
</blockquote>
<h2 id="TL-DR">TL;DR</h2><ul>
<li><code>HA.dingdao.me</code> &#x2F; <code>blog.dingdao.me</code> 走 Cloudflare Tunnel 外网访问，源站分别是<br><code>http://localhost:8123</code> 和 <code>http://localhost:80</code>（openresty），全程零入站端口。</li>
<li>博客用 Hexo（Node 生成静态 HTML）+ openresty 托管，4G 内存的机器上零额外常驻。</li>
<li>最大的坑不在隧道本身，而在 HA 的 http 配置位置：新 schema 校验导致<br><code>http</code> 组件启动失败，连锁拖垮几十个集成，所有带 <code>X-Forwarded-For</code> 的请求被拒 400。</li>
</ul>
<h2 id="一、拓扑">一、拓扑</h2><figure class="highlight plaintext"><table><tr><td class="gutter"><pre><span class="line">1</span><br><span class="line">2</span><br><span class="line">3</span><br><span class="line">4</span><br><span class="line">5</span><br></pre></td><td class="code"><pre><span class="line">手机/外网 → Cloudflare Edge (blog/HA.dingdao.me)</span><br><span class="line">             → cloudflared (VM 内 systemd 服务，出站 QUIC 连 CF 边缘)</span><br><span class="line">             → ingress 规则（CF 后台配置，tunnel 拉取）：</span><br><span class="line">                 blog.dingdao.me  → http://localhost:80    (openresty，Hexo 静态文件)</span><br><span class="line">                 HA.dingdao.me    → http://localhost:8123  (Home Assistant 容器)</span><br></pre></td></tr></table></figure>

<p>cloudflared 用 token 认证跑在 systemd（<code>cloudflared.service</code>），ingress 规则存在<br>CF 后台，本地改 hostname 后约 10 秒内 tunnel 会拉取新配置（日志里能看到<br><code>Updated to new configuration version=N</code>）——改完规则一定要看版本号变了再测，<br>之前测到 404 其实就是规则还没同步下来。</p>
<h2 id="二、HA-的坑：http-配置搬家了">二、HA 的坑：http 配置搬家了</h2><p>症状：HA 容器本地 8123 正常 200，外网经 tunnel 一律 400 Bad Request，<br>日志里刷：</p>
<figure class="highlight plaintext"><table><tr><td class="gutter"><pre><span class="line">1</span><br><span class="line">2</span><br><span class="line">3</span><br></pre></td><td class="code"><pre><span class="line">ERROR [homeassistant.components.http.forwarded]</span><br><span class="line">A request from a reverse proxy was received from 127.0.0.1,</span><br><span class="line">but your HTTP integration is not set-up for reverse proxies</span><br></pre></td></tr></table></figure>

<p>第一反应是”没配 trusted_proxies”，往 <code>configuration.yaml</code> 里加 <code>http:</code> 块——<br>结果更糟：整个 <code>http</code> 组件启动失败，连带 <code>auth</code>&#x2F;<code>onboarding</code>&#x2F;<code>api</code> 等几十个<br>集成全挂，错误是：</p>
<figure class="highlight plaintext"><table><tr><td class="gutter"><pre><span class="line">1</span><br><span class="line">2</span><br><span class="line">3</span><br></pre></td><td class="code"><pre><span class="line">Invalid config for &#x27;http&#x27;: some but not all values in the same group of</span><br><span class="line">inclusion &#x27;proxy&#x27; &#x27;http-&gt;&lt;proxy&gt;&#x27;, got None</span><br><span class="line">Invalid config for &#x27;http&#x27;: &#x27;use_x_forwarded_for_header&#x27; is an invalid option</span><br></pre></td></tr></table></figure>

<p>根因：HA 2026.8 起 <code>http</code> 配置从 <code>configuration.yaml</code> 迁移到 UI，<br>存进 <code>.storage/http</code>（JSON）。YAML 里残留的 <code>http:</code> 块走新 schema 校验，<br>单写 <code>trusted_proxies</code> 属于”部分填写必选项组”，直接判定无效配置。</p>
<p>正确做法：</p>
<ol>
<li><p>删掉 <code>configuration.yaml</code> 里的 <code>http:</code> 块；</p>
</li>
<li><p>改 <code>.storage/http</code> 的 <code>stable</code> 字段：</p>
<figure class="highlight json"><table><tr><td class="gutter"><pre><span class="line">1</span><br><span class="line">2</span><br></pre></td><td class="code"><pre><span class="line"><span class="attr">&quot;use_x_forwarded_for&quot;</span><span class="punctuation">:</span> <span class="literal"><span class="keyword">true</span></span><span class="punctuation">,</span></span><br><span class="line"><span class="attr">&quot;trusted_proxies&quot;</span><span class="punctuation">:</span> <span class="punctuation">[</span><span class="string">&quot;127.0.0.1/32&quot;</span><span class="punctuation">]</span></span><br></pre></td></tr></table></figure></li>
<li><p>重启 HA。</p>
</li>
</ol>
<p>注意：直接改 <code>.storage/http</code> 绕过了 UI 的”5 分钟确认窗口”，<br>HA 会在 UI 里挂一个 pending 状态等确认，建议之后进<br>设置 &gt; 系统 &gt; 网络 &gt; HTTP 服务器 保存一次，否则可能被回滚。</p>
<h2 id="三、Hexo-openresty-托管博客">三、Hexo + openresty 托管博客</h2><p>4G 内存的机器不适合跑 WordPress&#x2F;PHP 那套，Hexo 构建后是纯静态文件，<br>openresty 直接托管，运行期零额外内存占用：</p>
<figure class="highlight bash"><table><tr><td class="gutter"><pre><span class="line">1</span><br><span class="line">2</span><br><span class="line">3</span><br><span class="line">4</span><br><span class="line">5</span><br><span class="line">6</span><br></pre></td><td class="code"><pre><span class="line"><span class="built_in">cd</span> ~/blog</span><br><span class="line">npx hexo init . &amp;&amp; npm install</span><br><span class="line">npx hexo new <span class="string">&quot;文章标题&quot;</span>     <span class="comment"># 在 source/_posts/ 下生成 md</span></span><br><span class="line">npx hexo generate          <span class="comment"># 重新生成 public/</span></span><br><span class="line"><span class="comment"># 同步到 openresty（宿主 /opt/1panel 是 root 所有，经容器操作）：</span></span><br><span class="line">docker <span class="built_in">cp</span> ~/blog/public 1Panel-openresty-hK6e:/www/blog-public</span><br></pre></td></tr></table></figure>

<p>站点配置（openresty 容器内 <code>conf/default/blog.dingdao.me.conf</code>）：</p>
<figure class="highlight nginx"><table><tr><td class="gutter"><pre><span class="line">1</span><br><span class="line">2</span><br><span class="line">3</span><br><span class="line">4</span><br><span class="line">5</span><br><span class="line">6</span><br></pre></td><td class="code"><pre><span class="line"><span class="section">server</span> &#123;</span><br><span class="line">    <span class="attribute">listen</span> <span class="number">80</span>;</span><br><span class="line">    <span class="attribute">server_name</span> blog.dingdao.me;</span><br><span class="line">    <span class="attribute">root</span> /www/blog-public;</span><br><span class="line">    <span class="section">location</span> / &#123; <span class="attribute">index</span> index.html; <span class="attribute">try_files</span> <span class="variable">$uri</span> <span class="variable">$uri</span>/ /index.html; &#125;</span><br><span class="line">&#125;</span><br></pre></td></tr></table></figure>

<p>改完 <code>nginx -t</code> 再 <code>nginx -s reload</code>，外网即可访问。</p>
<h2 id="四、踩坑清单（增量）">四、踩坑清单（增量）</h2><table>
<thead>
<tr>
<th>坑</th>
<th>症状</th>
<th>解法</th>
</tr>
</thead>
<tbody><tr>
<td>CF 后台刚改 ingress 就测</td>
<td>404 &#x2F; 400，其实规则没生效</td>
<td>看 cloudflared 日志 <code>Updated to new configuration version=N</code> 再测</td>
</tr>
<tr>
<td>HA YAML 里加 <code>http:</code> 块（2026.8+）</td>
<td>http 组件 setup 失败，全集成连锁挂</td>
<td>删 YAML 块，改 <code>.storage/http</code></td>
</tr>
<tr>
<td>误以为 <code>use_x_forwarded_for_header</code> 是字段名</td>
<td>schema 校验报 invalid option</td>
<td>实际字段是 <code>use_x_forwarded_for</code></td>
</tr>
<tr>
<td>openresty 容器内 404 页带 CF challenge script</td>
<td>以为 CF 在拦，实际是 nginx 的 404 兜底页</td>
<td>看响应体里 <code>nginx</code> 字样即可判断 404 来自源站</td>
</tr>
</tbody></table>
<h2 id="五、一句话总结">五、一句话总结</h2><blockquote>
<p>NAT 后的家用虚拟机，”被访问”只能靠服务主动出站的那根隧道；<br>而隧道通了之后，真正的坑往往在应用层——HA 配置搬家、规则同步延迟，<br>都藏在”看起来隧道没问题”的假象后面。</p>
</blockquote>
<hr>
<p><em>作者：小道 · 环境：kaliserver（Hyper-V &#x2F; Ubuntu 26.04）· 2026-09-17</em><br><em>关联阅读：《我推翻了上一篇的一半结论：NAT 后的虚拟机对外提供服务，答案是 Cloudflare Tunnel》</em></p>
