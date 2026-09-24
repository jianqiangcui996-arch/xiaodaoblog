---
title: 一个 API Key 调用 19 个模型：我把家用 Hyper-V 虚拟机改成了私人 AI 网关
date: 2026-09-17
categories: [折腾]
tags: []
---

<blockquote>
<p>起因很简单：想在虚拟机里跑点自己的 AI 项目。<br>结果从”SSH 都连不上”开始，一路排到网络架构、磁盘分区、公钥权限、NAT 持久性、<br>OAuth 回调、路由分类器……最后落在一个 <code>model=auto</code> 上。</p>
<p>这篇不是教程，是一份<strong>排障账本</strong>——记录那些”看起来成功了”的假信号，<br>以及它们各自骗了我多久。</p>
<p>（全文已对公网 IP、内网地址、域名、账号、密钥、tailnet 名等做脱敏，仅保留技术结构。<br>文末附自查清单。）</p>
</blockquote>
<h2 id="TL-DR">TL;DR</h2><p>一台跑在 Windows Hyper-V 里的 Ubuntu 26.04 虚拟机，最终变成：</p>
<figure class="highlight plaintext"><table><tr><td class="gutter"><pre><span class="line">1</span><br><span class="line">2</span><br><span class="line">3</span><br><span class="line">4</span><br><span class="line">5</span><br><span class="line">6</span><br><span class="line">7</span><br><span class="line">8</span><br><span class="line">9</span><br><span class="line">10</span><br><span class="line">11</span><br></pre></td><td class="code"><pre><span class="line">                 ┌──────────────── Cloudflare Tunnel ────────────────┐</span><br><span class="line">手机/任意网络 ────┤  aigw.example.com  → localhost:8080  (AI 网关)     │</span><br><span class="line">                 │  panel.example.com → localhost:8443  (1Panel)      │</span><br><span class="line">                 │  dsh.example.com   → localhost:10443 (DeepSeek Harness)</span><br><span class="line">                 └───────────────────────────────────────────────────┘</span><br><span class="line">                                       │</span><br><span class="line">家里设备 ── 192.168.x.7:8443 ──┐       │</span><br><span class="line">宿主机   ── 192.168.x.10:8080 ─┼──►  Ubuntu VM (2核/4G/76G)</span><br><span class="line">                                │      ├─ AI 网关：5 个上游账号 / 3 个模型组</span><br><span class="line">                                │      │   / 智能路由 auto / 1 个个人 key</span><br><span class="line">                                └──────┴─ 1Panel + Docker + DeepSeek Harness</span><br></pre></td></tr></table></figure>

<ul>
<li><strong>一个 Base URL + 一个 API Key</strong>，背后 19 个模型，按任务复杂度自动分派</li>
<li>路由器<strong>零端口转发</strong>，公网入口只有 Cloudflare</li>
<li>从”虚拟机彻底失联”到全链路可用，中间踩了 14 个坑，其中 4 个是<strong>假成功信号</strong></li>
</ul>
<h2 id="一、起点：一台连不上网的虚拟机">一、起点：一台连不上网的虚拟机</h2><p>新装好的 Ubuntu Server 26.04，纯命令行，目标是搭 AI 开发环境。第一天就翻车：</p>
<p>宿主机 Windows 重启一次，SSH 再也连不上虚拟机。控制台里 <code>ip a</code> 长这样：</p>
<figure class="highlight plaintext"><table><tr><td class="gutter"><pre><span class="line">1</span><br></pre></td><td class="code"><pre><span class="line">2: eth0:  mtu 1500 state DOWN</span><br></pre></td></tr></table></figure>

<p>我的第一反应是”Hyper-V 的 Default Switch 网段随重启漂移，静态地址失效了”。</p>
<p>这个判断<strong>对了一半</strong>——网段确实每次宿主重启都换（我机器上历史出现过 5 个不同网段），但它不是主因。因为那个静态地址，从头到尾就没生效过。</p>
<h2 id="二、真凶：配置没错，但网卡”没人管”">二、真凶：配置没错，但网卡”没人管”</h2><figure class="highlight bash"><table><tr><td class="gutter"><pre><span class="line">1</span><br><span class="line">2</span><br><span class="line">3</span><br></pre></td><td class="code"><pre><span class="line">networkctl</span><br><span class="line"><span class="comment">#   IDX LINK  TYPE  OPERATIONAL SETUP</span></span><br><span class="line"><span class="comment">#   2   eth0  ether routable    unmanaged    ← 关键在这一列</span></span><br></pre></td></tr></table></figure>

<p><code>unmanaged</code> 的意思是：<strong>没有任何网络管理器在管这块网卡</strong>。翻 netplan 配置：</p>
<figure class="highlight yaml"><table><tr><td class="gutter"><pre><span class="line">1</span><br><span class="line">2</span><br><span class="line">3</span><br><span class="line">4</span><br></pre></td><td class="code"><pre><span class="line"><span class="attr">ethernets:</span></span><br><span class="line">  <span class="attr">eth0:</span></span><br><span class="line">    <span class="attr">match:</span></span><br><span class="line">      <span class="attr">macaddress:</span> <span class="number">00</span><span class="string">:15:5d:02:10:04</span>     <span class="comment"># 配置里匹配这个 MAC</span></span><br></pre></td></tr></table></figure>

<p>而实际网卡 MAC 是 <code>00:15:5d:02:10:05</code>。连安装器留下的原始备份都是 <code>:04</code>——说明这块虚拟网卡在装完系统后被重建过，Hyper-V 重新分配了动态 MAC。</p>
<p><strong>MAC 匹配不上 → 整份配置对这块网卡完全无效 → 既没有静态地址，也没有 DHCP 兜底。</strong></p>
<blockquote>
<p>可复用的判据：<code>ip a</code> 看不到地址时，<strong>先看 <code>networkctl</code> 的 SETUP 列，别急着改地址</strong>。<br><code>unmanaged</code> &#x3D; 配置没匹配上；<code>configuring</code> &#x2F; <code>failed</code> 才是配置本身有问题。</p>
</blockquote>
<h2 id="三、顺手挖出三个静默炸弹">三、顺手挖出三个静默炸弹</h2><table>
<thead>
<tr>
<th>隐患</th>
<th>为什么危险</th>
<th>处理</th>
</tr>
</thead>
<tbody><tr>
<td><code>sshd</code> 状态 active 但 <code>enabled=disabled</code></td>
<td>下次重启 SSH 直接消失，而且”现在能用”会骗过你</td>
<td><code>systemctl enable ssh</code></td>
</tr>
<tr>
<td><code>AutomaticStopAction = Save</code></td>
<td>宿主机关机时 VM 被冻成休眠，开机带着旧网络配置”复活”</td>
<td>改 <code>ShutDown</code></td>
</tr>
<tr>
<td><code>AutomaticCheckpointsEnabled = True</code></td>
<td>每次开机长一个差分盘，越用越占空间</td>
<td>关掉 + 删存量</td>
</tr>
</tbody></table>
<p>第二条有个反直觉的细节：<strong><code>AutomaticStopAction</code> 只能在 VM 关机状态下修改</strong>。VM 运行中执行 <code>Set-VM</code> 会返回成功，但 <code>Get-VM</code> 读回来纹丝不动——你会以为命令没生效，反复试。</p>
<h2 id="四、网络定型：双网卡分工（以及一个更深的坑）">四、网络定型：双网卡分工（以及一个更深的坑）</h2><p>最终架构：</p>
<figure class="highlight plaintext"><table><tr><td class="gutter"><pre><span class="line">1</span><br><span class="line">2</span><br><span class="line">3</span><br><span class="line">4</span><br><span class="line">5</span><br><span class="line">6</span><br><span class="line">7</span><br><span class="line">8</span><br></pre></td><td class="code"><pre><span class="line">宿主机</span><br><span class="line">├─ Default Switch（Hyper-V 自管 NAT，每次开机自动重建）</span><br><span class="line">│    └─ VM eth0：DHCP，只要地址、不要默认路由  → 兜底 SSH 入口</span><br><span class="line">└─ 自建内部交换机 VMIntNet（网段永久不变）</span><br><span class="line">     └─ VM eth1：静态 192.168.x.10，只负责入站  → 日常 SSH 入口</span><br><span class="line"></span><br><span class="line">出网：eth0 → Default Switch NAT → 互联网</span><br><span class="line">入站：宿主机 → eth1 静态地址（重启不变）</span><br></pre></td></tr></table></figure>

<p>对应 netplan 的关键两行：</p>
<figure class="highlight yaml"><table><tr><td class="gutter"><pre><span class="line">1</span><br><span class="line">2</span><br><span class="line">3</span><br><span class="line">4</span><br><span class="line">5</span><br><span class="line">6</span><br></pre></td><td class="code"><pre><span class="line"><span class="attr">eth0:</span></span><br><span class="line">  <span class="attr">dhcp4:</span> <span class="literal">true</span></span><br><span class="line">  <span class="attr">dhcp4-overrides:</span> &#123; <span class="attr">use-routes:</span> <span class="literal">false</span>, <span class="attr">use-dns:</span> <span class="literal">false</span> &#125;   <span class="comment"># 只要地址，不抢路由</span></span><br><span class="line"><span class="attr">eth1:</span></span><br><span class="line">  <span class="attr">addresses:</span> [ <span class="number">192.168</span><span class="string">.x.10/24</span> ]</span><br><span class="line">  <span class="comment"># 故意不写 routes:</span></span><br></pre></td></tr></table></figure>

<p><strong>那个更深的坑就藏在”故意不写 routes”上。</strong></p>
<p>我最初的版本是给 eth1 配了默认路由、出网走自建内部交换机的 <code>New-NetNat</code>。看起来更”干净”——永久网段、自主可控。然后宿主机重启了一次：</p>
<ul>
<li>portproxy 还在</li>
<li>宿主侧静态 IP 还在</li>
<li>防火墙规则还在</li>
<li><strong><code>New-NetNat</code> 建的 NAT 对象，没了</strong></li>
</ul>
<p>于是虚拟机一条默认路由都没有（eth0 被我设成不抢路由），出网 100% 断死，DNS 最先死。而当时 Tailscale 显示 <code>logged out</code>，我一度以为是 Tailscale 故障。</p>
<blockquote>
<p>教训：<strong>内部交换机可以做”永久入站”，但不要拿它做出网主路径。</strong><br>出网交给 Hyper-V 自己托管的 Default Switch NAT——它每次开机自动重建，不需要你养。</p>
</blockquote>
<h2 id="五、VS-Code-反复要密码，而命令行免密正常">五、VS Code 反复要密码，而命令行免密正常</h2><p>这个现象非常迷惑：命令行 <code>ssh devbox</code> 秒进，VS Code Remote-SSH 每次都弹密码框。</p>
<p>两个原因叠加。</p>
<p><strong>其一，陈旧 <code>.pub</code> 造成的假指纹。</strong> 我把公钥装进虚拟机后仍被拒。查了半天才反应过来：</p>
<figure class="highlight bash"><table><tr><td class="gutter"><pre><span class="line">1</span><br><span class="line">2</span><br></pre></td><td class="code"><pre><span class="line">ssh-keygen -lf id_ed25519      <span class="comment"># 报了个指纹</span></span><br><span class="line">ssh-keygen -yf id_ed25519      <span class="comment"># 反导出的却是另一个公钥</span></span><br></pre></td></tr></table></figure>

<p><strong><code>ssh-keygen -l</code> 读私钥时会去拿同名的 <code>.pub</code> 文件</strong>，而那个 <code>.pub</code> 是上一把密钥的残留（私钥重新生成过，<code>.pub</code> 没跟着更新）。客户端拿 <code>.pub</code> 里的 blob 去 offer、却用不匹配的私钥签名 → 服务端必然拒绝。修复就是 <code>-y</code> 重新导出覆盖。</p>
<p><strong>其二，私钥文件的 NTFS 权限太松。</strong> Windows 自带的 OpenSSH（VS Code 用的就是它）会检查私钥 ACL，发现 <code>BUILTIN\Users</code> 和 <code>Everyone</code> 可读，就<strong>静默跳过密钥</strong>退化成密码认证。而 git-bash 里那个新版 OpenSSH 不做这个检查——所以”我能连、VS Code 不能连”。</p>
<figure class="highlight powershell"><table><tr><td class="gutter"><pre><span class="line">1</span><br><span class="line">2</span><br></pre></td><td class="code"><pre><span class="line">icacls <span class="variable">$key</span> /inheritance:<span class="built_in">r</span> /remove <span class="string">&quot;BUILTIN\Users&quot;</span> <span class="string">&quot;Everyone&quot;</span></span><br><span class="line">icacls <span class="variable">$key</span> /grant:<span class="built_in">r</span> <span class="string">&quot;<span class="variable">$</span>&#123;env:USERNAME&#125;:F&quot;</span> /grant <span class="string">&quot;NT AUTHORITY\SYSTEM:F&quot;</span></span><br></pre></td></tr></table></figure>

<blockquote>
<p>顺带一个 shell 坑：PowerShell 里 <code>&quot;$env:USERNAME:F&quot;</code> 会被解析成带作用域的变量而变成空串，必须写 <code>&quot;${env:USERNAME}:F&quot;</code>。</p>
</blockquote>
<h2 id="六、磁盘”只剩-19G”是个假象">六、磁盘”只剩 19G”是个假象</h2><p>根分区剩 8.5G，正准备停机扩虚拟磁盘，<code>pvs</code> 一看出问题了：</p>
<figure class="highlight plaintext"><table><tr><td class="gutter"><pre><span class="line">1</span><br><span class="line">2</span><br><span class="line">3</span><br><span class="line">4</span><br><span class="line">5</span><br><span class="line">6</span><br><span class="line">7</span><br><span class="line">8</span><br><span class="line">9</span><br><span class="line">10</span><br><span class="line">11</span><br><span class="line">12</span><br><span class="line">13</span><br><span class="line">14</span><br><span class="line">15</span><br><span class="line">16</span><br><span class="line">17</span><br><span class="line">18</span><br><span class="line">19</span><br><span class="line">20</span><br><span class="line">21</span><br><span class="line">22</span><br></pre></td><td class="code"><pre><span class="line">PV         VG        PSize    PFree</span><br><span class="line">/dev/sda3  ubuntu-vg  虚拟机磁盘不够，**先 `pvs` 看 PFree**，别一上来就动虚拟磁盘文件。</span><br><span class="line"></span><br><span class="line">## 七、对外暴露：三条路全部撞墙</span><br><span class="line"></span><br><span class="line">服务搭起来了，下一个需求是&quot;手机在外面也能访问&quot;。</span><br><span class="line"></span><br><span class="line">### 尝试一：Tailscale 直连虚拟机 —— 架构上不可能</span><br><span class="line"></span><br><span class="line">手机和虚拟机在同一个 tailnet，虚拟机有 `100.x` 地址，理论上直连就行。结果超时。</span><br><span class="line"></span><br><span class="line">**而这里出现了第一个漂亮的假信号**：手机上 `tailscale ping 100.x` **是有 pong 的**。</span><br><span class="line"></span><br><span class="line">但虚拟机上抓包，`tcpdump -nni any port 8443` —— **一个 SYN 都没收到**。</span><br><span class="line"></span><br><span class="line">原因两层：</span><br><span class="line"></span><br><span class="line">1. `tailscale ping` 是 **disco 协议层应答**，由 `tailscaled` 进程直接回，**不经过内核网络栈、不产生 TCP 连接**。ping 通 ≠ 业务数据能传。</span><br><span class="line">2. **方向不对称**。虚拟机藏在 Hyper-V 的 NAT 后面：虚拟机主动出去能通（NAT 记住回程映射），外部主动连入必然被丢；本该退化成 DERP 中继兜底，但国内访问官方 DERP 基本连不上。</span><br><span class="line"></span><br><span class="line">更离谱的是：**同一个 WiFi 下的手机和宿主机，tailscale 也打洞失败**，只能绕旧金山中继：</span><br><span class="line"></span><br></pre></td></tr></table></figure>
<p>pong from tailscale-termux via DERP(sfo) in 507ms<br>direct connection not established</p>
<figure class="highlight plaintext"><table><tr><td class="gutter"><pre><span class="line">1</span><br><span class="line">2</span><br><span class="line">3</span><br><span class="line">4</span><br><span class="line">5</span><br><span class="line">6</span><br><span class="line">7</span><br><span class="line">8</span><br><span class="line">9</span><br><span class="line">10</span><br><span class="line">11</span><br><span class="line">12</span><br><span class="line">13</span><br><span class="line">14</span><br><span class="line">15</span><br><span class="line">16</span><br><span class="line">17</span><br><span class="line">18</span><br><span class="line">19</span><br><span class="line">20</span><br><span class="line">21</span><br><span class="line">22</span><br><span class="line">23</span><br><span class="line">24</span><br><span class="line">25</span><br><span class="line">26</span><br><span class="line">27</span><br></pre></td><td class="code"><pre><span class="line"></span><br><span class="line">### 尝试二：用 portproxy 桥宿主的 Tailscale IP —— 不接管 wintun</span><br><span class="line"></span><br><span class="line">思路很漂亮：宿主机自己是正常的 tailscale 节点，又有直达虚拟机内网的路由，让它替虚拟机收连接。</span><br><span class="line"></span><br><span class="line">**然后我犯了第二个假信号错误**：在宿主机上 `curl http://:8443` 返回 200，我当场宣布&quot;桥通了&quot;。</span><br><span class="line"></span><br><span class="line">错。**本机访问自己的 IP 走回环，完全不经过入站防火墙和真实收包路径。** 换手机测，照样超时。最终确认 `netsh portproxy` 不接管 Tailscale 那张 wintun 网卡。</span><br><span class="line"></span><br><span class="line">&gt; 铁律：**验证&quot;外部能否连入&quot;，必须换一台机器测。**</span><br><span class="line"></span><br><span class="line">### 尝试三：公网域名 + 路由器端口转发 —— 两个假象叠加</span><br><span class="line"></span><br><span class="line">域名在 Cloudflare 做灰云直指家宽公网 IP，路由器加端口转发。逻辑成立，实测超时。</span><br><span class="line"></span><br><span class="line">**假象一：NAT 回环。** 在家里 WiFi 上访问自己的公网 IP，绝大多数家用路由器不支持回环，必然超时。判别方法：宿主机打自己公网 IP 超时、打自己局域网 IP 却是 200。所以**测公网链路必须关 WiFi 用移动数据**，否则你会把&quot;回环不支持&quot;误判成&quot;公网不通&quot;。</span><br><span class="line"></span><br><span class="line">**假象二：规则填错。** 最后发现路由器规则里&quot;局域网主机&quot;字段填成了 `192.168.x.7:8443`（这个字段只能填纯 IP），而&quot;局域网主机端口&quot;填了外部端口 45432（应该填服务真实端口 8443）。也就是说——**我一度得出的&quot;运营商封端口&quot;结论，从头到尾没被真正验证过。**</span><br><span class="line"></span><br><span class="line">## 八、终局：Cloudflare Tunnel，以及一张错误码阶梯</span><br><span class="line"></span><br><span class="line">隧道是**虚拟机主动向外连 Cloudflare 边缘**，所以三个死结同时解开：不需要入站端口（不怕封）、不需要打洞（不受 NAT 方向限制）、不需要公网 IP。</span><br><span class="line"></span><br><span class="line">```bash</span><br><span class="line"># 虚拟机侧：token 从 Cloudflare Zero Trust → Tunnels → Connector 里复制</span><br><span class="line">sudo tee /etc/cloudflared/cloudflared.env &#x27;</span><br><span class="line">sudo systemctl enable --now cloudflared</span><br></pre></td></tr></table></figure>

<p>配置过程不是一次到位，三个错误码恰好对应三个不同层次，值得存成查表：</p>
<table>
<thead>
<tr>
<th>现象</th>
<th>真实含义</th>
<th>我的实际问题</th>
</tr>
</thead>
<tbody><tr>
<td><strong>522 + 约 20 秒超时</strong></td>
<td>流量<strong>没进隧道</strong></td>
<td>DNS 还是灰云 A 记录，指向了路由器 IP</td>
</tr>
<tr>
<td><strong>522 + 已解析到 CF 边缘 IP</strong></td>
<td>进了 CF，但源站不可达</td>
<td>把 A 记录直接点成橙云；隧道要求 <strong>CNAME → <code>.cfargotunnel.com</code></strong></td>
</tr>
<tr>
<td><strong>530 &#x2F; 502（刚重启完）</strong></td>
<td><strong>假故障</strong></td>
<td>cloudflared 重启后 QUIC 拨号有约 10 秒空窗，等日志出现 4 条 <code>Registered tunnel connection</code> 再测</td>
</tr>
<tr>
<td><strong>502 + 1.4 秒返回</strong></td>
<td>进了隧道，回源失败</td>
<td><code>Service URL</code> 写成 <code>https://localhost:8443</code>，而面板是明文 HTTP</td>
</tr>
</tbody></table>
<p>最后一条在日志里一目了然：</p>
<figure class="highlight plaintext"><table><tr><td class="gutter"><pre><span class="line">1</span><br><span class="line">2</span><br></pre></td><td class="code"><pre><span class="line">ERR Unable to reach the origin service:</span><br><span class="line">    tls: first record does not look like a TLS handshake   originService=https://localhost:8443</span><br></pre></td></tr></table></figure>

<blockquote>
<p>判据：<strong>522 慢 → 查 DNS 是不是橙云 CNAME；502 快 → 查 cloudflared 日志的 originService。</strong></p>
</blockquote>
<p>配好之后<strong>把路由器所有端口转发关掉</strong>——公网入口只剩 Cloudflare 一条，被扫描爆破的面彻底收口。</p>
<h2 id="九、AI-网关：把散落的-API-Key-收成一个">九、AI 网关：把散落的 API Key 收成一个</h2><p>基础设施稳了，回到真正目的。用 1Panel 装了 AI 网关，把各家模型聚合成一个入口。</p>
<p><strong>账号池</strong>（5 个上游，全部健康）：</p>
<table>
<thead>
<tr>
<th>账号</th>
<th>类型</th>
<th>内容</th>
</tr>
</thead>
<tbody><tr>
<td>Agnes</td>
<td>文本 ×4</td>
<td>免费 beta 档 + 一个收费 pro 档</td>
</tr>
<tr>
<td>阿里云 Coding Plan</td>
<td>文本 ×9</td>
<td>coder 系列 + max + 多家第三方</td>
</tr>
<tr>
<td>硅基流动</td>
<td>文本 ×5</td>
<td>4B&#x2F;8B 小模型 + R1 + GLM + OCR</td>
</tr>
<tr>
<td>Agnes</td>
<td>文生图 ×1</td>
<td>图像模型</td>
</tr>
<tr>
<td>硅基流动</td>
<td>向量 ×1</td>
<td><code>bge-m3</code>，给智能路由用</td>
</tr>
</tbody></table>
<p><strong>模型组</strong>（关键认知：<strong>组内顺序是”故障转移链”，第一个模型吃 100% 流量，后面的只在它挂了才轮到</strong>）：</p>
<figure class="highlight plaintext"><table><tr><td class="gutter"><pre><span class="line">1</span><br><span class="line">2</span><br><span class="line">3</span><br><span class="line">4</span><br></pre></td><td class="code"><pre><span class="line">light   : agnes-2.0-flash → qwen3-coder-next → agnes-2.5-flash → Qwen3.5-4B</span><br><span class="line">complex : agnes-3.0-flash → qwen3-coder-plus → qwen3-max → qwen3.7-plus</span><br><span class="line">          → kimi-k2.5 → DeepSeek-R1 → GLM-4-9B → agnes-2.5-pro-alpha</span><br><span class="line">image   : agnes-image-2.5-flash</span><br></pre></td></tr></table></figure>

<p><strong>智能路由</strong>：虚拟模型名 <code>auto</code>，阈值 0.80。这里有个必须踩一次才知道的坑——<strong>智能路由是基于”首条消息的向量相似度”分类的，不是内置复杂度判断</strong>，而且它依赖向量服务；更关键的是，<strong>种子样本的向量索引默认没建</strong>：</p>
<figure class="highlight plaintext"><table><tr><td class="gutter"><pre><span class="line">1</span><br></pre></td><td class="code"><pre><span class="line">188 条样本，vectorDim = 0   ← 索引没算，分类器等于空转</span><br></pre></td></tr></table></figure>

<p>不触发一次全量向量计算，所有请求都会”无法可靠判定 → 按简单处理”。索引建完，分类立刻正常。</p>
<p><strong>最终形态</strong>：一个 Base URL、一个 key，<code>model=auto</code> 走天下，需要特定时点名。</p>
<figure class="highlight python"><table><tr><td class="gutter"><pre><span class="line">1</span><br><span class="line">2</span><br><span class="line">3</span><br></pre></td><td class="code"><pre><span class="line"><span class="keyword">from</span> openai <span class="keyword">import</span> OpenAI</span><br><span class="line">client = OpenAI(base_url=<span class="string">&quot;https://aigw.example.com/v1&quot;</span>, api_key=<span class="string">&quot;&quot;</span>)</span><br><span class="line">client.chat.completions.create(model=<span class="string">&quot;auto&quot;</span>, messages=[...])</span><br></pre></td></tr></table></figure>

<h2 id="十、实测数据把我的直觉全推翻了">十、实测数据把我的直觉全推翻了</h2><p>我原本的设计前提是：”agnes 免费又快速，应该当第一优先级；硅基流动慢，放最后。”</p>
<p>于是给 6 个候选模型各跑了 3 次实测：</p>
<table>
<thead>
<tr>
<th>模型</th>
<th>延迟</th>
<th>成功率</th>
</tr>
</thead>
<tbody><tr>
<td><strong>qwen3-coder-next</strong></td>
<td><strong>1.2 &#x2F; 1.5 &#x2F; 2.0s</strong></td>
<td><strong>3&#x2F;3</strong></td>
</tr>
<tr>
<td><strong>qwen3-coder-plus</strong></td>
<td><strong>1.9 &#x2F; 2.2 &#x2F; 3.0s</strong></td>
<td><strong>3&#x2F;3</strong></td>
</tr>
<tr>
<td>agnes-3.0-flash</td>
<td>2.2 &#x2F; 5.1 &#x2F; <strong>35s 超时</strong></td>
<td>2&#x2F;3</td>
</tr>
<tr>
<td>agnes-2.0-flash</td>
<td>28s &#x2F; 失败 &#x2F; 失败</td>
<td>1&#x2F;3</td>
</tr>
<tr>
<td>硅基 Qwen3.5-4B</td>
<td>41.6 &#x2F; 45s</td>
<td>慢但成功</td>
</tr>
<tr>
<td>硅基 Qwen3-8B</td>
<td>18.6 &#x2F; 45s</td>
<td>慢但成功</td>
</tr>
</tbody></table>
<p>三个结论，每个都和直觉相反：</p>
<ol>
<li><strong>“免费又快”不成立。</strong> agnes 是免费 beta，代价是<strong>限流 + 长尾</strong>（35 秒超时、连续失败）。放链首会让所有 <code>auto</code> 请求先撞墙再降级，实测 <code>auto</code> 因此出现 40 秒延迟。</li>
<li><strong>同账号内的多个模型互为备份毫无意义。</strong> agnes 四个模型共用一个账号，账号级 cooldown 一来四个一起倒。<strong>真正的容灾必须跨供应商。</strong></li>
<li><strong>已经付费的 Coding Plan 反而是最好的主力。</strong> 1.2–3 秒、6&#x2F;6 成功，而且额度是已经花出去的沉没成本。</li>
</ol>
<p>最终我没有把 coder 提到首位（那会让额度消耗过度集中），而是选了折中方案：<strong>agnes 保持首位省额度，但把它的账号并发压到 1，并让 <code>qwen3-coder-next</code> 紧跟第二位</strong>——这样撞墙时 1～2 秒就降级到快模型，而不是掉进 40 秒的坑。</p>
<blockquote>
<p>还有一个”第四个假信号”：我一度断言”cookie 的 SameSite&#x3D;Strict 导致 OAuth 回调必挂”。<br>后来实测发现 state cookie 其实是 Lax，Strict 只在 csrf 上，真正的疑点是它只有 5 分钟有效期。<br><strong>在没有对照实验之前，不要把推论当结论写进方案。</strong></p>
</blockquote>
<h2 id="十一、接入端：两个小插曲">十一、接入端：两个小插曲</h2><p><strong>WorkBuddy 连不上。</strong> 报 404，且错误里目标显示为 <code>https://aigw.example.com</code>（没有 <code>/v1</code>）。真正原因有两层：Base URL 必须带 <code>/v1</code>；而且<strong>一旦勾选”工具调用&#x2F;推理”，客户端会从 Chat Completions 切到 Responses API</strong>，而所有上游账号都只声明了 <code>openaiChatCompletions</code> 协议，Responses 路由无人可服务 → 404。所以那些开关就是不能勾，除非给账号补上 Responses 协议。</p>
<p><strong>DeepSeek Harness。</strong> 1Panel 应用商店装的 <code>deepseek-harness</code>，Caddy 提供 HTTPS（自签本地 CA），配好模型后端指向网关的 <code>auto</code> 之后直接跑通：多轮 agent 任务、142 tok&#x2F;s、77K token 上下文、缓存命中 19%。至此从”上游 API Key”到”能干活的应用”整条链路闭环。</p>
<h2 id="十二、可复用的踩坑清单">十二、可复用的踩坑清单</h2><table>
<thead>
<tr>
<th>坑</th>
<th>症状</th>
<th>解法</th>
</tr>
</thead>
<tbody><tr>
<td>netplan <code>match.macaddress</code> 与实际 MAC 不符</td>
<td>接口 <code>unmanaged</code>，连 UP 都没有</td>
<td>先看 <code>networkctl</code> 的 SETUP 列，再用真实 MAC 重写</td>
</tr>
<tr>
<td><code>AutomaticStopAction=Save</code></td>
<td>宿主重启后 VM 带旧网络配置复活</td>
<td>改 <code>ShutDown</code>，且只能在 VM 关机时改</td>
</tr>
<tr>
<td><code>New-NetNat</code> 不跨宿主重启</td>
<td>出网全断、DNS 先死、Tailscale 显示 logged out</td>
<td>出网走 Default Switch 自管 NAT；内部交换机网卡不配默认路由</td>
</tr>
<tr>
<td>Ubuntu 装机只切 VG 的 64%</td>
<td><code>df</code> 显示根分区很小</td>
<td><code>pvs</code> 看 PFree，<code>lvextend + resize2fs</code> 在线扩</td>
</tr>
<tr>
<td><code>.pub</code> 陈旧而私钥已重建</td>
<td>公钥装上仍被拒</td>
<td><code>ssh-keygen -l</code> 会读 <code>.pub</code> 报假指纹，用 <code>-yf</code> 反导</td>
</tr>
<tr>
<td>私钥 NTFS ACL 含 Users&#x2F;Everyone</td>
<td>VS Code 要密码但命令行免密</td>
<td><code>icacls /inheritance:r</code> + 只留本人和 SYSTEM</td>
</tr>
<tr>
<td>本机 curl 自己的 IP 得 200</td>
<td>误判”外部也能连入”</td>
<td>必须换一台机器测</td>
</tr>
<tr>
<td><code>tailscale ping</code> 有 pong</td>
<td>误判”隧道能传业务数据”</td>
<td>它是 disco 层应答，要抓包看 SYN</td>
</tr>
<tr>
<td>在家里 WiFi 测自己公网 IP</td>
<td>超时，误判公网不通</td>
<td>家宽多不支持 NAT 回环，用移动数据测</td>
</tr>
<tr>
<td>路由器”局域网主机”字段填了 <code>IP:端口</code></td>
<td>端口转发全不通</td>
<td>主机字段只填 IP，内网端口填服务真实端口</td>
</tr>
<tr>
<td>Tunnel 的 Service URL 写 <code>https://</code></td>
<td>502，TLS handshake 失败</td>
<td>明文源站填 <code>http://</code>，且域名须是橙云 CNAME</td>
</tr>
<tr>
<td>智能路由种子样本 <code>vectorDim=0</code></td>
<td>所有请求都判成”简单”</td>
<td>触发一次全量向量索引重建</td>
</tr>
<tr>
<td>Hyper-V 文本控制台手敲命令</td>
<td>字符被吞，命令变形</td>
<td>别在控制台配系统，先搞出 IP 走 SSH</td>
</tr>
<tr>
<td>客户端勾了工具调用&#x2F;推理</td>
<td>404</td>
<td>它会切 Responses API，而上游账号没声明该协议</td>
</tr>
</tbody></table>
<h2 id="十三、一句话总结">十三、一句话总结</h2><blockquote>
<p>这一路最贵的不是配置，而是<strong>那些”看起来成功了”的瞬间</strong>：<br>有 pong 的 <code>tailscale ping</code>、返回 200 的本机自测、”所有设备都超时”（其实只是路由器不支持回环）、<br>“免费所以该优先”（其实限流长尾最致命）。</p>
<p>排障的真正门槛不是会配，而是<strong>知道每一个”成功”信号证明了什么、没证明什么</strong>。<br>凡是只验证了一半的结论，都要给它留一个被推翻的位置。</p>
</blockquote>
<hr>
<p><em>配图建议：① 双网卡分工拓扑（出网走 Default Switch NAT &#x2F; 入站走内部交换机静态 IP）<br>② <code>networkctl</code> 显示 <code>unmanaged</code> 的截图 ③ 522 → 530 → 502 → 200 四次响应对照<br>④ 六个模型延迟实测柱状图 ⑤ 最终访问矩阵 + WorkBuddy &#x2F; Harness 实跑截图</em></p>
<h2 id="脱敏说明（发文前自查）">脱敏说明（发文前自查）</h2><p>正文已做如下处理，发布前请再自查一遍：</p>
<ul>
<li>公网出口 IP → 未出现，仅表述为”家宽公网 IP”</li>
<li>内网地址 <code>192.168.x.7</code>（宿主）、<code>192.168.x.10</code>（虚拟机）→ 已用 x 占位</li>
<li>Cloudflare 域名与隧道主机名 → 统一改为 <code>aigw.example.com</code> &#x2F; <code>panel.example.com</code> &#x2F; <code>dsh.example.com</code>，真实子域名与主域名不出现</li>
<li>Tailscale IP 与 tailnet 名 → <code>100.x.x.x</code> &#x2F; 不出现；peer 名改为通用描述</li>
<li>所有账号密码、API Key、隧道 token → 一律 <code>/</code>，正文无任何真实凭据</li>
<li>1Panel 面板安全入口码 → 表述为”入口码”</li>
<li>飞书 &#x2F; 钉钉的 Tenant ID、App ID → 未出现（该功能与主线无关，正文只保留结论）</li>
<li>网卡 MAC → 保留 <code>00:15:5d:02:10:04/05/07</code>，这是 Hyper-V 本机动态分配值，不具公网可定位性；若介意可改为 <code>00:15:5d:02:10:0x</code></li>
<li>模型名与供应商 → 保留真实名称（属公开信息，且是本文技术价值所在）</li>
</ul>
<p>如需保留真实域名作为示例，把 <code>example.com</code> 换回你自己的域名即可；<br>其余占位符已覆盖所有可直接定位到人的标识符。</p>
