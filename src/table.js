/**
 * table.js —— 表格 / Tier List 视图
 *
 * 五档横条，卡片可在档位之间和档位内部拖拽。
 * 桌面用鼠标拖拽，手机用长按拖拽（Pointer Events 统一处理）。
 */

import { sortedTiers, UNRANKED } from './tiers.js';

const LONG_PRESS_MS = 180;   // 手机需要长按才启动拖拽，避免和滚动冲突
const MOVE_THRESHOLD = 6;    // 移动超过这个距离才算拖拽

export class TableView {
  constructor(root, opts = {}) {
    this.root = root;
    this.onMove = opts.onMove || (() => {});       // (cityId, levelId, index)
    this.onCityClick = opts.onCityClick || (() => {});
    this.onReorderLevel = opts.onReorderLevel || (() => {});
    this.onSelect = opts.onSelect || (() => {});

    this.boardEl = null;
    this.cities = [];
    this.filter = { province: '', level: '', query: '' };
    this.selectedId = null;
    this.collapsed = new Set();

    this._drag = null;
    this._built = false;
  }

  build() {
    if (this._built) return;
    this.root.innerHTML = '';

    const board = document.createElement('div');
    board.className = 'board';
    this.root.appendChild(board);
    this.boardEl = board;

    this._bindDrag();
    this._built = true;
  }

  /** 全部收起 / 全部展开；返回是否现在处于全收起状态 */
  toggleCollapseAll() {
    const levels = [...sortedTiers(), UNRANKED].map((l) => l.id);
    const allCollapsed = levels.every((id) => this.collapsed.has(id));
    this.collapsed.clear();
    if (!allCollapsed) {
      for (const id of levels) this.collapsed.add(id);
    }
    this.render(this.cities, this.selectedId);
    return !allCollapsed;
  }

  setFilter(patch) {
    Object.assign(this.filter, patch);
    this.render(this.cities, this.selectedId);
  }

  render(cities, selectedId) {
    this.cities = cities || [];
    this.selectedId = selectedId || null;
    if (!this.boardEl) return;

    const filtered = this._applyFilter(this.cities);

    if (!this.cities.length) {
      this.boardEl.innerHTML = `
        <div class="empty-state">
          <strong>还没有城市</strong>
          <p>在上面搜索框输入城市名，比如「敦煌」「婺源」「重庆」</p>
          <p class="hint">搜到什么，什么才会出现 —— 这里就是你去过的清单</p>
        </div>`;
      return;
    }

    const groups = new Map();
    for (const c of filtered) {
      if (!groups.has(c.level)) groups.set(c.level, []);
      groups.get(c.level).push(c);
    }
    for (const arr of groups.values()) arr.sort((a, b) => a.order - b.order);

    const levels = [...sortedTiers(), UNRANKED];
    const visibleLevels = this.filter.level
      ? levels.filter((l) => l.id === this.filter.level)
      : levels;

    this.boardEl.innerHTML = '';

    for (const level of visibleLevels) {
      const items = groups.get(level.id) || [];
      const isCollapsed = this.collapsed.has(level.id) && !this.filter.query && !this.filter.level;

      const row = document.createElement('div');
      row.className = 'tier-row' + (isCollapsed ? ' collapsed' : '');
      row.dataset.level = level.id;

      const label = document.createElement('div');
      label.className = 'tier-label';
      label.style.background = level.color;
      label.style.color = level.id === UNRANKED.id ? '#e8eaed' : '#12151a';
      label.innerHTML = `
        <span class="tl-name">${escapeHTML(level.name)}</span>
        <span class="tl-sub">${escapeHTML(level.sub)}</span>
        <span class="tl-count">${items.length}</span>
      `;
      label.title = '点击收起 / 展开这一档';

      const box = document.createElement('div');
      box.className = 'tier-items';
      box.dataset.level = level.id;

      for (const city of items) {
        box.appendChild(this._card(city));
      }

      label.addEventListener('click', () => {
        if (this.collapsed.has(level.id)) this.collapsed.delete(level.id);
        else this.collapsed.add(level.id);
        this.render(this.cities, this.selectedId);
      });

      row.appendChild(label);
      row.appendChild(box);
      this.boardEl.appendChild(row);
    }
  }

  _applyFilter(cities) {
    const q = this.filter.query.trim().toLowerCase();
    return cities.filter((c) => {
      if (this.filter.province && c.province !== this.filter.province) return false;
      if (this.filter.level && c.level !== this.filter.level) return false;
      if (q) {
        const hay = `${c.name} ${c.province} ${(c.spots || []).join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  _card(city) {
    const node = document.createElement('div');
    node.className = 'city-card' + (city.id === this.selectedId ? ' selected' : '');
    node.dataset.cityId = city.id;

    const spots = city.spots?.length || 0;
    node.innerHTML = `
      <span class="cc-name">${escapeHTML(city.name)}</span>
      ${city.province ? `<span class="cc-prov">${escapeHTML(city.province)}</span>` : ''}
      ${spots ? `<span class="cc-spots">${spots}景</span>` : ''}
    `;

    node.addEventListener('click', (ev) => {
      if (this._suppressClick) return;
      ev.stopPropagation();
      this.onCityClick(city.id);
    });

    return node;
  }

  /* ---------------------------------------------------- 拖拽 */

  _bindDrag() {
    const board = this.boardEl;
    let pending = null;
    let timer = null;

    const startDragAt = (ev) => {
      const card = ev.target.closest('.city-card');
      if (!card) return;
      const city = this.cities.find((c) => c.id === card.dataset.cityId);
      if (!city) return;

      this._drag = {
        city,
        card,
        startX: ev.clientX,
        startY: ev.clientY,
        active: false,
        ghost: null,
        pointerId: ev.pointerId,
      };
      card.setPointerCapture?.(ev.pointerId);
    };

    board.addEventListener('pointerdown', (ev) => {
      if (ev.button !== undefined && ev.button !== 0 && ev.pointerType === 'mouse') return;

      const card = ev.target.closest('.city-card');
      if (!card) return;

      if (ev.pointerType === 'mouse') {
        startDragAt(ev);
        return;
      }

      // 触摸设备：长按后启动，否则当作滚动
      pending = { ev: { clientX: ev.clientX, clientY: ev.clientY, target: ev.target, pointerId: ev.pointerId } };
      const captured = { clientX: ev.clientX, clientY: ev.clientY, target: ev.target, pointerId: ev.pointerId };
      timer = setTimeout(() => {
        timer = null;
        pending = null;
        startDragAt(captured);
        this._activateDrag(captured.clientX, captured.clientY);
        if (navigator.vibrate) navigator.vibrate(12);
      }, LONG_PRESS_MS);
    });

    board.addEventListener('pointermove', (ev) => {
      if (timer && pending) {
        const dx = ev.clientX - pending.ev.clientX;
        const dy = ev.clientY - pending.ev.clientY;
        if (Math.hypot(dx, dy) > 10) {
          clearTimeout(timer);
          timer = null;
          pending = null;
        }
        return;
      }

      const d = this._drag;
      if (!d) return;

      if (!d.active) {
        const dist = Math.hypot(ev.clientX - d.startX, ev.clientY - d.startY);
        if (dist < MOVE_THRESHOLD) return;
        this._activateDrag(ev.clientX, ev.clientY);
      }

      this._moveGhost(ev.clientX, ev.clientY);
      this._highlightTarget(ev.clientX, ev.clientY);
    });

    const finish = (ev) => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
        pending = null;
      }
      const d = this._drag;
      if (!d) return;
      if (d.active) {
        this._drop(ev.clientX, ev.clientY);
      }
      this._drag = null;
    };

    board.addEventListener('pointerup', finish);
    board.addEventListener('pointercancel', finish);

    // 滚轮滚动时取消未启动的拖拽
    board.addEventListener('scroll', () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
        pending = null;
      }
    }, { passive: true });
  }

  _activateDrag(x, y) {
    const d = this._drag;
    if (!d || d.active) return;
    d.active = true;
    this._suppressClick = true;

    d.card.classList.add('dragging');

    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    const clone = d.card.cloneNode(true);
    clone.classList.remove('dragging');
    clone.style.cursor = 'grabbing';
    ghost.appendChild(clone);
    document.body.appendChild(ghost);
    d.ghost = ghost;

    this._moveGhost(x, y);
  }

  _moveGhost(x, y) {
    const d = this._drag;
    if (!d?.ghost) return;
    d.ghost.style.left = `${x}px`;
    d.ghost.style.top = `${y}px`;
  }

  _highlightTarget(x, y) {
    const rows = this.boardEl.querySelectorAll('.tier-row');
    for (const r of rows) r.classList.remove('drop-target');

    const d = this._drag;
    if (d?.ghost) d.ghost.style.display = 'none';
    const under = document.elementFromPoint(x, y);
    if (d?.ghost) d.ghost.style.display = '';

    const row = under?.closest?.('.tier-row');
    if (row) row.classList.add('drop-target');
  }

  _drop(x, y) {
    const d = this._drag;
    if (!d) return;

    d.card.classList.remove('dragging');
    if (d.ghost) d.ghost.remove();
    for (const r of this.boardEl.querySelectorAll('.tier-row')) {
      r.classList.remove('drop-target');
    }

    // 拖拽期间屏蔽点击，稍后恢复
    setTimeout(() => {
      this._suppressClick = false;
    }, 50);

    const boxes = this.boardEl.querySelectorAll('.tier-items');
    // 注意：不能给 .tier-row 设 pointer-events:none，因为 .tier-items 是它的子元素，
    // 会一起被屏蔽，导致 elementFromPoint 落空、拖拽无声失败。
    // 正确做法与 _highlightTarget 一致：临时藏起拖拽浮层即可。
    if (d.ghost) d.ghost.style.display = 'none';
    const under = document.elementFromPoint(x, y);
    if (d.ghost) d.ghost.style.display = '';

    const box = under?.closest?.('.tier-items');
    const row = under?.closest?.('.tier-row');
    const levelId = box?.dataset.level || row?.dataset.level;
    if (!levelId) return;

    // 计算落点在该档位内的插入下标
    const container = box || row.querySelector('.tier-items');
    if (!container) return;
    const cards = [...container.querySelectorAll('.city-card')].filter(
      (c) => c.dataset.cityId !== d.city.id
    );
    let index = cards.length;
    for (let i = 0; i < cards.length; i++) {
      const rect = cards[i].getBoundingClientRect();
      if (x < rect.left + rect.width / 2 && y < rect.bottom) {
        index = i;
        break;
      }
    }

    this.onMove(d.city.id, levelId, index);
  }
}

function escapeHTML(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}
