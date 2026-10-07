/**
 * app.js —— 主控 / 装配
 *
 * 把 store、search、map、table、detail 串起来。
 */

import { TIERS, sortedTiers, UNRANKED, getTier, ALL_LEVELS } from './tiers.js';
import * as store from './store.js';
import * as search from './search.js';
import { MapView } from './map.js';
import { TableView } from './table.js';
import { DetailPanel } from './detail.js';
import { exportTierImage } from './export-image.js';

/* ------------------------------------------------------------ 状态 */

let rawIndex = [];
let indexById = {};
let currentView = 'table';
let selectedId = null;
let hiddenLevels = new Set();
let tableFilter = { province: '', level: '', query: '' };

let mapView = null;
let tableView = null;
let detailPanel = null;

/* ------------------------------------------------------------ 工具 */

const $ = (sel) => document.querySelector(sel);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1900);
}

function download(filename, text) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ------------------------------------------------------------ 渲染 */

function renderAll() {
  const cities = store.getCities();

  // 地图
  if (mapView && mapView._built) {
    // 必须同步隐藏档位，否则图例点了不生效
    mapView.setHiddenLevels(hiddenLevels);
    mapView.paintCities(cities, indexById);
    mapView.renderCities(cities, selectedId);
    mapView.markProvinces(summaryProvinces());
  }

  // 表格
  if (tableView && tableView._built) {
    tableView.render(cities, selectedId);
  }

  renderStats();
  renderLegend();
  renderProvinceSelect();
  updateSearchClear();
}

/** 已录入城市覆盖到的省份集合（给地图点亮用） */
function summaryProvinces() {
  return [...new Set(store.getCities().map((c) => c.province).filter(Boolean))];
}

function renderStats() {
  const s = store.stats();
  const bar = $('#statsBar');
  const parts = [
    `共 <b>${s.total}</b> 座`,
    `已定级 <b>${s.ranked}</b>`,
    `未定级 <b>${s.unranked}</b>`,
    `覆盖 <b>${s.provinces}</b> 省`,
    `景点 <b>${s.spots}</b>`,
  ];
  bar.innerHTML = parts.join(' · ');
}

function renderLegend() {
  const box = $('#legend');
  if (!box) return;
  const cities = store.getCities();
  const counts = {};
  for (const c of cities) counts[c.level] = (counts[c.level] || 0) + 1;

  const rows = [...sortedTiers(), UNRANKED].map((t) => {
    const n = counts[t.id] || 0;
    const muted = hiddenLevels.has(t.id) ? ' muted' : '';
    return `
      <div class="legend-row${muted}" data-level="${t.id}">
        <span class="legend-swatch" style="background:${t.color}"></span>
        <span>${esc(t.name)}</span>
        <span class="legend-count">${n}</span>
      </div>`;
  }).join('');

  box.innerHTML = `<div class="legend-title">点击切换显示</div>${rows}`;

  for (const row of box.querySelectorAll('.legend-row')) {
    row.addEventListener('click', () => {
      const id = row.dataset.level;
      if (hiddenLevels.has(id)) hiddenLevels.delete(id);
      else hiddenLevels.add(id);
      renderAll();
    });
  }
}

function renderProvinceSelect() {
  const sel = $('#provinceSelect');
  if (!sel) return;
  const provinces = [...new Set(store.getCities().map((c) => c.province).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));

  const keep = sel.value;
  sel.innerHTML = `<option value="">全部省份</option>` +
    provinces.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
  if (provinces.includes(keep)) sel.value = keep;
  else {
    sel.value = '';
    tableFilter.province = '';
  }
}

function updateSearchClear() {
  const input = $('#searchInput');
  const btn = $('#searchClear');
  btn.classList.toggle('show', !!input.value);
}

/* ------------------------------------------------------------ 搜索 */

function hideSuggest() {
  $('#suggest').classList.remove('show');
  activeSuggestIndex = -1;
}

let activeSuggestIndex = -1;

function renderSuggest(query) {
  const box = $('#suggest');
  const q = query.trim();

  if (!q) {
    hideSuggest();
    return;
  }

  const added = new Set(store.getCities().map((c) => c.id));
  const hits = search.search(q, { limit: 14 });

  if (!hits.length) {
    box.innerHTML = `<div class="suggest-empty">没找到「${esc(q)}」<br><span style="font-size:11px">换个说法试试，比如只输一个字</span></div>`;
    box.classList.add('show');
    activeSuggestIndex = -1;
    return;
  }

  box.innerHTML = hits.map((c, i) => {
    const isAdded = added.has(c.id);
    const alias = (c.alias || []).slice(0, 3).join(' · ');
    return `
      <div class="suggest-item${isAdded ? ' is-added' : ''}" data-id="${esc(c.id)}" data-i="${i}">
        <span class="suggest-name">${esc(c.name)}</span>
        <span class="suggest-prov">${esc(c.province)}</span>
        <span class="suggest-alias">${esc(alias)}</span>
        <span class="suggest-add">${isAdded ? '已在清单' : '+ 加入'}</span>
      </div>`;
  }).join('');

  box.classList.add('show');
  activeSuggestIndex = -1;

  for (const item of box.querySelectorAll('.suggest-item')) {
    item.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      pickSuggest(item.dataset.id);
    });
    item.addEventListener('click', () => pickSuggest(item.dataset.id));
  }
}

function pickSuggest(id) {
  const entry = search.byId(id) || store.getCity(id);
  if (!entry) return;

  if (store.hasCity(id)) {
    toast(`「${entry.name}」已经在清单里了`);
    hideSuggest();
    selectCity(id);
    return;
  }

  // 加入时把别名里的知名地标作为初始景点建议
  const suggested = search.suggestedSpots(entry);
  const city = store.addCity({
    id: entry.id,
    name: entry.name,
    province: entry.province,
    lng: entry.lng,
    lat: entry.lat,
    level: UNRANKED.id,
    spots: [],
  });

  $('#searchInput').value = '';
  hideSuggest();
  updateSearchClear();

  renderAll();
  if (city) {
    selectCity(city.id);
    toast(`已加入「${city.name}」 · 拖到档位里定级吧`);
  }
}

function selectCity(id) {
  selectedId = id;
  const city = store.getCity(id);
  if (tableView) tableView.selectedId = id;
  if (mapView) mapView.setSelected(id);
  renderAll();
  if (city) detailPanel.open(city);
}

/* ------------------------------------------------------------ 视图切换 */

function switchView(name) {
  currentView = name;
  for (const v of document.querySelectorAll('.view')) {
    v.classList.toggle('active', v.dataset.view === name);
  }
  for (const t of document.querySelectorAll('[data-switch]')) {
    t.classList.toggle('active', t.dataset.switch === name);
  }
  if (name === 'map' && !mapView._built) initMap();
}

/* ------------------------------------------------------------ 初始化 */

async function initMap() {
  if (mapView._built) return;
  try {
    await mapView.loadGeo();
    mapView.build();
    mapView.setHiddenLevels(hiddenLevels);
    renderAll();
  } catch (err) {
    console.error(err);
    mapView.root.innerHTML = `
      <div class="map-hint">
        <strong>地图数据没加载上</strong>
        <p>确认 data/china-cities.geo.json 在同一个文件夹里</p>
        <p class="hint">${esc(err.message)}</p>
      </div>`;
  }
}

async function main() {
  // 数据
  try {
    await search.loadIndex();
    rawIndex = search.getIndex();
  } catch (err) {
    console.error(err);
    toast('城市索引加载失败：' + err.message);
  }

  store.load();

  // 索引按 id 建表，地图渲染要查每个城市的 geo 归属
  indexById = {};
  for (const c of rawIndex) indexById[c.id] = c;

  // 视图
  mapView = new MapView($('#mapPane'), {
    onCityClick: (id) => selectCity(id),
  });
  mapView.setIndex(indexById);

  tableView = new TableView($('#tablePane'), {
    onMove: (cityId, levelId, index) => {
      store.setLevel(cityId, levelId, index);
      renderAll();
    },
    onCityClick: (id) => selectCity(id),
    onReorderLevel: (levelId, orderedIds) => {
      store.reorderLevel(levelId, orderedIds);
      renderAll();
    },
  });
  tableView.build();

  detailPanel = new DetailPanel({
    onSetLevel: (id, levelId) => {
      store.setLevel(id, levelId);
      renderAll();
    },
    onAddSpot: (id, spot) => {
      store.addSpot(id, spot);
      renderAll();
    },
    onRemoveSpot: (id, spot) => {
      store.removeSpot(id, spot);
      renderAll();
    },
    onSaveNote: (id, note) => {
      store.updateCity(id, { note });
    },
    onRemoveCity: (id) => {
      store.removeCity(id);
      selectedId = null;
      renderAll();
    },
    onFocus: (city) => {
      switchView('map');
      initMap().then(() => {
        if (mapView._built) mapView.focusCity(city);
      });
    },
  });
  detailPanel.build();

  /* 顶栏事件 */
  const searchInput = $('#searchInput');
  searchInput.addEventListener('input', () => {
    updateSearchClear();
    renderSuggest(searchInput.value);
  });
  searchInput.addEventListener('focus', () => {
    if (searchInput.value.trim()) renderSuggest(searchInput.value);
  });
  searchInput.addEventListener('keydown', (ev) => {
    const items = [...document.querySelectorAll('.suggest-item')];
    if (ev.key === 'ArrowDown' && items.length) {
      ev.preventDefault();
      activeSuggestIndex = Math.min(activeSuggestIndex + 1, items.length - 1);
      items.forEach((it, i) => it.classList.toggle('active', i === activeSuggestIndex));
      items[activeSuggestIndex]?.scrollIntoView({ block: 'nearest' });
    } else if (ev.key === 'ArrowUp' && items.length) {
      ev.preventDefault();
      activeSuggestIndex = Math.max(activeSuggestIndex - 1, 0);
      items.forEach((it, i) => it.classList.toggle('active', i === activeSuggestIndex));
      items[activeSuggestIndex]?.scrollIntoView({ block: 'nearest' });
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      if (activeSuggestIndex >= 0 && items[activeSuggestIndex]) {
        pickSuggest(items[activeSuggestIndex].dataset.id);
      } else if (items.length) {
        pickSuggest(items[0].dataset.id);
      }
    } else if (ev.key === 'Escape') {
      hideSuggest();
      searchInput.blur();
    }
  });

  $('#searchClear').addEventListener('click', () => {
    searchInput.value = '';
    updateSearchClear();
    hideSuggest();
    searchInput.focus();
  });

  document.addEventListener('click', (ev) => {
    if (!ev.target.closest('.search-wrap')) hideSuggest();
  });

  for (const btn of document.querySelectorAll('[data-switch]')) {
    btn.addEventListener('click', () => switchView(btn.dataset.switch));
  }

  /* 视图内工具条 */
  $('#zoomIn')?.addEventListener('click', () => mapView.zoomBy(1.3));
  $('#zoomOut')?.addEventListener('click', () => mapView.zoomBy(1 / 1.3));
  $('#zoomReset')?.addEventListener('click', () => mapView.reset());

  $('#provinceSelect')?.addEventListener('change', (ev) => {
    tableView.setFilter({ province: ev.target.value });
    tableFilter.province = ev.target.value;
  });

  $('#tableQuery')?.addEventListener('input', (ev) => {
    tableView.setFilter({ query: ev.target.value });
    tableFilter.query = ev.target.value;
  });

  /* 等级快捷筛选 */
  const levelBar = $('#levelFilter');
  if (levelBar) {
    levelBar.innerHTML = `<button class="chip active" data-level="">全部</button>` +
      ALL_LEVELS.map((t) => `
        <button class="chip" data-level="${t.id}">
          <span class="dot" style="background:${t.color}"></span>${esc(t.name)}
        </button>`).join('');

    for (const chip of levelBar.querySelectorAll('.chip')) {
      chip.addEventListener('click', () => {
        for (const c of levelBar.querySelectorAll('.chip')) c.classList.remove('active');
        chip.classList.add('active');
        tableView.setFilter({ level: chip.dataset.level });
        tableFilter.level = chip.dataset.level;
      });
    }
  }

  /* 数据操作 */
  $('#btnExpandAll')?.addEventListener('click', () => {
    const collapsed = tableView.toggleCollapseAll();
    const btn = $('#btnExpandAll');
    if (btn) btn.textContent = collapsed ? '全部展开' : '全部收起';
  });

  $('#btnExport')?.addEventListener('click', () => {
    const n = store.getCities().length;
    if (!n) {
      toast('还没有数据可以导出');
      return;
    }
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    download(`从夯到拉-备份-${stamp}.json`, store.exportJSON());
    toast(`已导出 ${n} 座城市`);
  });

  /* 导出竖版排行长图（PNG），版式跟着当前筛选走 */
  $('#btnExportImg')?.addEventListener('click', async () => {
    const cities = store.getCities();
    if (!cities.length) {
      toast('还没有城市，先搜几个加进来');
      return;
    }
    const btn = $('#btnExportImg');
    if (btn) btn.disabled = true;
    try {
      // 表格的档位筛选同步进图里，所见即所得
      const { filename } = await exportTierImage(cities, {
        level: tableFilter.level || 'all',
        province: tableFilter.province || '',
      });
      toast(`已生成 ${filename}`);
    } catch (err) {
      console.error(err);
      toast('出图失败：' + err.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  $('#btnImport')?.addEventListener('click', () => $('#fileInput').click());

  $('#fileInput')?.addEventListener('change', async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const hasData = store.getCities().length > 0;
      const mode = hasData && confirm('已有数据。\n\n确定 = 合并（同城市跳过）\n取消 = 覆盖全部') ? 'merge' : 'replace';
      const r = store.importJSON(text, mode);
      renderAll();
      toast(`导入完成 · 现共 ${r.total} 座`);
    } catch (err) {
      alert('导入失败：' + err.message);
    } finally {
      ev.target.value = '';
    }
  });

  $('#btnClear')?.addEventListener('click', () => {
    const n = store.getCities().length;
    if (!n) return;
    if (confirm(`清空全部 ${n} 座城市？此操作不可撤销。\n\n建议先导出备份。`)) {
      store.clearAll();
      selectedId = null;
      renderAll();
      toast('已清空');
    }
  });

  /* 订阅 store 变化 */
  store.subscribe(() => renderAll());

  /* 首次渲染 */
  switchView('table');
  renderAll();

  // 地图按需初始化（首屏更轻）
  if (location.hash === '#map') switchView('map');
}

// 单文件模式：脚本内联在 </body> 前，此时 DOM 已就绪，
// DOMContentLoaded 可能早已错过，所以按 readyState 决定是否直接跑。
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
