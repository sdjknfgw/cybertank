/* ==========================================================
 * CyberTank — 部署配置（前端唯一需要修改的文件）
 * ==========================================================
 * 自动切换逻辑（无需手动改动）：
 *   - 本地运行（file:// 或 http://localhost / 局域网 IP，
 *     即双击「启动游戏.bat」或直接打开 index.html）
 *     → 留空 CT_API_BASE = 同源本地后端（python server.py）
 *
 *   - 网页部署（https:// 开头，如 GitHub Pages）
 *     → 自动使用下方 CLOUD_API 云端后端（Cloudflare Workers + D1）
 *
 * 云端后端信息（2026-09-17 部署）：
 *   地址：  https://cybertank.cybertank-2314514243.workers.dev/api
 *   账号：  Cloudflare 2314514243@qq.com
 *   数据库：D1 "cybertank"（用户/成绩/云存档持久化）
 *
 * ⚠ 国内直连 workers.dev 被阻断（DNS+SNI 双重污染）：
 *   海外/代理网络可正常使用；国内访客需绑定自定义域名后
 *   将 CLOUD_API 改为 https://api.你的域名/api 即可。
 * ========================================================== */
(function () {
    'use strict';
    var CLOUD_API = 'https://cybertank.cybertank-2314514243.workers.dev/api';
    // https 环境（GitHub Pages 等网页部署）走云端；本地（file://、localhost、局域网）走同源后端
    window.CT_API_BASE = (location.protocol === 'https:') ? CLOUD_API : '';
})();
