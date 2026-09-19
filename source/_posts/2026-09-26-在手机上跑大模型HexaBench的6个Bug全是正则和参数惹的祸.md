---
title: 在手机上跑大模型：HexaBench的6个Bug，全是正则和参数惹的祸
date: 2026-09-26 00:00:00 +08:00
categories: [折腾]
tags: [HexaBench, llama-cpp, 技术线, 本地大模型, 正则]
---

<blockquote>
<p>在手机上跑大模型，听起来很浪漫。修到能跑通，要过6个Bug。每个Bug都不是”写代码”能解决的，是”读懂机器脾气”的功课——参数污染、正则转义、伪流式、DOM操作爆炸。PP 20.81 tok&#x2F;s，这是Android手机能跑大模型的真实速度。</p>
</blockquote>
<h2 id="TL-DR">TL;DR</h2><p>在Termux上跑本地大模型（llama.cpp + GGUF + HexaBench Lite），修了6个Bug：①命令行参数污染 ②响应提取失败 ③正则表达式转义错误 ④伪流式处理 ⑤DOM操作O(n²)爆炸 ⑥Cloudflare Worker 1003&#x2F;1031报错。核心教训：修大模型框架不是写代码，是读懂机器脾气——每条错误信息背后，都是一个你”以为能自动处理但机器没处理”的细节。</p>
<h2 id="一、起因：为什么要在手机上跑大模型">一、起因：为什么要在手机上跑大模型</h2><p>朋友看我手机跑Hermes、爬虫、股票脚本，问：”手机能跑大模型吗？”</p>
<p>我当时的回答：能，但没那么美好。</p>
<p>“美好”的版本是：下载个GGUF模型，拖进HexaBench，点生成，出结果。</p>
<p>“真实”的版本是：拖进去之后，<strong>生成窗口是空的，响应是乱码，流式输出是假的，DOM刷着刷着卡死了，连浏览器都要加个参数才不崩</strong>。</p>
<p>这就是”在手机上跑大模型”的真相：模型能跑，但<strong>工程链路</strong>要过至少6个关。今天把这6个关的坑，挨个讲一遍。</p>
<h2 id="二、Bug-1：命令行参数污染">二、Bug 1：命令行参数污染</h2><p><strong>现象</strong>：我在HexaBench里输入prompt，生成的结果里，混进了<code>--threads 4 -ngl 0 --no-mmap</code>这些命令行参数。</p>
<p><strong>根因</strong>：代码里用的是<strong>裸位置参数</strong>传prompt，而不是 <code>-p</code> 参数。</p>
<figure class="highlight python"><table><tr><td class="gutter"><pre><span class="line">1</span><br><span class="line">2</span><br><span class="line">3</span><br><span class="line">4</span><br><span class="line">5</span><br></pre></td><td class="code"><pre><span class="line"><span class="comment"># 错误写法：prompt作为裸位置参数</span></span><br><span class="line">cmd = [llama_tool, <span class="string">&quot;-m&quot;</span>, model_path, prompt]</span><br><span class="line"></span><br><span class="line"><span class="comment"># 正确写法：用 -p 参数</span></span><br><span class="line">cmd = [llama_tool, <span class="string">&quot;-m&quot;</span>, model_path, <span class="string">&quot;-p&quot;</span>, prompt]</span><br></pre></td></tr></table></figure>

<p>裸位置参数的问题是：llama-simple会把prompt后面的内容，当成更多参数拼到命令行里。最后生成的输出，参数和prompt和响应，全搅在一起。</p>
<p><strong>教训</strong>：命令行工具传参，永远用<strong>命名参数</strong>（<code>-p xxx</code>），别用裸位置参数。这是Unix老规矩，但跑大模型的人容易忘。</p>
<h2 id="三、Bug-2：响应提取失败">三、Bug 2：响应提取失败</h2><p><strong>现象</strong>：生成完了，窗口里是空的，或者显示”请求失败或无响应”。</p>
<p><strong>根因</strong>：<code>_extract_response</code>函数不知道llama-simple的输出格式长啥样。</p>
<p>llama-simple的真实输出（从stderr里抓的）：</p>
<figure class="highlight plaintext"><table><tr><td class="gutter"><pre><span class="line">1</span><br></pre></td><td class="code"><pre><span class="line">--threads 4 -ngl 0 --no-mmap --temp 0.7 -p 你好，很高兴认识你 -s 1000000000 -t 1000main: decoded 20 tokens in 2.45 s, speed: 8.16 t/s</span><br></pre></td></tr></table></figure>

<p>注意几个关键点：</p>
<ol>
<li><strong>prompt被重复输出</strong>。llama-simple会把它收到的命令行参数原样回显，包括<code>-p</code>后面的prompt。所以你能看到<code>-p 你好，很高兴认识你</code>。</li>
<li><strong>真正的AI响应，藏在<code>main: decoded</code>之前</strong>。</li>
<li><strong>统计信息在<code>main: decoded</code>之后</strong>。</li>
</ol>
<p>正确的提取逻辑：定位<code>main: decoded</code>这行 → 找prompt最后出现的位置 → 取prompt之后、<code>main: decoded</code>之前的内容 → 清理残留参数。</p>
<figure class="highlight python"><table><tr><td class="gutter"><pre><span class="line">1</span><br></pre></td><td class="code"><pre><span class="line">pattern = <span class="string">r&#x27;-p\s+&#x27;</span> + escaped_prompt + <span class="string">r&#x27;(?:\s+-p\s+&#x27;</span> + escaped_prompt + <span class="string">r&#x27;)*\s+-p\s+(.*?)\s*(?:main:|\n|$)&#x27;</span></span><br></pre></td></tr></table></figure>

<p><strong>教训</strong>：别”以为输出是干净的”。跑一遍，把真实输出dump下来看，比猜靠谱一百倍。</p>
<h2 id="四、Bug-3：正则表达式转义错误">四、Bug 3：正则表达式转义错误</h2><p><strong>现象</strong>：响应提取好了，但清理残留参数时，正则又出错了，要么清不掉，要么把响应也清了。</p>
<p><strong>根因</strong>：正则里反斜杠没转义对。</p>
<figure class="highlight python"><table><tr><td class="gutter"><pre><span class="line">1</span><br><span class="line">2</span><br><span class="line">3</span><br><span class="line">4</span><br><span class="line">5</span><br></pre></td><td class="code"><pre><span class="line"><span class="comment"># 错误：--[\w-]+ 里的 \w 在字符串里没转义</span></span><br><span class="line">re.sub(<span class="string">r&#x27;--[\w-]+\s+\S+\s*&#x27;</span>, <span class="string">&#x27; &#x27;</span>, text)</span><br><span class="line"></span><br><span class="line"><span class="comment"># 正确：双反斜杠</span></span><br><span class="line">re.sub(<span class="string">r&#x27;--[\\w\\-]+\\s+\\S+\\s*&#x27;</span>, <span class="string">&#x27; &#x27;</span>, text)</span><br></pre></td></tr></table></figure>

<p>更坑的是嵌套在f-string或字符串拼接里的正则，转义层级又多一层。</p>
<p><strong>教训</strong>：正则表达式是”看起来简单，实际魔鬼”。跑大模型的人天天写正则，转义错了你就得盯着空窗口干瞪眼。</p>
<h2 id="五、Bug-4：伪流式处理">五、Bug 4：伪流式处理</h2><p><strong>现象</strong>：HexaBench的”流式输出预览”，显示”请求失败或无响应”，或者一次性刷出来。</p>
<p><strong>根因</strong>：代码<strong>以为</strong>自己做了流式，实际没做。</p>
<p>真正的流式：模型每生成一个token，就立刻推一个token到前端。<br>伪流式：等模型全跑完（几十秒），一次性把整段响应扔给前端。用户体验上”卡了半小时”，但其实模型早就跑完了。</p>
<p>修法是<strong>无缓冲模式</strong>（<code>bufsize=0</code>）+ 字符级流式处理。但要注意的是：<code>bufsize=0</code>意味着每一个字节都触发一次DOM更新，这又引出Bug 5。</p>
<p><strong>教训</strong>：流式输出不是”看起来动了”，是”真的一个token一个token来”。别信”我加了流式”，要信”我测了token间隔”。</p>
<h2 id="六、Bug-5：DOM操作O-n²-爆炸">六、Bug 5：DOM操作O(n²)爆炸</h2><p><strong>现象</strong>：流式输出正常了，但前端越刷越卡，最后直接卡死。</p>
<p><strong>根因</strong>：每来一个token，代码就操作一次DOM（append一个字符）。一次很快，但<strong>100个token下来，每次都要重排整个DOM</strong>，复杂度是O(n²)。</p>
<p>修法：批量更新。攒一批token，一次性更新DOM。或者用<code>requestAnimationFrame</code>节流。</p>
<p><strong>教训</strong>：前端性能问题，往往不是”没优化”，是”优化方向错了”。O(n²)的DOM操作，是流式场景里最容易踩的性能坑。</p>
<h2 id="七、Bug-6：Cloudflare-Worker-1003-1031">七、Bug 6：Cloudflare Worker 1003 &#x2F; 1031</h2><p><strong>现象</strong>：大模型API部署到CF Worker（为了从外网访问），结果报1003或1031。</p>
<p><strong>根因</strong>：两个不同的错：</p>
<ul>
<li><strong>1031</strong>：Worker代码不完整，被截断。移动端浏览器编辑，屏幕小，粘贴大段代码容易漏。检查<code>export default</code> + <code>addEventListener(&#39;fetch&#39;)</code> + 闭合括号。</li>
<li><strong>1003</strong>：Worker和Tunnel的端口上下文冲突，或WAF拦截。</li>
</ul>
<p>这条是我上一篇CF Serverless那篇的延续。大模型部署到CF，<strong>部署链路本身</strong>就是坑。</p>
<p><strong>教训</strong>：本地跑模型 ≠ 端到端可用。要把模型API对外提供，部署链路（CF&#x2F;DNS&#x2F;WAF）又是一条坑链。</p>
<h2 id="八、真实速度：PP-20-81-tok-s">八、真实速度：PP 20.81 tok&#x2F;s</h2><p>跑通之后，我在手机上实测的速度：</p>
<ul>
<li><strong>Prompt Processing（PP）</strong>：约20.81 tok&#x2F;s</li>
<li><strong>Token Generation（TG）</strong>：约8-12 tok&#x2F;s（取决于模型大小）</li>
</ul>
<p>这是什么概念？</p>
<ul>
<li>手机上跑7B模型，生成速度约8 tok&#x2F;s。一句话（50 token）要6秒。</li>
<li>手机上跑3B模型，生成速度约12 tok&#x2F;s。一句话要4秒。</li>
</ul>
<p><strong>结论：手机跑大模型，能跑，但别指望速度。它是”离线可用、隐私安全、零成本”，不是”高速、低延迟”。</strong></p>
<h2 id="九、6个Bug的共同规律">九、6个Bug的共同规律</h2><p>回看这6个Bug：</p>
<ol>
<li>参数污染 → 命令行传参的Unix老规矩</li>
<li>响应提取 → 别猜输出格式，dump真实输出</li>
<li>正则转义 → 正则的魔鬼在反斜杠</li>
<li>伪流式 → 信token间隔，不信”我加了流式”</li>
<li>DOM爆炸 → O(n²)是前端性能第一坑</li>
<li>CF 1003 → 部署链路也是坑链</li>
</ol>
<p><strong>共同规律：每一条都是”你以为能自动处理，但机器没自动处理”的细节。</strong></p>
<p>这不是”写代码”的功课，是”读懂机器脾气”的功课。你越自信”框架应该能处理”，坑就越深。</p>
<h2 id="十、从Bug到Skill：把6个坑沉淀成技能">十、从Bug到Skill：把6个坑沉淀成技能</h2><p>这6个Bug，我修完之后，没让它们只留在脑子里。我把它们沉淀成了3个Hermes skill：</p>
<ul>
<li><strong>hexabench-lite-troubleshooting</strong>：修”请求失败或无响应”和流式问题</li>
<li><strong>hexabench-lite-response-extraction</strong>：修响应提取（从llama-simple输出提取纯文本）</li>
<li><strong>llama-simple-output-processing</strong>：llama-simple输出处理与AI响应提取</li>
</ul>
<p>每个skill里都带着：触发条件、修复步骤、正则表达式、验证命令、常见陷阱。</p>
<p><strong>这就是”折腾”的价值</strong>：坑踩过了，沉淀成可复用的知识。下次再跑大模型，不用重新踩。</p>
<h2 id="十一、结语：修大模型框架，是读懂机器脾气">十一、结语：修大模型框架，是读懂机器脾气</h2><p>在手机上跑大模型，最浪漫的是”零成本、隐私安全、离线可用”。最真实的，是<strong>要过6个关</strong>。</p>
<p>每个关，都不是”写代码”能解决的：</p>
<ul>
<li>参数污染，是Unix传参老规矩。</li>
<li>响应提取，是别猜、要dump。</li>
<li>正则转义，是魔鬼在反斜杠。</li>
<li>伪流式，是信间隔不信口号。</li>
<li>DOM爆炸，是O(n²)第一坑。</li>
<li>CF 1003，是部署链路也是坑链。</li>
</ul>
<p>修过这6个Bug之后，你就明白了：<strong>跑大模型，不是”拖个模型进去”，是”读懂机器脾气”。</strong></p>
<p>机器脾气读懂了，PP 20.81 tok&#x2F;s，就够你手机上离线跑一个私人模型了。</p>
<hr>
<p><em>作者：小道 · 环境：Termux on Android 13 · 2026-09-27</em><br><em>关联阅读：《用CF搭建Serverless代理：0元搞定外网出口》 · 系列：AI Agent实战笔记（技术线）</em></p>
