// 注册 xd-extend.js / xd-extend.css 到 theme.injects，让 hexo 自动把主题 source/ 里的文件发布到 public/
// 并在 bodyEnd / head 注入
'use strict';
const path = require('path');

hexo.extend.filter.register('theme_inject', injects => {
  injects.bodyEnd.file('xd-extend', path.join(hexo.theme_dir, 'layout/_third-party/xd-extend.njk'));
});
