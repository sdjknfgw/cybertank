/* 从 index.html 抽取内联的 tailwind.config，生成 CLI 可用的 tailwind.config.js */
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const m = html.match(/tailwind\.config\s*=\s*(\{[\s\S]*?\})\s*<\/script>/);
if (!m) { console.error('未找到内联 tailwind.config'); process.exit(1); }
let objSrc = m[1];
// 去掉末尾可能残留的分号
objSrc = objSrc.replace(/;\s*$/, '');

let cfg;
try {
  // 用 new Function 安全求值（源可信：本地项目文件）
  cfg = new Function('return (' + objSrc + ')')();
} catch (e) {
  console.error('解析内联配置失败:', e.message);
  process.exit(1);
}

const out = {
  content: [
    path.join(__dirname, '..', 'index.html'),
    path.join(__dirname, '..', 'js', '**', '*.js'),
    path.join(__dirname, '..', 'css', '**', '*.css'),
  ],
  theme: cfg.theme || {},
  corePlugins: { preflight: true },
};
// 保留 extend 之外的顶层字段（如 darkMode）
for (const k of Object.keys(cfg)) {
  if (k !== 'theme' && !(k in out)) out[k] = cfg[k];
}

fs.writeFileSync(
  path.join(__dirname, 'tailwind.config.js'),
  '/* 由 extract-config.js 从 index.html 内联配置自动生成，请勿手改 */\nmodule.exports = ' +
  JSON.stringify(out, null, 2) + ';\n'
);

console.log('已生成 tailwind.config.js');
console.log('  theme.extend 字段:', Object.keys((cfg.theme && cfg.theme.extend) || {}).join(', '));
console.log('  colors:', Object.keys((cfg.theme && cfg.theme.extend && cfg.theme.extend.colors) || {}).join(', '));
console.log('  animation:', Object.keys((cfg.theme && cfg.theme.extend && cfg.theme.extend.animation) || {}).length + ' 条');
