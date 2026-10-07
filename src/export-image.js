/**
 * export-image.js —— 把当前排行画成一张竖版长图
 *
 * 为什么要手写 Canvas 而不是截图库：
 *   这个应用是单文件 HTML，双击 file:// 打开就得能用，
 *   不能引入 html2canvas / dom-to-image 这类外部库，也不能联网。
 *   所以这里直接用原生 Canvas 2D 把五档横条画出来。
 *
 * 版式参照网上通行的那种 Tier 表：一档一条横杠，左边是档位名，
 * 右边平铺该档的城市卡片，整张竖着往下载出。
 */

import { sortedTiers, getTier, UNRANKED } from './tiers.js';

/* 缩放倍率：2 倍导出，手机上放大看也不糊 */
const SCALE = 2;

/* 尺寸（CSS px，实际绘制时统一乘 SCALE） */
const W = 1080;
const PAD = 44;
const HEADER_H = 168;
const FOOTER_H = 96;
const ROW_GAP = 16;
const LABEL_W = 190;
const ROW_PAD = 18;
const CARD_W = 168;
const CARD_H = 92;
const CARD_GAP = 12;

const COLORS = {
  bg: '#0e1013',
  header: '#16191d',
  rowBg: '#16191d',
  cardBg: '#1d2126',
  cardBgUnranked: '#171a1e',
  border: '#2a2f36',
  text: '#e8eaed',
  textDim: '#9aa3ad',
  textFaint: '#6b747e',
  accent: '#e6b422',
};

/** 圆角矩形路径（老 Safari 没有 roundRect，自己画） */
function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function fillRound(ctx, x, y, w, h, r, color) {
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = color;
  ctx.fill();
}

function strokeRound(ctx, x, y, w, h, r, color, lw = 1) {
  roundRect(ctx, x, y, w, h, r);
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.stroke();
}

/** 把一段文字按最大宽度截断，超出补省略号 */
function fitText(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  const ell = '…';
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + ell).width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo) + ell : ell;
}

/**
 * 结合当前筛选状态，算出每一档要画哪些城市。
 * @param {Array} cities  store.getCities()
 * @param {Object} opts   {level: '全部'|levelId, province: '全部'|省名}
 */
function groupForExport(cities, opts = {}) {
  const levelFilter = opts.level || 'all';
  const provinceFilter = opts.province || '';

  const keep = cities.filter((c) => {
    if (provinceFilter && c.province !== provinceFilter) return false;
    return true;
  });

  const byLevel = new Map();
  for (const t of sortedTiers()) byLevel.set(t.id, []);
  byLevel.set(UNRANKED.id, []);

  for (const c of keep) {
    const id = byLevel.has(c.level) ? c.level : UNRANKED.id;
    byLevel.get(id).push(c);
  }

  // 档内按用户拖出来的 order 排，没定级的按加入顺序
  for (const [, arr] of byLevel) {
    arr.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  let levels = sortedTiers();
  if (levelFilter && levelFilter !== 'all') {
    levels = levels.filter((t) => t.id === levelFilter);
  }
  // 未定级永远最后单独一档（除非用户只筛了某一档）
  const showUnranked = !levelFilter || levelFilter === 'all' || levelFilter === UNRANKED.id;
  if (showUnranked) levels = [...levels, UNRANKED];

  return { levels, byLevel };
}

/** 计算整张图的高度 */
function measure(levels, byLevel, columns) {
  let h = HEADER_H;
  for (const lv of levels) {
    const n = byLevel.get(lv.id).length;
    const rows = Math.max(1, Math.ceil(n / columns));
    const contentH = rows * CARD_H + (rows - 1) * CARD_GAP;
    h += Math.max(CARD_H + ROW_PAD * 2, contentH + ROW_PAD * 2) + ROW_GAP;
  }
  h += FOOTER_H;
  return h;
}

/**
 * 画图。
 * @returns {Promise<HTMLCanvasElement>}
 */
export function renderTierImage(cities, opts = {}) {
  const { levels, byLevel } = groupForExport(cities, opts);

  // 先量一次确定列数，再按列数算高度（列数只取决于宽度，不依赖高度，无循环依赖）
  const availW = W - PAD * 2 - LABEL_W - ROW_PAD;
  const columns = Math.max(1, Math.floor((availW + CARD_GAP) / (CARD_W + CARD_GAP)));

  const H = measure(levels, byLevel, columns);

  const canvas = document.createElement('canvas');
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);

  // 背景
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, W, H);

  // ---------------- 头部 ----------------
  ctx.fillStyle = COLORS.header;
  ctx.fillRect(0, 0, W, HEADER_H);

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  ctx.font = '700 54px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
  ctx.fillStyle = COLORS.accent;
  ctx.fillText('夯', PAD, 82);
  const hangW = ctx.measureText('夯').width;
  ctx.fillStyle = COLORS.textDim;
  ctx.fillText('→', PAD + hangW + 10, 82);
  const arrowW = ctx.measureText('→').width;
  ctx.fillStyle = '#c0392b';
  ctx.fillText('拉', PAD + hangW + arrowW + 20, 82);

  ctx.font = '500 26px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
  ctx.fillStyle = COLORS.textDim;
  ctx.fillText('我的城市旅游排行', PAD, 126);

  // 右上角统计
  const total = [...byLevel.values()].reduce((a, arr) => a + arr.length, 0);
  const ranked = total - byLevel.get(UNRANKED.id).length;
  const provCount = new Set(
    [...byLevel.values()].flat().map((c) => c.province).filter(Boolean)
  ).size;

  ctx.textAlign = 'right';
  ctx.font = '600 30px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
  ctx.fillStyle = COLORS.text;
  ctx.fillText(`${total} 座城市`, W - PAD, 78);
  ctx.font = '400 22px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
  ctx.fillStyle = COLORS.textFaint;
  ctx.fillText(`已定级 ${ranked} · 覆盖 ${provCount} 省`, W - PAD, 114);

  // 细分隔线
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, HEADER_H - 0.5);
  ctx.lineTo(W, HEADER_H - 0.5);
  ctx.stroke();

  // ---------------- 五档横条 ----------------
  let y = HEADER_H + ROW_GAP;

  for (const lv of levels) {
    const arr = byLevel.get(lv.id) || [];
    const rows = Math.max(1, Math.ceil(arr.length / columns));
    const contentH = rows * CARD_H + (rows - 1) * CARD_GAP;
    const rowH = Math.max(CARD_H + ROW_PAD * 2, contentH + ROW_PAD * 2);
    const isUnranked = lv.id === UNRANKED.id;

    // 条底
    fillRound(ctx, PAD, y, W - PAD * 2, rowH, 14, COLORS.rowBg);

    // 左侧档位块
    const labelX = PAD + 8;
    const labelY = y + 8;
    const labelH = rowH - 16;
    if (isUnranked) {
      strokeRound(ctx, labelX, labelY, LABEL_W, labelH, 10, COLORS.border, 1.5);
    } else {
      fillRound(ctx, labelX, labelY, LABEL_W, labelH, 10, lv.color);
    }

    const lx = labelX + LABEL_W / 2;
    ctx.textAlign = 'center';
    ctx.font = '800 40px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
    ctx.fillStyle = isUnranked ? COLORS.textDim : '#12151a';
    ctx.fillText(lv.name, lx, labelY + labelH / 2 - 2);

    ctx.font = '500 18px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
    ctx.fillStyle = isUnranked ? COLORS.textFaint : 'rgba(18,21,26,0.68)';
    ctx.fillText(lv.sub || '', lx, labelY + labelH / 2 + 26);

    // 档位计数角标
    ctx.font = '700 18px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
    ctx.fillStyle = isUnranked ? COLORS.textFaint : 'rgba(18,21,26,0.85)';
    ctx.fillText(String(arr.length), lx, labelY + 26);

    // 城市卡片
    const gridX = PAD + ROW_PAD + LABEL_W;
    const gridW = W - PAD * 2 - ROW_PAD * 2 - LABEL_W;
    const cols = Math.max(1, Math.floor((gridW + CARD_GAP) / (CARD_W + CARD_GAP)));
    const usedW = cols * CARD_W + (cols - 1) * CARD_GAP;
    const offsetX = gridX + Math.max(0, (gridW - usedW) / 2);

    const gridTop = y + (rowH - contentH) / 2;

    arr.forEach((c, i) => {
      const r = Math.floor(i / cols);
      const col = i % cols;
      const cx = offsetX + col * (CARD_W + CARD_GAP);
      const cy = gridTop + r * (CARD_H + CARD_GAP);

      fillRound(ctx, cx, cy, CARD_W, CARD_H, 10, isUnranked ? COLORS.cardBgUnranked : COLORS.cardBg);
      strokeRound(ctx, cx, cy, CARD_W, CARD_H, 10, COLORS.border, 1);

      // 左侧档位色条
      ctx.save();
      roundRect(ctx, cx, cy, CARD_W, CARD_H, 10);
      ctx.clip();
      ctx.fillStyle = isUnranked ? COLORS.textFaint : lv.color;
      ctx.globalAlpha = isUnranked ? 0.5 : 0.95;
      ctx.fillRect(cx, cy, 5, CARD_H);
      ctx.restore();

      // 城市名
      ctx.textAlign = 'left';
      ctx.font = '700 28px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
      ctx.fillStyle = isUnranked ? COLORS.textDim : COLORS.text;
      const nameText = fitText(ctx, c.name, CARD_W - 30);
      ctx.fillText(nameText, cx + 16, cy + 40);

      // 省份 + 景点数
      ctx.font = '400 18px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
      ctx.fillStyle = COLORS.textFaint;
      const spots = (c.spots || []).length;
      let sub = c.province || '';
      if (spots) sub += ` · ${spots}景`;
      sub = fitText(ctx, sub, CARD_W - 30);
      ctx.fillText(sub, cx + 16, cy + 70);
    });

    if (arr.length === 0) {
      ctx.textAlign = 'left';
      ctx.font = '400 22px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
      ctx.fillStyle = COLORS.textFaint;
      ctx.fillText('这一档还是空的', gridX + 6, y + rowH / 2 + 8);
    }

    y += rowH + ROW_GAP;
  }

  // ---------------- 页脚 ----------------
  ctx.textAlign = 'left';
  ctx.font = '400 20px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
  ctx.fillStyle = COLORS.textFaint;
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
  ctx.fillText(`从夯到拉 · 我的城市旅游排行 · ${stamp}`, PAD, y + 22);

  ctx.textAlign = 'right';
  ctx.fillText('夯 → 顶级 → 人上人 → NPC → 拉完了', W - PAD, y + 22);

  return canvas;
}

/** 画好并触发下载 */
export async function exportTierImage(cities, opts = {}) {
  const canvas = renderTierImage(cities, opts);

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('图片生成失败'))), 'image/png');
  });

  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(
    d.getDate()
  ).padStart(2, '0')}`;
  const filename = `从夯到拉-排行-${stamp}.png`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  return { filename, canvas, blob };
}
