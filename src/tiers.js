/**
 * 从夯到拉 —— 五档等级定义
 *
 * 网络流行评价体系，从高到低：
 *   夯 → 顶级 → 人上人 → NPC → 拉完了
 *
 * 另有「未定级」状态：城市刚加入列表、还没被拖动定级时使用。
 */

export const TIERS = [
  {
    id: 'hang',
    name: '夯',
    sub: '天花板',
    desc: '强到离谱、封神级，无可挑剔的 NO.1',
    color: '#e6b422',
    colorSoft: '#3a2f0d',
    rank: 0,
  },
  {
    id: 'ding',
    name: '顶级',
    sub: '行业标杆',
    desc: '仅次于夯，顶尖水平，几乎没瑕疵',
    color: '#4a8fe7',
    colorSoft: '#12243d',
    rank: 1,
  },
  {
    id: 'ren',
    name: '人上人',
    sub: '值得冲',
    desc: '中上游水准，有亮点、不踩雷',
    color: '#3fb8a0',
    colorSoft: '#0e2b26',
    rank: 2,
  },
  {
    id: 'npc',
    name: 'NPC',
    sub: '路人甲',
    desc: '普通、平庸、没特色，不好不坏',
    color: '#9aa0a6',
    colorSoft: '#22262a',
    rank: 3,
  },
  {
    id: 'la',
    name: '拉完了',
    sub: '地板砖',
    desc: '差到极致、烂透了、完全没救',
    color: '#c0392b',
    colorSoft: '#3a1512',
    rank: 4,
  },
];

/** 未定级 —— 不在五档之内，单独一个状态 */
export const UNRANKED = {
  id: 'none',
  name: '未定级',
  sub: '待你定',
  desc: '刚加入列表，还没排进任何档位',
  color: '#4b5563',
  colorSoft: '#1a1d21',
  rank: 99,
};

export const ALL_LEVELS = [...TIERS, UNRANKED];

const BY_ID = new Map(ALL_LEVELS.map((t) => [t.id, t]));

export function getTier(id) {
  return BY_ID.get(id) || UNRANKED;
}

/** 按 rank 升序（夯在最前） */
export function sortedTiers() {
  return [...TIERS].sort((a, b) => a.rank - b.rank);
}

export function isRanked(levelId) {
  return BY_ID.has(levelId) && levelId !== UNRANKED.id;
}
