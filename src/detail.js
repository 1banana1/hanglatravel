/**
 * detail.js —— 城市详情面板
 *
 * 展示 / 编辑：等级、著名景点、备注。
 * 桌面从右侧滑入，手机从底部滑入。
 */

import { ALL_LEVELS, getTier, UNRANKED } from './tiers.js';

export class DetailPanel {
  constructor(opts = {}) {
    this.onSetLevel = opts.onSetLevel || (() => {});
    this.onAddSpot = opts.onAddSpot || (() => {});
    this.onRemoveSpot = opts.onRemoveSpot || (() => {});
    this.onSaveNote = opts.onSaveNote || (() => {});
    this.onRemoveCity = opts.onRemoveCity || (() => {});
    this.onFocus = opts.onFocus || (() => {});

    this.el = null;
    this.scrim = null;
    this.city = null;
    this._built = false;
    this._noteTimer = null;
  }

  build() {
    if (this._built) return;

    const scrim = document.createElement('div');
    scrim.className = 'scrim';
    scrim.addEventListener('click', () => this.close());
    document.body.appendChild(scrim);
    this.scrim = scrim;

    const el = document.createElement('aside');
    el.className = 'detail';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'false');
    document.body.appendChild(el);
    this.el = el;

    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && el.classList.contains('open')) this.close();
    });

    this._built = true;
  }

  open(city) {
    this.build();
    this.city = city;
    this.render();
    this.el.classList.add('open');
    this.scrim.classList.add('show');
  }

  close() {
    if (!this.el) return;
    this.el.classList.remove('open');
    this.scrim.classList.remove('show');
    this.city = null;
  }

  isOpen() {
    return this.el?.classList.contains('open') || false;
  }

  render() {
    const city = this.city;
    if (!city || !this.el) return;

    const tier = getTier(city.level);

    this.el.innerHTML = `
      <div class="detail-head">
        <div class="detail-title">
          <h2>${esc(city.name)}</h2>
          <div class="detail-meta">
            ${city.province ? esc(city.province) : '—'} · 当前 <b style="color:${tier.color}">${esc(tier.name)}</b>
          </div>
        </div>
        <button class="detail-close" title="关闭">✕</button>
      </div>
      <div class="detail-body">
        <div class="field">
          <div class="field-label">档位</div>
          <div class="level-picker"></div>
        </div>
        <div class="field">
          <div class="field-label">著名景点</div>
          <div class="spot-list"></div>
          <div class="spot-add">
            <input type="text" placeholder="添加景点…" maxlength="40">
            <button>添加</button>
          </div>
        </div>
        <div class="field">
          <div class="field-label">备注</div>
          <textarea class="note-area" placeholder="记点什么，比如哪年去的、印象最深的事…" maxlength="2000">${esc(city.note || '')}</textarea>
        </div>
      </div>
      <div class="detail-foot">
        <button class="btn grow" data-act="focus">在地图上定位</button>
        <button class="btn danger" data-act="remove">移除</button>
      </div>
    `;

    this._renderLevels(tier);
    this._renderSpots();
    this._bind();
  }

  _renderLevels(current) {
    const box = this.el.querySelector('.level-picker');
    box.innerHTML = '';

    for (const level of ALL_LEVELS) {
      const btn = document.createElement('button');
      btn.className = 'level-opt' + (level.id === current.id ? ' active' : '');
      btn.textContent = level.name;
      btn.title = level.desc;
      if (level.id === current.id) {
        btn.style.background = level.color;
      }
      btn.addEventListener('click', () => {
        this.onSetLevel(this.city.id, level.id);
        this.city.level = level.id;
        this.render();
      });
      box.appendChild(btn);
    }
  }

  _renderSpots() {
    const box = this.el.querySelector('.spot-list');
    const spots = this.city.spots || [];
    box.innerHTML = '';

    if (!spots.length) {
      box.innerHTML = '<div class="spot-empty">还没有景点，下面加一个</div>';
      return;
    }

    for (const s of spots) {
      const chip = document.createElement('span');
      chip.className = 'spot';
      chip.innerHTML = `${esc(s)}<button title="删除">✕</button>`;
      chip.querySelector('button').addEventListener('click', () => {
        this.onRemoveSpot(this.city.id, s);
        this.city.spots = this.city.spots.filter((x) => x !== s);
        this._renderSpots();
      });
      box.appendChild(chip);
    }
  }

  _bind() {
    this.el.querySelector('.detail-close').addEventListener('click', () => this.close());

    const input = this.el.querySelector('.spot-add input');
    const addBtn = this.el.querySelector('.spot-add button');
    const doAdd = () => {
      const v = input.value.trim();
      if (!v) return;
      this.onAddSpot(this.city.id, v);
      if (!this.city.spots.includes(v)) this.city.spots.push(v);
      input.value = '';
      this._renderSpots();
    };
    addBtn.addEventListener('click', doAdd);
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        doAdd();
      }
    });

    const note = this.el.querySelector('.note-area');
    note.addEventListener('input', () => {
      clearTimeout(this._noteTimer);
      this._noteTimer = setTimeout(() => {
        this.city.note = note.value;
        this.onSaveNote(this.city.id, note.value);
      }, 400);
    });
    note.addEventListener('blur', () => {
      clearTimeout(this._noteTimer);
      this.city.note = note.value;
      this.onSaveNote(this.city.id, note.value);
    });

    this.el.querySelector('[data-act="focus"]').addEventListener('click', () => {
      this.onFocus(this.city);
    });

    this.el.querySelector('[data-act="remove"]').addEventListener('click', () => {
      const name = this.city.name;
      if (confirm(`把「${name}」从你的清单里移除？`)) {
        const id = this.city.id;
        this.close();
        this.onRemoveCity(id);
      }
    });
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

export { UNRANKED };
