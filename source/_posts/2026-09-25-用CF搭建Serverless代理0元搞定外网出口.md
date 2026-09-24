---
title: 用CF搭建Serverless代理：0元搞定外网出口
date: 2026-09-25
categories: [折腾]
tags: [Cloudflare, Serverless, 代理, 技术线, 架构]
---

<blockquote>
<p>朋友问我：你手机连不上GitHub，咋办？我：我租了个”代理”，0元。他用CF搭了个Serverless HTTP代理出口，机器在本地，路在云端——这是”为什么不上云”的姊妹篇。</p>
</blockquote>
<h2 id="TL-DR">TL;DR</h2><p>CF Workers是Serverless的免费额度天花板：10万次请求&#x2F;月、无需VPS、5分钟上线。但坑也多：<code>.workers.dev</code>域名解析到专用IP会不通，得绑自定义域名走CDN IP；WAF会403拦截；cfut_和cfat_ token混淆会8000096报错。用CF搭Serverless代理，不是”上云”，是”借云”——数据留在本地，出口借云穿墙。</p>
<h2 id="一、起因：手机连不上GitHub">一、起因：手机连不上GitHub</h2><p>Hermes在Termux里跑，要访问GitHub、Google、DuckDuckGo。手机在国内网络，这些站点要么被墙要么不稳定。</p>
<p>朋友问：”你租个VPS做代理呗，一年一千多。”</p>
<p>我：”不用，CF有免费额度，5分钟搞定。”</p>
<p>这就是Serverless的价值：<strong>不用买机器，不用管运维，按量付费（免费额度内0元）</strong>。但坑也不少，今天把这套”借云穿墙”的架构和踩过的坑，摊开讲一遍。</p>
<h2 id="二、CF-Workers：Serverless的免费额度天花板">二、CF Workers：Serverless的免费额度天花板</h2><p>CF Workers的免费额度：</p>
<ul>
<li><strong>10万次请求&#x2F;月</strong>，够用。Hermes日常调用（搜索、爬虫、API）一天几百次，一个月几千次，远没到上限。</li>
<li><strong>无需VPS</strong>：代码跑在CF全球边缘节点上，没有”机器”要管。</li>
<li><strong>5分钟上线</strong>：Dashboard里粘贴代码，点Deploy，DNS生效，完事。</li>
</ul>
<p>对比VPS：</p>
<ul>
<li>VPS要买、要配、要管、要防挂。CF Workers零运维。</li>
<li>VPS固定成本一年一千多。CF Workers免费额度内0元。</li>
</ul>
<p>Serverless的核心逻辑：<strong>不用为”机器”付费，只为”跑起来的那一刻”付费。</strong> 免费额度内，跑起来也是0元。</p>
<h2 id="三、架构：机器在本地，路在云端">三、架构：机器在本地，路在云端</h2><figure class="highlight plaintext"><table><tr><td class="gutter"><pre><span class="line">1</span><br><span class="line">2</span><br><span class="line">3</span><br><span class="line">4</span><br></pre></td><td class="code"><pre><span class="line">Hermes/Curl → https://proxy.dingdao.me/proxy?url=&lt;目标URL&gt;</span><br><span class="line">            → CF全球边缘节点（CDN IP 104.x）</span><br><span class="line">            → 目标网站</span><br><span class="line">            → 返回结果给Hermes</span><br></pre></td></tr></table></figure>

<p>关键点：<strong>自定义域名走CDN IP（104.x），稳定。</strong></p>
<p>为什么不用CF默认的<code>.workers.dev</code>子域名？因为它解析到Workers专用IP（173.x&#x2F;108.x），某些网络不通。绑自定义域名后走CDN IP，实测稳定。</p>
<p>这就是”机器在本地，路在云端”：</p>
<ul>
<li><strong>机器</strong>：Hermes、数据库、日志、持仓，全在手机上。</li>
<li><strong>路</strong>：CF Worker做HTTP代理出口，数据经CF边缘节点传到目标网站。</li>
</ul>
<p><strong>数据没进CF的机房，只借了CF的”路”。</strong> 这是Serverless和VPS的本质区别——你租的是”带宽”，不是”机器”。</p>
<h2 id="四、踩过的坑（按频率排序）">四、踩过的坑（按频率排序）</h2><p><strong>坑1：<code>.workers.dev</code>域名不通</strong></p>
<p>CF默认子域名解析到Workers专用IP，Termux网络不通。</p>
<p>解决：Dashboard → DNS → 添加CNAME（<code>proxy.dingdao.me</code> → Worker）→ 等1-2分钟生效。</p>
<p><strong>坑2：部署后403&#x2F;1010（WAF拦截）</strong></p>
<p>CF的WAF默认Security Level高，会拦”可疑请求”。</p>
<p>解决：Dashboard → Security → WAF → Security Level调低到Low → 关Bot Fight Mode。</p>
<p><strong>坑3：Error 1031（代码不完整）</strong></p>
<p>CF Dashboard预览面板报1031，根因是Worker代码被截断（移动端屏幕小，一次性粘贴大段代码容易漏）。</p>
<p>排查：检查<code>export default</code>&#x2F;<code>addEventListener(&#39;fetch&#39;, ...)</code> + <code>async fetch</code> + 闭合括号是否完整。</p>
<p><strong>坑4：cfut_ vs cfat_ token混淆</strong></p>
<p>CF有两类token：</p>
<ul>
<li><code>cfut_</code>：API Token，操作DNS&#x2F;Workers&#x2F;Pages&#x2F;R2</li>
<li><code>cfat_</code>：R2 S3兼容令牌，只能用于R2对象存储</li>
</ul>
<p>用<code>cfat_</code>调Pages API会报<strong>8000096</strong>（Token没Pages部署权限）。</p>
<p>排查：<code>curl https://api.cloudflare.com/client/v4/user/tokens/verify</code>，看permissions是否为空。</p>
<p><strong>坑5：Pages Direct Upload API manifest路径错</strong></p>
<p><code>manifest.routes[].script</code>必须指向<code>functions/</code>子目录下的文件，不能放根目录。</p>
<h2 id="五、实测可用站点">五、实测可用站点</h2><table>
<thead>
<tr>
<th>站点</th>
<th>状态</th>
<th>备注</th>
</tr>
</thead>
<tbody><tr>
<td>GitHub API</td>
<td>✅</td>
<td>需透传User-Agent</td>
</tr>
<tr>
<td>Wikipedia</td>
<td>✅</td>
<td>需默认UA，否则403</td>
</tr>
<tr>
<td>DuckDuckGo HTML</td>
<td>✅</td>
<td>网页搜索可用</td>
</tr>
<tr>
<td>Bing Search</td>
<td>✅</td>
<td>v6自动跟随重定向</td>
</tr>
<tr>
<td>Arxiv API</td>
<td>✅</td>
<td>论文搜索正常</td>
</tr>
<tr>
<td>HackerNews API</td>
<td>✅</td>
<td>JSON数据正常</td>
</tr>
<tr>
<td>Google Search</td>
<td>⚠️</td>
<td>代理没问题，Google自身429限流</td>
</tr>
<tr>
<td>SearXNG公共实例</td>
<td>❌</td>
<td>全部403&#x2F;429&#x2F;Bot拦截</td>
</tr>
</tbody></table>
<p><strong>结论：CF Worker做HTTP代理出口，能覆盖90%的日常需求。</strong> 剩下的10%（Google限流、SearXNG全挂），是目标站自己的反爬，跟代理无关。</p>
<h2 id="六、新设备5分钟部署">六、新设备5分钟部署</h2><ol>
<li>CF Dashboard → Workers &amp; Pages → Create Worker</li>
<li>粘贴v6模板代码，改API_KEY</li>
<li>Save and Deploy</li>
<li>DNS添加CNAME → 自定义域名指向Worker</li>
<li>验证：<code>curl https://proxy.dingdao.me/health -H &quot;Authorization: Bearer ***&quot;</code></li>
</ol>
<p><strong>注意：创建的是Workers不是Pages。</strong> 进错入口是新手第一坑。</p>
<h2 id="七、安全提醒">七、安全提醒</h2><ul>
<li><strong>API_KEY是访问密钥</strong>：知道URL+Key的人就能用你的免费额度。定期轮换。</li>
<li><strong>Worker代码只允许http&#x2F;https协议</strong>：防止SSRF。</li>
<li><strong>敏感头过滤</strong>：Authorization&#x2F;Cookie&#x2F;Proxy-Authorization等不透传到目标站。</li>
</ul>
<h2 id="八、Serverless-vs-VPS：本质区别">八、Serverless vs VPS：本质区别</h2><table>
<thead>
<tr>
<th>维度</th>
<th>VPS</th>
<th>CF Worker（Serverless）</th>
</tr>
</thead>
<tbody><tr>
<td>机器</td>
<td>租整台</td>
<td>没有机器，跑在边缘节点</td>
</tr>
<tr>
<td>成本</td>
<td>固定一年一千多</td>
<td>免费额度内0元</td>
</tr>
<tr>
<td>运维</td>
<td>配、管、防挂</td>
<td>粘贴代码，点Deploy</td>
</tr>
<tr>
<td>数据</td>
<td>在VPS机房</td>
<td>留在本地，只借带宽</td>
</tr>
<tr>
<td>灵活性</td>
<td>受机器限制</td>
<td>全球边缘节点，NAT穿透</td>
</tr>
</tbody></table>
<p><strong>Serverless的核心逻辑：你租的是”带宽”，不是”机器”。</strong> 数据留在本地，出口借云穿墙。这是”为什么不上云”的正面回答——不是不上云，是<strong>只借云的路，不租云的机器</strong>。</p>
<h2 id="九、CF-Manager：多账户统一管理">九、CF Manager：多账户统一管理</h2><p>CF免费额度最大化，一个技巧是<strong>多账户</strong>（业务隔离、额度叠加、新功能灰度）。但官方Dashboard不支持多账户统一管理。</p>
<p>CF Manager（开源项目）解决这个痛点：</p>
<ul>
<li>多账户Zone汇总 + DNS CRUD</li>
<li>跨账户一键部署Worker</li>
<li>KV&#x2F;D1&#x2F;R2存储管理</li>
<li>隧道和回源可视化编辑</li>
<li>AI工作台（对话&#x2F;文生图&#x2F;TTS&#x2F;翻译）</li>
</ul>
<p><strong>启示：CF的Serverless生态比想象中深，不只是”粘个Worker”，还有一整套多账户+存储+隧管的工具链。</strong></p>
<h2 id="十、结语：借云，不租云">十、结语：借云，不租云</h2><p>朋友问”为什么不租VPS”，我现在的回答是：</p>
<p><strong>VPS是租机器，CF Worker是借带宽。</strong> 数据留在手机里，出口借CF边缘节点穿墙。免费额度内0元，5分钟上线，零运维。</p>
<p>不是不上云，是<strong>只借云的路，不租云的机器。</strong> 这是Serverless的精髓，也是我”数据在自己手里”那条底线的延伸。</p>
<hr>
<p><em>作者：小道 · 环境：Termux on Android 13 · 2026-09-26</em><br><em>关联阅读：《为什么不在云上跑，一台手机就是AI服务器》 · 系列：AI Agent实战笔记（技术线）</em></p>
