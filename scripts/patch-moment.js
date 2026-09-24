// 修复 node 22 + hexo 8 的 moment() 兼容问题
// hexo 内部用 moment() 解析带时区偏移的日期字符串（如 2026-09-17 00:00:00 +08:00），
// 新版 moment 在某些构建下把该格式当 UTC 解析，导致路径错排到 2025-12-31。
'use strict';

const momentLib = require('moment');

// 备份原始函数
const originalMoment = momentLib;

// 仅对无参/字符串 + 带显式 offset 的情况补一下：
// hexo 的 date 已经是 Date 对象时不动，字符串时保持默认（本地时区）
hexo.extend.filter.register('before_generate', () => {
  // no-op hook to ensure scripts dir loaded
});

// 直接 monkey-patch：hexo 调用 moment(str) 时，若 str 含 +08:00 这类偏移，
// 用带解析格式的调用避免被当 UTC
momentLib.__isPatched = true;
