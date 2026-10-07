/**
 * store.js —— 状态层
 *
 * 职责：
 *  1. 持有「我的城市」列表（用户去过并想排名的城市）
 *  2. localStorage 持久化
 *  3. 导出 / 导入 JSON 备份
 *  4. 发布订阅，视图层订阅变化
 *
 * 数据结构（v1）：
 * {
 *   "version": 1,
 *   "updatedAt": "2026-10-06T12:00:00.000Z",
 *   "cities": [
 *     {
 *       "id": "敦煌",              // 与 city-index.json 的 id 对应
 *       "name": "敦煌",
 *       "province": "甘肃省",
 *       "lng": 94.66,
 *       "lat": 40.14,
 *       "level": "hang",          // 五档 id 或 "none"（未定级）
 *       "order": 0,               // 同一档位内的手动排序
 *       "note": "",               // 用户备注
 *       "spots": [],              // 景点，字符串数组
 *       "visitedAt": "2026-10-06T12:00:00.000Z"
 *     }
 *   ]
 * }
 */

import { UNRANKED, isRanked } from './tiers.js';

const STORAGE_KEY = 'hangdao-la-v1';
const SCHEMA_VERSION = 1;

let state = {
  version: SCHEMA_VERSION,
  updatedAt: null,
  cities: [],
};

const listeners = new Set();

/* ------------------------------------------------------------------ */
/* 持久化                                                              */
/* ------------------------------------------------------------------ */

function nowISO() {
  return new Date().toISOString();
}

function safeParse(raw) {
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    if (!Array.isArray(data.cities)) return null;
    return normalize(data);
  } catch {
    return null;
  }
}

/** 把任意来源的数据规整成合法状态，坏字段丢弃而不是整体失败 */
function normalize(data) {
  const cities = [];
  const seen = new Set();

  for (const raw of data.cities) {
    if (!raw || typeof raw !== 'object') continue;
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);

    cities.push({
      id,
      name: typeof raw.name === 'string' && raw.name ? raw.name : id,
      province: typeof raw.province === 'string' ? raw.province : '',
      lng: Number.isFinite(raw.lng) ? raw.lng : null,
      lat: Number.isFinite(raw.lat) ? raw.lat : null,
      level: typeof raw.level === 'string' ? raw.level : UNRANKED.id,
      order: Number.isFinite(raw.order) ? raw.order : cities.length,
      note: typeof raw.note === 'string' ? raw.note : '',
      spots: Array.isArray(raw.spots)
        ? raw.spots.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim())
        : [],
      visitedAt: typeof raw.visitedAt === 'string' ? raw.visitedAt : nowISO(),
    });
  }

  return {
    version: SCHEMA_VERSION,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : nowISO(),
    cities,
  };
}

export function load() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    // 隐私模式 / 存储被禁用 —— 退化为内存态，不阻塞使用
    emit();
    return state;
  }
  if (raw) {
    const parsed = safeParse(raw);
    if (parsed) {
      state = parsed;
    }
  }
  emit();
  return state;
}

export function save() {
  state.updatedAt = nowISO();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('[store] 保存失败（可能是存储配额或隐私模式）：', err);
    emit('save-failed');
    return false;
  }
  emit();
  return true;
}

/* ------------------------------------------------------------------ */
/* 订阅                                                                */
/* ------------------------------------------------------------------ */

function emit(reason) {
  for (const fn of listeners) {
    try {
      fn(state, reason);
    } catch (err) {
      console.error('[store] 订阅者抛错：', err);
    }
  }
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState() {
  return state;
}

export function getCities() {
  return state.cities;
}

/* ------------------------------------------------------------------ */
/* 查询                                                                */
/* ------------------------------------------------------------------ */

export function hasCity(id) {
  return state.cities.some((c) => c.id === id);
}

export function getCity(id) {
  return state.cities.find((c) => c.id === id) || null;
}

/** 按档位分组；返回 Map<levelId, City[]>，组内按 order 升序 */
export function groupByLevel() {
  const groups = new Map();
  for (const c of state.cities) {
    if (!groups.has(c.level)) groups.set(c.level, []);
    groups.get(c.level).push(c);
  }
  for (const arr of groups.values()) {
    arr.sort((a, b) => a.order - b.order);
  }
  return groups;
}

export function stats() {
  const byLevel = {};
  let ranked = 0;
  let spots = 0;
  for (const c of state.cities) {
    byLevel[c.level] = (byLevel[c.level] || 0) + 1;
    if (isRanked(c.level)) ranked += 1;
    spots += c.spots.length;
  }
  return {
    total: state.cities.length,
    ranked,
    unranked: state.cities.length - ranked,
    spots,
    byLevel,
    provinces: new Set(state.cities.map((c) => c.province).filter(Boolean)).size,
  };
}

/* ------------------------------------------------------------------ */
/* 变更                                                                */
/* ------------------------------------------------------------------ */

/** 加入一个城市（列表即「去过」清单）。重复加入返回 null。 */
export function addCity(entry) {
  if (!entry || !entry.id) return null;
  if (hasCity(entry.id)) return null;

  const city = {
    id: entry.id,
    name: entry.name || entry.id,
    province: entry.province || '',
    lng: Number.isFinite(entry.lng) ? entry.lng : null,
    lat: Number.isFinite(entry.lat) ? entry.lat : null,
    level: entry.level || UNRANKED.id,
    order: state.cities.length,
    note: '',
    spots: Array.isArray(entry.spots) ? entry.spots.slice() : [],
    visitedAt: nowISO(),
  };

  state.cities.push(city);
  save();
  return city;
}

export function addMany(entries) {
  let added = 0;
  for (const e of entries) {
    if (addCity(e)) added += 1;
  }
  if (added) save();
  return added;
}

export function removeCity(id) {
  const i = state.cities.findIndex((c) => c.id === id);
  if (i < 0) return false;
  state.cities.splice(i, 1);
  reindex();
  save();
  return true;
}

/** 移动城市到指定档位。toIndex 为该档位内的目标下标（省略则追加到末尾）。 */
export function setLevel(id, levelId, toIndex) {
  const city = getCity(id);
  if (!city) return false;

  const target = levelId || UNRANKED.id;

  // 先从原位置摘除，便于同档内重排
  const moving = city;
  const prevLevel = moving.level;
  const sameLevel = prevLevel === target;

  // 记录目标档位的现有成员（排除自己）
  const dest = state.cities.filter((c) => c.level === target && c.id !== id);
  const destSorted = dest
    .slice()
    .sort((a, b) => a.order - b.order);

  let insertAt = Number.isInteger(toIndex) ? toIndex : destSorted.length;
  insertAt = Math.max(0, Math.min(insertAt, destSorted.length));

  destSorted.splice(insertAt, 0, moving);
  moving.level = target;

  // 重排全局数组：保持其他档位不变，仅重写该档位的 order
  destSorted.forEach((c, i) => {
    c.order = i;
  });

  // 若换了档位，把原档位的 order 压实
  if (!sameLevel) {
    const src = state.cities
      .filter((c) => c.level === prevLevel && c.id !== id)
      .sort((a, b) => a.order - b.order);
    src.forEach((c, i) => {
      c.order = i;
    });
  }

  save();
  return true;
}

/** 批量重排某一档位（拖拽结束后一次性写入） */
export function reorderLevel(levelId, orderedIds) {
  const level = levelId || UNRANKED.id;
  const idx = new Map(orderedIds.map((id, i) => [id, i]));
  for (const c of state.cities) {
    if (c.level === level && idx.has(c.id)) {
      c.order = idx.get(c.id);
    }
  }
  save();
}

export function updateCity(id, patch) {
  const city = getCity(id);
  if (!city) return false;
  if (typeof patch.note === 'string') city.note = patch.note;
  if (typeof patch.level === 'string') city.level = patch.level;
  if (Array.isArray(patch.spots)) {
    city.spots = patch.spots
      .filter((s) => typeof s === 'string' && s.trim())
      .map((s) => s.trim());
  }
  save();
  return true;
}

export function addSpot(id, spot) {
  const city = getCity(id);
  if (!city || !spot || !spot.trim()) return false;
  const s = spot.trim();
  if (city.spots.includes(s)) return false;
  city.spots.push(s);
  save();
  return true;
}

export function removeSpot(id, spot) {
  const city = getCity(id);
  if (!city) return false;
  const i = city.spots.indexOf(spot);
  if (i < 0) return false;
  city.spots.splice(i, 1);
  save();
  return true;
}

function reindex() {
  state.cities.forEach((c, i) => {
    c.order = i;
  });
}

/* ------------------------------------------------------------------ */
/* 导入 / 导出                                                         */
/* ------------------------------------------------------------------ */

export function exportJSON() {
  return JSON.stringify(
    {
      app: '从夯到拉',
      version: SCHEMA_VERSION,
      exportedAt: nowISO(),
      updatedAt: state.updatedAt,
      count: state.cities.length,
      cities: state.cities,
    },
    null,
    2
  );
}

/** 导入时可选合并模式：替换全部 / 并入（同 id 跳过） */
export function importJSON(text, mode = 'replace') {
  const parsed = safeParse(text);
  if (!parsed) {
    throw new Error('文件格式不对：不是一个合法的「从夯到拉」备份。');
  }

  if (mode === 'merge') {
    const existing = new Set(state.cities.map((c) => c.id));
    let added = 0;
    for (const c of parsed.cities) {
      if (existing.has(c.id)) continue;
      state.cities.push(c);
      existing.add(c.id);
      added += 1;
    }
    reindex();
    save();
    return { mode, added, total: state.cities.length };
  }

  state = parsed;
  save();
  return { mode: 'replace', added: parsed.cities.length, total: state.cities.length };
}

export function clearAll() {
  state = { version: SCHEMA_VERSION, updatedAt: nowISO(), cities: [] };
  save();
}

export function loadDemo(cities) {
  state = {
    version: SCHEMA_VERSION,
    updatedAt: nowISO(),
    cities: cities.map((c, i) => ({
      id: c.id,
      name: c.name,
      province: c.province || '',
      lng: Number.isFinite(c.lng) ? c.lng : null,
      lat: Number.isFinite(c.lat) ? c.lat : null,
      level: c.level || UNRANKED.id,
      order: i,
      note: c.note || '',
      spots: Array.isArray(c.spots) ? c.spots.slice() : [],
      visitedAt: nowISO(),
    })),
  };
  save();
}

export const STORAGE_KEY_EXPORT = STORAGE_KEY;
