/**
 * map.js —— 地图视图
 *
 * 绘制中国省级轮廓作为底图，把「我的城市」按等级着色成点位。
 * 纯 SVG + 手写墨卡托投影，无任何外部依赖。
 */

import { getTier, sortedTiers, UNRANKED } from './tiers.js';

const W = 1000;
const H = 800;

/* 中国地图常用的投影范围（经纬度） */
const BOUNDS = { minLng: 73, maxLng: 136, minLat: 17, maxLat: 54 };

/** 简单的等距圆柱投影 + 纬度余弦压缩，够用且不依赖库 */
function project(lng, lat) {
  const x = ((lng - BOUNDS.minLng) / (BOUNDS.maxLng - BOUNDS.minLng)) * W;
  const y = ((BOUNDS.maxLat - lat) / (BOUNDS.maxLat - BOUNDS.minLat)) * H;
  return [x, y];
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    node.setAttribute(k, v);
  }
  return node;
}

export class MapView {
  constructor(root, opts = {}) {
    this.root = root;
    this.onCityClick = opts.onCityClick || (() => {});
    this.onToggleLevel = opts.onToggleLevel || (() => {});

    this.svg = null;
    this.gRoot = null;
    this.gProvinces = null;
    this.gCities = null;
    this.geo = null;
    this.provGeo = null;
    this.cities = [];
    this.indexById = null;
    this.hiddenLevels = new Set();
    this.selectedId = null;
    this.transform = { x: 0, y: 0, k: 1 };
    this.showProvBorders = true;
    this._built = false;
  }

  /**
   * 载入边界数据。
   * 单文件模式读内联的 globalThis.__CHINA_GEO__（地级市）与
   * __CHINA_PROVINCES__（省级轮廓），否则回落到 fetch。
   */
  async loadGeo(url = 'data/china-cities.geo.json') {
    const inline = globalThis.__CHINA_GEO__;
    if (inline) {
      this.geo = inline;
      this.provGeo = globalThis.__CHINA_PROVINCES__ || null;
      return this.geo;
    }
    const res = await fetch(url, { cache: 'force-cache' });
    if (!res.ok) throw new Error(`地图数据加载失败（HTTP ${res.status}）`);
    this.geo = await res.json();
    try {
      const pres = await fetch('data/china-provinces.geo.json', { cache: 'force-cache' });
      if (pres.ok) this.provGeo = await pres.json();
    } catch {
      this.provGeo = null; // 省界是叠加层，缺了不影响主图
    }
    return this.geo;
  }

  build() {
    if (this._built) return;
    this.root.innerHTML = '';

    this.svg = el('svg', {
      id: 'mapSvg',
      viewBox: `0 0 ${W} ${H}`,
      preserveAspectRatio: 'xMidYMid meet',
    });
    this.svg.style.setProperty('--label-scale', 9);

    this.gRoot = el('g');
    this.gProvinces = el('g', { class: 'layer-cities' });
    this.gCityAreas = el('g', { class: 'layer-city-areas' });
    this.gProvBorders = el('g', { class: 'layer-prov-borders' });
    this.gCities = el('g', { class: 'layer-dots' });
    this.gRoot.appendChild(this.gProvinces);
    this.gRoot.appendChild(this.gCityAreas);
    this.gRoot.appendChild(this.gProvBorders);
    this.gRoot.appendChild(this.gCities);
    this.svg.appendChild(this.gRoot);
    this.root.appendChild(this.svg);

    this._renderProvinces();
    this._renderProvinceBorders(); // 省界线叠在城市地块之上，避免被填色盖住
    this._bindPanZoom();
    this._built = true;

    this.applyTransform();
  }

  /** 把 GeoJSON 的 Polygon/MultiPolygon 拼成一条 SVG path 的 d */
  static _toPathD(geometry) {
    const polys =
      geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    let d = '';
    for (const poly of polys) {
      for (const ring of poly) {
        ring.forEach(([lng, lat], i) => {
          const [x, y] = project(lng, lat);
          // 2 位小数 ≈ 1km，肉眼无差，path 体积砍掉近一半
          d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
        });
        d += 'Z';
      }
    }
    return d;
  }

  /**
   * 绘制底图：地级市多边形。
   *
   * 每个有独立边界的城市一条 path，带 data-city-id，这样填色视图能把
   * 「我的城市」的等级色直接刷到对应的地级市地块上。
   */
  _renderProvinces() {
    if (!this.geo) return;
    this.gCityAreas.innerHTML = '';

    for (const f of this.geo.features) {
      const p = f.properties;
      const d = MapView._toPathD(f.geometry);
      if (!d) continue;

      const path = el('path', { class: 'city-area', d });
      path.dataset.adcode = String(p.adcode);
      path.dataset.name = p.name || '';
      path.dataset.province = p.province || '';
      this.gCityAreas.appendChild(path);
    }
  }

  /**
   * 绘制省级界线。
   *
   * 为什么要有这一层：底图是 369 个地级市拼起来的，如果跟省界一个粗细，
   * 满屏都是线，根本看不出省份从哪分到哪。所以省界单独一层、单独样式
   * （更粗 + 更亮 + 虚线），叠在地级市地块之上，一眼就能分辨。
   */
  _renderProvinceBorders() {
    if (!this.gProvBorders) return;
    this.gProvBorders.innerHTML = '';
    if (!this.provGeo) return;

    for (const f of this.provGeo.features) {
      const p = f.properties || {};
      const d = MapView._toPathD(f.geometry);
      if (!d) continue;
      const path = el('path', { class: 'province', d });
      path.dataset.province = p.name || '';
      this.gProvBorders.appendChild(path);
    }
  }

  /**
   * 按等级给地级市地块填色。
   *
   * 映射策略（与 map_cities_to_geo.py 的 geo 字段对齐）：
   *   - kind === 'area'：索引城市就是该地级市本体 → 直接给这条 path 上色
   *   - kind === 'dot' ：县级旅游重镇（敦煌/婺源…）→ 落到上级地级市的地块上，
   *                      但颜色不覆盖，只在地块上叠一个色点 + 描边，
   *                      免得把整个酒泉市染成敦煌的颜色
   */
  paintCities(cities, indexById) {
    const byId = indexById || {};
    const adcodeLevel = new Map(); // adcode -> levelId
    const dotCities = [];

    for (const c of cities) {
      const meta = byId[c.id] || c;
      const geo = meta.geo;
      if (!geo) {
        dotCities.push(c);
        continue;
      }
      if (geo.kind === 'area' && geo.adcode) {
        // 同一地级市出现多城时，取档位最高的那个（rank 小者胜）
        const prev = adcodeLevel.get(String(geo.adcode));
        if (!prev || getTier(c.level).rank < getTier(prev).rank) {
          adcodeLevel.set(String(geo.adcode), c.level);
        }
      } else {
        dotCities.push(c);
      }
    }

    let painted = 0;
    for (const path of this.gCityAreas.querySelectorAll('.city-area')) {
      const levelId = adcodeLevel.get(path.dataset.adcode);
      if (levelId) {
        const tier = getTier(levelId);
        path.style.fill = tier.color;
        path.style.fillOpacity = levelId === UNRANKED.id ? 0.42 : 0.72;
        path.classList.add('painted');
        painted += 1;
      } else {
        path.style.fill = '';
        path.style.fillOpacity = '';
        path.classList.remove('painted');
      }
    }

    this._dotCities = dotCities;
    return { painted, dots: dotCities.length };
  }

  /* ---------------------------------------------------- 城市点位 */

  renderCities(cities, selectedId) {
    this.cities = cities || [];
    this.selectedId = selectedId || null;
    if (!this.gCities) return;

    this.gCities.innerHTML = '';
    const visible = this.cities.filter((c) => !this.hiddenLevels.has(c.level));

    // 未定级的先画，已定级的后画（保证高档位在上层）
    const ordered = [...visible].sort((a, b) => {
      const ra = getTier(a.level).rank;
      const rb = getTier(b.level).rank;
      return rb - ra;
    });

    for (const city of ordered) {
      if (!Number.isFinite(city.lng) || !Number.isFinite(city.lat)) continue;
      const tier = getTier(city.level);
      const isSel = city.id === this.selectedId;

      // 走地块填色的城市，点也要画——直辖市/大市在整图缩放下地块太小，
      // 只靠填色根本找不到。点小一号、去掉描边，跟县级重镇的大点区分开。
      const meta = this.indexById?.[city.id];
      const isArea = meta?.geo?.kind === 'area';

      const [x, y] = project(city.lng, city.lat);

      const g = el('g', {
        class: 'city-dot' + (isSel ? ' selected' : '') + (isArea ? ' is-area' : ''),
      });
      g.dataset.cityId = city.id;

      const circle = el('circle', {
        cx: x,
        cy: y,
        r: isSel ? 6.5 : isArea ? 3.2 : 5,
        fill: tier.color,
        'fill-opacity': city.level === UNRANKED.id ? 0.55 : 0.92,
      });

      const label = el('text', { x, y: y - 9 });
      label.textContent = city.name;

      g.appendChild(circle);
      g.appendChild(label);

      g.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.onCityClick(city.id);
      });

      this.gCities.appendChild(g);
    }
  }

  /** 用索引里的 geo 字段反查某城对应的 adcode（选中描边用） */
  setIndex(indexById) {
    this.indexById = indexById || null;
  }

  _adcodeOf(id) {
    return this.indexById?.[id]?.geo?.adcode || '';
  }

  setHiddenLevels(set) {
    this.hiddenLevels = new Set(set);
    this.renderCities(this.cities, this.selectedId);
  }

  setSelected(id) {
    this.selectedId = id;
    // 被选中的地级市地块加描边，不然点完看不出选的是哪个
    for (const path of this.gCityAreas.querySelectorAll('.city-area')) {
      path.classList.toggle('selected', !!id && path.dataset.adcode === String(this._adcodeOf?.(id) || ''));
    }
    this.renderCities(this.cities, this.selectedId);
  }

  /** 高亮有城市的省份 */
  markProvinces(provinces) {
    const set = new Set(provinces);
    for (const p of this.gProvBorders.querySelectorAll('.province')) {
      p.classList.toggle('has-cities', set.has(p.dataset.province));
    }
  }

  /** 省界显隐 */
  setProvinceBordersVisible(visible) {
    this.showProvBorders = !!visible;
    if (this.gProvBorders) {
      this.gProvBorders.style.display = visible ? '' : 'none';
    }
  }

  /* ---------------------------------------------------- 缩放平移 */

  _bindPanZoom() {
    const svg = this.svg;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let moved = false;
    const pointers = new Map();
    let pinchStart = null;

    this._pointerPos = (ev) => {
      const rect = svg.getBoundingClientRect();
      const scale = W / rect.width;
      return {
        x: (ev.clientX - rect.left) * scale,
        y: (ev.clientY - rect.top) * (H / rect.height),
        cx: ev.clientX,
        cy: ev.clientY,
      };
    };

    svg.addEventListener('pointerdown', (ev) => {
      // 点在城市上时不启动拖拽，交给点击处理
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (pointers.size === 1) {
        dragging = true;
        moved = false;
        lastX = ev.clientX;
        lastY = ev.clientY;
        svg.classList.add('dragging');
        svg.setPointerCapture(ev.pointerId);
      } else if (pointers.size === 2) {
        const pts = [...pointers.values()];
        pinchStart = {
          dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
          k: this.transform.k,
        };
        dragging = false;
      }
    });

    svg.addEventListener('pointermove', (ev) => {
      if (!pointers.has(ev.pointerId)) return;
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

      if (pointers.size === 2 && pinchStart) {
        const pts = [...pointers.values()];
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (pinchStart.dist > 0) {
          this.zoomTo(pinchStart.k * (dist / pinchStart.dist));
        }
        moved = true;
        return;
      }

      if (!dragging) return;
      const dx = ev.clientX - lastX;
      const dy = ev.clientY - lastY;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      lastX = ev.clientX;
      lastY = ev.clientY;

      const rect = svg.getBoundingClientRect();
      this.transform.x += dx * (W / rect.width);
      this.transform.y += dy * (H / rect.height);
      this._clamp();
      this.applyTransform();
    });

    const endPointer = (ev) => {
      pointers.delete(ev.pointerId);
      if (pointers.size < 2) pinchStart = null;
      if (pointers.size === 0) {
        dragging = false;
        svg.classList.remove('dragging');
      }
    };

    svg.addEventListener('pointerup', endPointer);
    svg.addEventListener('pointercancel', endPointer);
    svg.addEventListener('pointerleave', endPointer);

    // 滚轮缩放（桌面）
    svg.addEventListener(
      'wheel',
      (ev) => {
        ev.preventDefault();
        const rect = svg.getBoundingClientRect();
        const factor = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
        this.zoomAt(factor, ev.clientX - rect.left, ev.clientY - rect.top, rect);
      },
      { passive: false }
    );

    // 双击放大
    svg.addEventListener('dblclick', (ev) => {
      const rect = svg.getBoundingClientRect();
      this.zoomAt(1.6, ev.clientX - rect.left, ev.clientY - rect.top, rect);
    });
  }

  zoomAt(factor, px, py, rect) {
    const k0 = this.transform.k;
    const k1 = Math.max(1, Math.min(12, k0 * factor));
    if (k1 === k0) return;

    const scaleX = W / rect.width;
    const scaleY = H / rect.height;
    const sx = px * scaleX;
    const sy = py * scaleY;

    this.transform.x = sx - ((sx - this.transform.x) * k1) / k0;
    this.transform.y = sy - ((sy - this.transform.y) * k1) / k0;
    this.transform.k = k1;
    this._clamp();
    this.applyTransform();
  }

  zoomTo(k) {
    this.transform.k = Math.max(1, Math.min(12, k));
    this._clamp();
    this.applyTransform();
  }

  /** 按钮缩放：围绕视图中心 */
  zoomBy(factor) {
    const k0 = this.transform.k;
    const k1 = Math.max(1, Math.min(12, k0 * factor));
    if (k1 === k0) return;
    const cx = W / 2;
    const cy = H / 2;
    this.transform.x = cx - ((cx - this.transform.x) * k1) / k0;
    this.transform.y = cy - ((cy - this.transform.y) * k1) / k0;
    this.transform.k = k1;
    this._clamp();
    this.applyTransform();
  }

  _clamp() {
    const k = this.transform.k;
    const minX = W - W * k;
    const minY = H - H * k;
    this.transform.x = Math.min(0, Math.max(minX, this.transform.x));
    this.transform.y = Math.min(0, Math.max(minY, this.transform.y));
  }

  applyTransform() {
    if (!this.gRoot) return;
    const { x, y, k } = this.transform;
    this.gRoot.setAttribute('transform', `translate(${x} ${y}) scale(${k})`);
    // 缩放时标签跟着放大太挤，反向缩一点
    const fs = Math.max(5, 9 / Math.sqrt(k));
    this.svg.style.setProperty('--label-scale', fs);
    for (const t of this.gCities.querySelectorAll('text')) {
      t.style.fontSize = `${fs}px`;
    }
  }

  reset() {
    this.transform = { x: 0, y: 0, k: 1 };
    this.applyTransform();
  }

  /** 把某个城市居中放大 */
  focusCity(city) {
    if (!city || !Number.isFinite(city.lng)) return;
    const k = 4;
    const [x, y] = project(city.lng, city.lat);
    this.transform.k = k;
    this.transform.x = W / 2 - x * k;
    this.transform.y = H / 2 - y * k;
    this._clamp();
    this.applyTransform();
  }
}

export { sortedTiers };
