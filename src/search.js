/**
 * search.js —— 搜索即添加
 *
 * 用户输入什么就检索什么，命中后加入「我的城市」。
 * 不预置全量列表，避免一打开就被几百个城市淹没。
 */

import { UNRANKED } from './tiers.js';

let INDEX = [];
let loaded = false;

/** 把搜索词归一化：去空格、转小写、全角转半角 */
function norm(s) {
  return String(s || '')
    .replace(/\s+/g, '')
    .toLowerCase()
    .replace(/[\uff01-\uff5e]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
    );
}

/** 拼音首字母 / 简化检索：允许用省份简称、别名命中 */
function candidates(city) {
  const list = [city.name, city.province, city.plate];
  if (Array.isArray(city.alias)) list.push(...city.alias);
  return list.filter(Boolean);
}

/**
 * 给一个城市算匹配得分，越大越相关；0 表示不匹配。
 * 优先级：名称完全等于 > 名称前缀 > 名称包含 > 别名/省份包含
 */
function score(city, q) {
  const name = norm(city.name);
  if (!name.includes(q) && !candidates(city).some((c) => norm(c).includes(q))) {
    return 0;
  }

  let s = 0;
  if (name === q) s = 1000;
  else if (name.startsWith(q)) s = 800 - (name.length - q.length);
  else if (name.includes(q)) s = 600 - name.indexOf(q);

  for (const alias of city.alias || []) {
    const a = norm(alias);
    if (a === q) s = Math.max(s, 900);
    else if (a.startsWith(q)) s = Math.max(s, 600);
    else if (a.includes(q)) s = Math.max(s, 480);
  }

  const prov = norm(city.province);
  if (prov.includes(q)) s = Math.max(s, 300);

  return s;
}

/**
 * 载入索引。
 * 单文件模式下数据以全局变量内联（window.__CITY_INDEX__），此时不走 fetch，
 * 这样 file:// 直接双击打开也能用（ES module + fetch 会被 CORS 拦死）。
 */
export async function loadIndex(url = 'data/city-index.json') {
  if (loaded) return INDEX;

  // 单文件模式：数据直接内联在页面里，同步取用，绝不碰 fetch
  // （file:// 下 fetch 会被 CORS 拦死，这是能双击打开的关键）
  const inline = globalThis.__CITY_INDEX__;
  if (Array.isArray(inline)) {
    INDEX = inline;
  } else {
    const res = await fetch(url, { cache: 'force-cache' });
    if (!res.ok) throw new Error(`城市索引加载失败（HTTP ${res.status}）`);
    INDEX = await res.json();
  }

  INDEX.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  loaded = true;
  return INDEX;
}

export function isLoaded() {
  return loaded;
}

/** 同步取索引；未载入时返回空数组（单文件模式下 main() 前已铺好数据） */
export function getIndex() {
  return INDEX;
}

export function indexSize() {
  return INDEX.length;
}

/**
 * 检索城市。
 * @param {string} query 用户输入
 * @param {object} opts  { limit, exclude: Set<id> }
 * @returns {Array} 命中的城市条目
 */
export function search(query, opts = {}) {
  const q = norm(query);
  if (!q) return [];

  const { limit = 12, exclude } = opts;
  const hits = [];

  for (const city of INDEX) {
    if (exclude && exclude.has(city.id)) continue;
    const s = score(city, q);
    if (s > 0) hits.push({ city, s });
  }

  hits.sort((a, b) => b.s - a.s || a.city.name.localeCompare(b.city.name, 'zh-Hans-CN'));
  return hits.slice(0, limit).map((h) => h.city);
}

/** 按 id 取城市全量信息（用于导入补全 / 详情展示） */
export function byId(id) {
  return INDEX.find((c) => c.id === id) || null;
}

/** 取某城市的默认初始景点（来自索引别名里的知名地标，可编辑） */
export function suggestedSpots(city) {
  return Array.isArray(city?.alias) ? city.alias.slice(0, 4) : [];
}

export { UNRANKED };
