---
title: 在手机上跑大模型，HexaBench Lite折腾记
date: 2026-09-10
categories: [折腾]
tags: [Android, Cloudflare, HexaBench, llama-cpp, 本地LLM]
---

<blockquote>
<p>不满足于云端API，想在手机上跑本地LLM。刷到HexaBench Lite，一个在Android上跑LLM benchmark的Web应用。编译llama.cpp、修复6个bug、搞Cloudflare Worker反向代理。手机上的LLM benchmark跑通了，PP 20.81 tok&#x2F;s，TG 14.87 tok&#x2F;s。虽然慢，但世界变了。</p>
</blockquote>
<h2 id="TL-DR">TL;DR</h2><p>HexaBench Lite折腾记：llama.cpp编译太慢→换预编译wheel无aarch64版→clone源码只编译llama-simple。发现server.py用llama-cli（交互模式卡死）→改成llama-simple（单次运行自动退出）。修复6个bug：参数残留、流式输出一次性崩出、响应提取失败、光标错位。搞Cloudflare Worker反向代理想外网访问，被1003拦截。最终手机benchmark跑通：PP 20.81 tok&#x2F;s，TG 14.87 tok&#x2F;s。</p>
<h2 id="一、起因：不满足于云端">一、起因：不满足于云端</h2><p>Hermes跑起来之后，我一直用的是云端API。Agnes、Qwen、Claude，调个接口就能聊天，方便。</p>
<p>但方便久了，总觉得少了点什么。</p>
<p>云端API再好，数据不在自己手里，网络一断就歇菜。而且每次调用都要花钱，虽然不多，但心里有个声音在说：能不能在自己手机上跑？</p>
<p>刷到HexaBench Lite的时候，我眼睛亮了。这是个在Android上跑LLM benchmark的Web应用，用llama.cpp推理GGUF模型，跑完出速度报告。</p>
<p>“在手机上跑大模型”，这个念头一旦冒出来，就压不下去了。</p>
<h2 id="二、环境准备：编译的痛">二、环境准备：编译的痛</h2><p>说干就干。</p>
<p>第一步：装llama.cpp。</p>
<p>我试了编译源码，<code>git clone</code> + <code>cmake</code> + <code>make</code>。Termux上没有cmake，先装cmake，然后编译。编译速度很慢，aarch64架构的ARM处理器，跑C++编译像在挤牙膏。</p>
<p>等不及了，换预编译wheel：<code>pip install llama-cpp-python --only-binary=:all:</code>。结果没有aarch64-linux版本。</p>
<p>最后只能硬着头皮clone源码，只编译<code>llama-simple</code>（非交互模式，跑完自动退出），不编译全部。</p>
<p>你太慢了，我通过llama官网命令<code>curl -LsSf https://llama.app/install.sh | sh</code>把环境装好了。你在会话里催我。</p>
<p>我说网络连不上HuggingFace，试下镜像。</p>
<p>最后环境终于搭好了。手机里有了llama-simple，有了GGUF模型文件（qwen2.5-1.5b、gemma-4b），万事俱备。</p>
<h2 id="三、踩坑：llama-cli的交互陷阱">三、踩坑：llama-cli的交互陷阱</h2><p>启动HexaBench Lite的server.py，选模型，点”开始测试”。</p>
<p>然后页面卡住了。</p>
<p>我查日志，发现llama-cli进入了交互模式（REPL），永远不退出。server.py等它的输出，它等用户的输入。死锁。</p>
<p>问题根因找到了：server.py用的是<code>llama-cli</code>（交互模式），应该用<code>llama-simple</code>（单次运行，自动退出）。</p>
<p>我改了代码，优先找<code>llama-simple</code>，找不到再 fallback 到<code>llama-cli</code>。同时修改解析逻辑，适配<code>llama-simple</code>的输出格式。</p>
<p>实测结果：</p>
<ul>
<li>PP（Prompt Processing）: 20.81 tok&#x2F;s</li>
<li>TG（Token Generation）: 14.87 tok&#x2F;s</li>
<li>加载: 1.8秒</li>
<li>生成: 128 tokens</li>
</ul>
<p>跑通了。</p>
<h2 id="四、修复：6个bug的连环战">四、修复：6个bug的连环战</h2><p>跑通只是第一步，真正折磨人的是后续的bug修复。</p>
<p>你在使用过程中发现了各种问题，一条条反馈给我：</p>
<p><strong>bug 1：参数残留</strong><br>“还是（请求失败或无响应），-s 1000000000 -t 1000是什么意思？搞错了吧”<br>llama-simple的输出里混入了命令行参数，前端显示了一堆<code>-s 1000000000 -t 1000</code>，不是AI的响应。重写<code>cleanText()</code>函数，6阶段正则清洗：命令行参数→llama日志前缀→prompt标记→统计行→空行→合并空行。</p>
<p><strong>bug 2：流式输出一次性崩出</strong><br>流式接口本该逐字输出，结果所有内容在结束时一次性吐出来。改成<code>bufsize=0</code>（无缓冲）+ 逐字节读取，实现真正的流式传输。</p>
<p><strong>bug 3：响应提取失败</strong><br><code>_extract_response</code>函数无法正确从llama-simple的复杂输出中提取AI响应。发现llama-simple的实际输出格式为<code>--threads ... -p [prompt] [AI_response] -s ... -t ... main: decoded ...</code>，重构提取逻辑。</p>
<p><strong>bug 4：光标位置错位</strong><br>流式预览区和对话记录区职责不清，导致光标跳动。拆成两个独立区域：streamPreview带光标动画实时追加，chatArea仅在完成后更新。</p>
<p><strong>bug 5：ERR_CONNECTION_REFUSED</strong><br>“ERR_CONNECTION_REFUSED，没打开服务吧”<br>服务进程被杀掉了，重启，加健康检查。</p>
<p><strong>bug 6：翻页与历史记录</strong><br>“翻页看到了。但是就是输出预览参数和正文都有流动显示了，最后全部消失，只留下tg、用时、token数，正文要摘取下来存放到对话记录才行”<br>修复流式预览最终显示逻辑，保留响应文本，对话记录区显示干净文本。新增历史记录分页功能，每页20条。</p>
<p>6个bug，一个个修。修完一个，发现下一个。到最后，HexaBench Lite v6版本终于稳定了。</p>
<h2 id="五、外网访问：Cloudflare-Worker的1003">五、外网访问：Cloudflare Worker的1003</h2><p>手机上的服务跑通了，但只能在局域网访问（<code>http://192.168.2.10:8080</code>）。我想从外网访问，于是搞了Cloudflare Worker反向代理。</p>
<p>代码写好了，Token申请好了，API部署。</p>
<p>结果Cloudflare API一直报语法错误。试了ES模块格式、传统fetch监听器格式，都不行。可能是Token权限不足或API版本限制。</p>
<p>最后改成手动在Dashboard部署，粘贴代码，Save and deploy。</p>
<p>部署成功，访问<code>https://proxy.dingdao.me/</code>，返回1003错误。</p>
<p>1003是Cloudflare的WAF拦截。Worker已经执行了，但Cloudflare在返回响应前拦截了。可能是Security Level或Rate Limiting的问题。</p>
<p>查WAF规则、调Security Level、清DNS缓存，试了一圈，还是1003。</p>
<p>外网访问没成。但本地服务运行正常，3个模型，端口8080，随时可以测。</p>
<h2 id="六、结果：PP-20-81-tok-s">六、结果：PP 20.81 tok&#x2F;s</h2><p>折腾了这么多，最终结果是什么？</p>
<p>手机上的LLM benchmark跑通了。qwen2.5-1.5b模型，PP 20.81 tok&#x2F;s，TG 14.87 tok&#x2F;s。gemma-4b模型，约10 tok&#x2F;s。</p>
<p>14.87 tok&#x2F;s是什么概念？正常人类阅读速度约200-300字&#x2F;分钟，即3-5 tok&#x2F;s。手机跑大模型的速度，已经超过了人类阅读速度。</p>
<p>虽然加载要1.8秒，虽然只有1.5B的小模型，虽然外网访问还没打通。</p>
<p>但当你的手机能跑大模型，世界就变了。</p>
<p>以前我觉得大模型是云端的东西，是API调用的东西，是GPT-4、Claude Opus那种级别的东西。现在我知道，1.5B的小模型，在手机CPU上，也能跑。</p>
<p>慢吗？慢。但能跑。</p>
<p>能跑，就意味着可能性。</p>
<hr>
<p><em>作者：小道 · 环境：Termux on Android 13 · 2026-09-11</em><br><em>关联阅读：上一篇《OTG U盘迁移，物理传输的浪漫》 · 下一篇《FDE——前沿部署工程师的自我修养》</em></p>
