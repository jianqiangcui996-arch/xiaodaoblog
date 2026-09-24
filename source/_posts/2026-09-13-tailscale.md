---
title: 在家用宽带"封端口"时代，我如何用 Tailscale 搞定跨网络远程开发
date: 2026-09-13
categories: [网络]
tags: [SSH, Tailscale, 远程开发]
---

<blockquote>
<p>一个”Windows Hyper-V VM + Cloudflare DDNS + 端口转发”踩坑实录，<br>以及为什么最后答案是一行 <code>tailscale up</code>。</p>
<p>（本文已对账号、IP、tailnet 名等敏感信息脱敏，仅保留技术结构。）</p>
</blockquote>
<h2 id="TL-DR">TL;DR</h2><p>我有一台家用宽带（动态公网 IP）里的 Hyper-V Ubuntu 虚拟机，想从<strong>手机热点、<br>公司、任何网络</strong>随时连进去开发。我花了半天搭 DDNS + 三层端口转发，<br>结果外网连不进来——运营商在封家用宽带的入站端口。最后用 <strong>Tailscale</strong><br>一条命令搞定，彻底绕开 DDNS、端口转发、运营商封锁。</p>
<p>下面是完整踩坑和最终方案。</p>
<h2 id="一、目标">一、目标</h2><ul>
<li>家里：Windows 宿主机跑 Hyper-V Ubuntu VM，静态内网 IP <code>172.x.x.x</code></li>
<li>手机 &#x2F; 任意网络：能随时 SSH 进 Ubuntu 开发</li>
<li>要求：IP 怎么变都不用管，最好不用开公网端口</li>
</ul>
<h2 id="二、第一套方案：DDNS-端口转发（为什么走不通）">二、第一套方案：DDNS + 端口转发（为什么走不通）</h2><h3 id="2-1-架构">2.1 架构</h3><figure class="highlight plaintext"><table><tr><td class="gutter"><pre><span class="line">1</span><br></pre></td><td class="code"><pre><span class="line">互联网 → 光猫/路由器(动态公网IP) → Windows(192.168.x.7) → portproxy 2222 → Ubuntu VM(172.x.x.x:22)</span><br></pre></td></tr></table></figure>

<p>需要打通三层：</p>
<ol>
<li><strong>Cloudflare DDNS</strong>：把 <code>devbox.dingdao.me</code> 自动指向当前公网出口 IP</li>
<li><strong>路由器端口转发</strong>：外部 <code>2222 → 192.168.x.7:22</code></li>
<li><strong>Windows portproxy</strong>：<code>2222 → 172.x.x.x:22</code> + 防火墙放行</li>
</ol>
<h3 id="2-2-我写的-DDNS-脚本（带容错）">2.2 我写的 DDNS 脚本（带容错）</h3><figure class="highlight bash"><table><tr><td class="gutter"><pre><span class="line">1</span><br><span class="line">2</span><br><span class="line">3</span><br><span class="line">4</span><br><span class="line">5</span><br><span class="line">6</span><br><span class="line">7</span><br><span class="line">8</span><br><span class="line">9</span><br><span class="line">10</span><br><span class="line">11</span><br><span class="line">12</span><br><span class="line">13</span><br><span class="line">14</span><br><span class="line">15</span><br><span class="line">16</span><br><span class="line">17</span><br></pre></td><td class="code"><pre><span class="line"><span class="meta">#!/usr/bin/env bash</span></span><br><span class="line"><span class="comment"># /usr/local/bin/cf-ddns.sh  (v2)</span></span><br><span class="line"><span class="built_in">set</span> -u</span><br><span class="line">CONF=/etc/cf-ddns.conf</span><br><span class="line">LAST_IP=/var/lib/cf-ddns/last_ip</span><br><span class="line">...</span><br><span class="line"><span class="comment"># 5 个 IP 源依次尝试，3 次重试；全部失败 → 保留 last_ip，绝不把 CF 记录写脏</span></span><br><span class="line"><span class="keyword">for</span> src <span class="keyword">in</span> <span class="string">&quot;https://api.ipify.org&quot;</span> <span class="string">&quot;https://ifconfig.me&quot;</span> ...; <span class="keyword">do</span></span><br><span class="line">    ip=$(<span class="built_in">timeout</span> 8 curl -4 -sS <span class="string">&quot;<span class="variable">$src</span>&quot;</span> 2&gt;/dev/null | <span class="built_in">tr</span> -d <span class="string">&#x27;[:space:]&#x27;</span>)</span><br><span class="line">    [[ <span class="string">&quot;<span class="variable">$ip</span>&quot;</span> =~ ^[0-9.]+$ ]] &amp;&amp; <span class="built_in">break</span></span><br><span class="line"><span class="keyword">done</span></span><br><span class="line">[[ -z <span class="string">&quot;<span class="variable">$ip</span>&quot;</span> ]] &amp;&amp; ip=$(<span class="built_in">cat</span> <span class="string">&quot;<span class="variable">$LAST_IP</span>&quot;</span> 2&gt;/dev/null)   <span class="comment"># 兜底</span></span><br><span class="line">[[ -z <span class="string">&quot;<span class="variable">$ip</span>&quot;</span> ]] &amp;&amp; &#123; <span class="built_in">echo</span> <span class="string">&quot;no ip, skip&quot;</span>; <span class="built_in">exit</span> 0; &#125;</span><br><span class="line">curl -sS -X PUT <span class="string">&quot;https://api.cloudflare.com/client/v4/zones/<span class="variable">$ZONE</span>/dns_records/<span class="variable">$RECORD</span>&quot;</span> \</span><br><span class="line">    -H <span class="string">&quot;Authorization: Bearer <span class="variable">$TOKEN</span>&quot;</span> -H <span class="string">&quot;Content-Type: application/json&quot;</span> \</span><br><span class="line">    -d <span class="string">&quot;&#123;\&quot;type\&quot;:\&quot;A\&quot;,\&quot;name\&quot;:\&quot;<span class="variable">$HOSTNAME</span>\&quot;,\&quot;content\&quot;:\&quot;<span class="variable">$ip</span>\&quot;&#125;&quot;</span></span><br><span class="line"><span class="built_in">echo</span> <span class="string">&quot;<span class="variable">$ip</span>&quot;</span> &gt; <span class="string">&quot;<span class="variable">$LAST_IP</span>&quot;</span></span><br></pre></td></tr></table></figure>

<p>systemd timer：开机 + 每 15 分钟跑一次。</p>
<p><strong>踩坑</strong>：我一开始把 Cloudflare 控制台里的 <strong>Account ID</strong> 当成 <strong>Zone ID</strong> 填进脚本，结果 API 404。后来用 API 自动解析出 <code>devbox.dingdao.me</code> 所属 zone 的真实 Zone ID，脚本里直接查 API，不再手填。</p>
<h3 id="2-3-为什么外网连不进来">2.3 为什么外网连不进来</h3><p>所有配置都对：</p>
<ul>
<li>✅ CF 记录 <code>devbox.dingdao.me → xx.xx.xx.xx</code>（当前公网出口 IP）</li>
<li>✅ 服务器公网出口 IP 就是那个 IP</li>
<li>✅ Windows portproxy <code>2222 → 172.x.x.x:22</code> 正确，LAN 段 <code>Test-NetConnection 192.168.x.7 -Port 2222</code> 通</li>
<li>✅ 手机有公网 IPv4（测试 <code>curl -4 https://ifconfig.me</code> 能拿到一个公网 v4，不是 IPv6-only）</li>
</ul>
<p>但<strong>外网 <code>xx.xx.xx.xx:2222</code> 始终 CLOSED</strong>。</p>
<p>排查结论：<strong>运营商在封家用宽带入站</strong>。家用宽带（尤其 PPPoE 拨号那层）<br>很多地区默认拒绝非 80&#x2F;443 的入站 TCP，甚至全端口拒绝。DDNS + 端口转发<br>这套在”运营商不封入站”的网络里是完美的，但在我家这堵墙前无能为力。</p>
<blockquote>
<p>这是国内家宽的老问题，不怪配置，怪物理链路。</p>
</blockquote>
<h2 id="三、最终方案：Tailscale（出站打洞，零入站端口）">三、最终方案：Tailscale（出站打洞，零入站端口）</h2><h3 id="3-1-为什么-Tailscale-能绕过这堵墙">3.1 为什么 Tailscale 能绕过这堵墙</h3><p>Tailscale 本质是 <strong>WireGuard + 出站打洞</strong>：</p>
<ul>
<li>每台机器主动<strong>向外</strong>连 Tailscale 的 Coordination Server（UDP 443）</li>
<li>两台机器之间通过打洞建立<strong>直接 P2P WireGuard 隧道</strong>（如果打洞失败，<br>退化为经 Tailscale 中转 relay，也不影响可用）</li>
<li>全程<strong>不需要任何入站端口</strong>，不需要 DDNS，不需要运营商放通</li>
</ul>
<p>对你的网络意味着：<strong>哪怕家用宽带入站全封，只要能出站（上网），<br>Tailscale 就能通。</strong></p>
<h3 id="3-2-三端落地（同一-Google-账号-→-同一-tailnet）">3.2 三端落地（同一 Google 账号 → 同一 tailnet）</h3><figure class="highlight plaintext"><table><tr><td class="gutter"><pre><span class="line">1</span><br><span class="line">2</span><br><span class="line">3</span><br><span class="line">4</span><br><span class="line">5</span><br><span class="line">6</span><br><span class="line">7</span><br><span class="line">8</span><br></pre></td><td class="code"><pre><span class="line">Ubuntu VM (Hyper-V)  +  Windows 宿主机  +  手机(Android/Termux)</span><br><span class="line">        \                     /                   /</span><br><span class="line">         \                   /                   /</span><br><span class="line">        ┌────────────────── 同一 tailnet (xxx) ─────────────────┐</span><br><span class="line">        │   100.123.x.x          100.113.x.x        100.98.x.x  │</span><br><span class="line">        │       Ubuntu  ←——⇄——→   Windows   ←——⇄——→   手机     │</span><br><span class="line">        │            (full mesh，任意两两直通)                  │</span><br><span class="line">        └────────────────────────────────────────────────────────┘</span><br></pre></td></tr></table></figure>

<p><strong>Ubuntu（服务器侧）</strong>：</p>
<figure class="highlight bash"><table><tr><td class="gutter"><pre><span class="line">1</span><br><span class="line">2</span><br><span class="line">3</span><br><span class="line">4</span><br></pre></td><td class="code"><pre><span class="line">curl -fsSL https://tailscale.com/install.sh | sh</span><br><span class="line"><span class="built_in">sudo</span> tailscale up --ssh --hostname=devbox</span><br><span class="line"><span class="comment"># 浏览器打开控制台给的链接授权</span></span><br><span class="line"><span class="comment"># 得到固定域名 devbox.&lt;tailnet&gt;.ts.net，稳定不变</span></span><br></pre></td></tr></table></figure>
<ul>
<li>开机自启（<code>systemctl enable tailscaled</code>）</li>
<li><code>--ssh</code> 开了 Tailscale 自带 SSH，<strong>免私钥直连</strong>（控制台自动分发公钥）</li>
</ul>
<p><strong>Windows（宿主机）</strong>：<code>winget install Tailscale.Tailscale</code> 或官网安装包，<br>同账号登录。</p>
<p><strong>手机</strong>：App Store &#x2F; Play 装 Tailscale，同账号登录，自动进 tailnet。</p>
<h3 id="3-3-连接（任意网络、任意时刻）">3.3 连接（任意网络、任意时刻）</h3><p>本地 <code>~/.ssh/config</code>（和原 DDNS 并存，双保险）：</p>
<figure class="highlight plaintext"><table><tr><td class="gutter"><pre><span class="line">1</span><br><span class="line">2</span><br><span class="line">3</span><br><span class="line">4</span><br><span class="line">5</span><br><span class="line">6</span><br><span class="line">7</span><br><span class="line">8</span><br><span class="line">9</span><br><span class="line">10</span><br></pre></td><td class="code"><pre><span class="line">Host devbox-ts</span><br><span class="line">    HostName devbox.&lt;tailnet&gt;.ts.net</span><br><span class="line">    User kali</span><br><span class="line">    Port 22</span><br><span class="line">    IdentityFile C:\Users\&lt;你&gt;\.ssh\id_ed25519</span><br><span class="line"></span><br><span class="line">Host devbox            # DDNS 备用（局域网/公网入站可用时）</span><br><span class="line">    HostName devbox.dingdao.me</span><br><span class="line">    Port 2222</span><br><span class="line">    User kali</span><br></pre></td></tr></table></figure>

<p>手机（最省事，免私钥）：</p>
<figure class="highlight bash"><table><tr><td class="gutter"><pre><span class="line">1</span><br></pre></td><td class="code"><pre><span class="line">tailscale ssh kali@100.123.x.x</span><br></pre></td></tr></table></figure>

<h3 id="3-4-验证">3.4 验证</h3><ul>
<li><code>sudo tailscale status</code> 三端全在线</li>
<li>手机 <code>tailscale ssh kali@...</code> 直接进 Ubuntu shell ✅</li>
<li><code>tailscale ssh</code> 不走 22 端口、不走公网，<strong>运营商封多少端口都不影响</strong></li>
</ul>
<h2 id="四、安全性（针对”私人文件会不会暴露”的担忧）">四、安全性（针对”私人文件会不会暴露”的担忧）</h2><p>Tailscale 在这套场景里<strong>不增加公网攻击面</strong>，原因：</p>
<ol>
<li><strong>默认对公网不可见</strong>：<code>100.x.y.z</code> 是 RFC1918 保留段，公网路由送不到；<br>攻击者没有你的账号 + tailnet 的 WireGuard 密钥，连”敲门”都找不到</li>
<li><strong>双向 WireGuard 加密（AES-256-GCM）</strong>：流量嗅探也解不开</li>
<li><strong>默认零开放端口</strong>：不开 Funnel、不开 Subnet Router、不开 <code>--ad-v4</code>；<br>我确认过 Funnel 是关的</li>
<li><strong>唯一成员 &#x3D; 你的 Google 账号</strong>：要进 tailnet 得先攻陷你的 Google，<br>那是账号层面的事，不是 Tailscale 新开的口子</li>
</ol>
<p><strong>真实剩余风险</strong>全在”账号&#x2F;设备被攻破”层面，按性价比做这几项加固：</p>
<ul>
<li>Google 开两步验证（最优先）</li>
<li>Tailscale 控制台开 2FA + 定期查 <strong>活跃会话&#x2F;陌生设备</strong>（陌生即 revoke）</li>
<li>用 <strong>Per-Device ACL</strong> 收紧：手机&#x2F;Windows 只允许连 Ubuntu 的 22，其余 deny<br>（即使某台设备密钥泄露，横向也被限死在 ACL 内）</li>
</ul>
<h2 id="五、踩坑清单（可复用）">五、踩坑清单（可复用）</h2><table>
<thead>
<tr>
<th>坑</th>
<th>解法</th>
</tr>
</thead>
<tbody><tr>
<td>Cloudflare 的 Account ID ≠ Zone ID，填错 404</td>
<td>用 API 查 zone 列表拿真实 Zone ID，脚本自动解析</td>
</tr>
<tr>
<td>DDNS 脏数据污染（IP 源全挂时把记录写空）</td>
<td>全失败时保留 <code>last_ip</code>，绝不覆盖已有正确记录</td>
</tr>
<tr>
<td>家宽外网入站被封（DDNS+转发全对但外网 CLOSED）</td>
<td>换 Tailscale 出站打洞，零入站</td>
</tr>
<tr>
<td>Hyper-V VM 重启 IP 变导致 portproxy 指错</td>
<td>VM 侧 netplan 配静态 IP，一劳永逸</td>
</tr>
<tr>
<td>Tailscale headless 拿不到认证 URL</td>
<td><code>nohup sudo tailscale up ... &amp;</code> 后台跑，读 log 里的 URL</td>
</tr>
</tbody></table>
<h2 id="六、一句话总结">六、一句话总结</h2><blockquote>
<p>家用宽带入站不可控（运营商封端口、光猫路由模式二级 NAT、动态 IP）<br>这三个坑让”DDNS + 端口转发”在家用场景下<strong>不可靠</strong>。<br>Tailscale 用”出站打洞”把问题降维成”只要能上网就能连”，<br>是个人远程开发&#x2F;私人文件互通场景的默认最优解。<br>DDNS 那套留着做局域网直连的备用，公网访问交给 Tailscale。</p>
</blockquote>
<hr>
<p><em>配图建议：① 三层转发架构 vs Tailscale 全 mesh 对比 ② <code>tailscale status</code> 三端在线截图（IP 打码）③ 控制台安全加固项</em></p>
<h2 id="脱敏说明（发文前自查）">脱敏说明（发文前自查）</h2><p>本文已做如下脱敏，发布前请再自查一遍：</p>
<ul>
<li>真实邮箱 <code>jianqiangcui996@gmail.com</code> → 文中已隐去（只写”同一 Google 账号”）</li>
<li>真实公网出口 IP <code>122.231.144.252</code>、手机出口 <code>124.160.204.98</code> → 文中用 <code>xx.xx.xx.xx</code> 占位</li>
<li>真实 tailnet 名 <code>tailb889a7</code> → 文中用 <code>xxx</code> 占位（<code>devbox.&lt;tailnet&gt;.ts.net</code>）</li>
<li>真实内网 <code>172.31.92.47</code> &#x2F; <code>192.168.2.7</code> → 文中用 <code>172.x.x.x</code> &#x2F; <code>192.168.x.7</code> 占位</li>
<li>真实域名 <code>kaliserver.dingdao.me</code> &#x2F; <code>kaliserver.tailb889a7.ts.net</code> → 文中改为 <code>devbox.dingdao.me</code> &#x2F; <code>devbox.&lt;tailnet&gt;.ts.net</code></li>
<li>Tailscale IP <code>100.123.36.49</code> &#x2F; <code>100.113.231.42</code> &#x2F; <code>100.98.143.1</code> → 文中用 <code>100.123.x.x</code> &#x2F; <code>100.113.x.x</code> &#x2F; <code>100.98.x.x</code> 占位</li>
</ul>
<p>如需完全不可追溯到个人，上述占位符已覆盖所有可直接定位的标识符；<br>如需保留部分真实值（如公开博客保留域名示例），可把 <code>devbox.dingdao.me</code><br>换成你自己愿意公开的域名。</p>
