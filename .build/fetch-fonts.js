/* 下载 Google Fonts 的 woff2 到本地并生成自托管 @font-face CSS。
 * 目的：微信内置浏览器（尤其国内网络）访问 fonts.googleapis.com / fonts.gstatic.com
 * 极慢或直接失败，会导致样式加载阻塞、文字闪烁。生产环境必须自托管。 */
const fs = require('fs'), path = require('path'), https = require('https');

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
const CSS_URL = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700&family=Share+Tech+Mono&family=JetBrains+Mono:wght@400;700;800&display=swap';

const FONT_DIR = path.join(__dirname, '..', 'dist', 'fonts');
const OUT_CSS = path.join(__dirname, '..', 'dist', 'css', 'fonts.css');
fs.mkdirSync(FONT_DIR, { recursive: true });

function get(url, binary) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(get(res.headers.location, binary));
      }
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode + ' ' + url));
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve(binary ? buf : buf.toString('utf8'));
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(new Error('timeout ' + url)); });
  });
}

(async () => {
  console.log('获取字体 CSS …');
  const css = await get(CSS_URL, false);

  /* Google 的 CSS 形如：
   *   /* latin *​/
   *   @font-face { font-family:'X'; font-style:normal; font-weight:400; font-display:swap;
   *                src:url(https://fonts.gstatic.com/...woff2) format('woff2');
   *                unicode-range:U+0000-00FF,...; }
   * 只保留 latin / latin-ext 两个子集（本项目字体均不含中日韩字形，
   * 中文由 PingFang SC / 系统字体兜底），显著减少文件数与体积。 */
  const blocks = css.split('@font-face').slice(1);
  const faces = [];
  let subset = '';
  for (const raw of blocks) {
    const head = raw.slice(0, raw.indexOf('{'));
    const cm = raw.match(/\/\*\s*([a-z-]+)\s*\*\//);
    // 子集标记出现在 @font-face 之前，落在上一个块的尾部；这里用块内注释兜底
    const subM = head.match(/\/\*\s*([a-z-]+)\s*\*\/\s*$/);
    if (subM) subset = subM[1];
    else if (cm) subset = cm[1];
    if (subset !== 'latin' && subset !== 'latin-ext') continue;

    const fam = (raw.match(/font-family:\s*'([^']+)'/) || [])[1];
    const weight = (raw.match(/font-weight:\s*(\d+)/) || [])[1] || '400';
    const style = (raw.match(/font-style:\s*([a-z]+)/) || [])[1] || 'normal';
    const url = (raw.match(/url\((https:[^)]+\.woff2)\)/) || [])[1];
    const range = (raw.match(/unicode-range:\s*([^;]+);/) || [])[1];
    if (!fam || !url) continue;
    faces.push({ fam, weight, style, url, range, subset });
  }

  console.log('命中 latin/latin-ext 字体面:', faces.length);
  const out = [];
  for (const f of faces) {
    const slug = (f.fam + '-' + f.weight + '-' + f.subset).replace(/[^A-Za-z0-9]+/g, '_').toLowerCase() + '.woff2';
    const file = path.join(FONT_DIR, slug);
    if (!fs.existsSync(file)) {
      const buf = await get(f.url, true);
      fs.writeFileSync(file, buf);
      console.log('  下载', slug, (buf.length / 1024).toFixed(1) + 'KB');
    } else {
      console.log('  已存在', slug);
    }
    out.push(
      "@font-face{font-family:'" + f.fam + "';font-style:" + f.style + ";font-weight:" + f.weight +
      ";font-display:swap;src:url('../fonts/" + slug + "') format('woff2')" +
      (f.range ? ';unicode-range:' + f.range.trim() : '') + ";}"
    );
  }

  if (!out.length) { console.error('未解析到任何字体面，中止'); process.exit(1); }
  fs.writeFileSync(OUT_CSS, '/* 自托管字体：替代 Google Fonts，避免微信/国内网络加载失败 */\n' + out.join('\n') + '\n');
  console.log('已生成 dist/css/fonts.css，共', out.length, '条 @font-face');
})().catch((e) => { console.error('失败:', e.message); process.exit(1); });
