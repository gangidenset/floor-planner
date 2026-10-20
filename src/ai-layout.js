// AI配置提案：サーバー（/api/ai-layout）経由で AI を呼び出し、使えない場合はデモモードで生成する。
// APIキーはブラウザには置かない。サーバー側の環境変数でのみ管理する。
import { generateDemoProposals } from './ai-demo.js';
import { LIBRARY, LIBRARY_MAP, getSpec } from './data/furniture-library.js';
import { normAngle, uid } from './geometry.js';

export async function checkAIStatus() {
  try {
    const res = await fetch('api/status', { cache: 'no-store' });
    if (!res.ok) return { ai: false };
    return await res.json();
  } catch {
    return { ai: false };
  }
}

/** AIに渡す最小限のデータ（背景画像などは送らない） */
function buildRequest(project, furniture, cond) {
  return {
    room: project.room,
    openings: project.openings.map(({ id, type, wall, offset, width, hinge, sill, label }) => ({ id, type, wall, offset, width, hinge, sill, label })),
    furniture: furniture.map(({ id, type, name, category, x, y, width, depth, height, rotation, color, locked }) => ({ id, type, name, category, x, y, width, depth, height, rotation, color, locked })),
    conditions: cond,
    library: LIBRARY.map(({ type, category, name, width, depth, height }) => ({ type, category, name, width, depth, height })),
  };
}

function num(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

/** AI の返答を家具データ形式に正規化する（型の補完・固定家具の保護） */
export function normalizeProposal(raw, furniture, index) {
  const keys = ['A', 'B', 'C', 'D', 'E'];
  const byId = new Map(furniture.map(f => [f.id, f]));
  const out = [];
  for (const f of raw.furniture || []) {
    const orig = f.id && byId.get(f.id);
    if (orig?.locked) continue; // 固定家具は元の位置を使う
    const type = LIBRARY_MAP[f.type] ? f.type : (orig?.type || LIBRARY.find(l => l.category === f.category)?.type);
    if (!type) continue;
    const spec = getSpec(type);
    out.push({
      id: orig ? orig.id : uid(type),
      type,
      name: String(f.name || orig?.name || spec.name).slice(0, 40),
      category: spec.category,
      x: Math.round(num(f.x, 0)),
      y: Math.round(num(f.y, 0)),
      width: Math.max(5, Math.round(num(f.width, orig?.width ?? spec.width))),
      depth: Math.max(5, Math.round(num(f.depth, orig?.depth ?? spec.depth))),
      height: Math.max(0, Math.round(num(f.height, orig?.height ?? spec.height))),
      rotation: normAngle(num(f.rotation, 0)),
      color: /^#[0-9a-f]{6}$/i.test(f.color || '') ? f.color : (orig?.color || spec.color),
      locked: false,
    });
  }
  for (const f of furniture) if (f.locked) out.unshift({ ...f });
  const arr = v => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : []);
  return {
    id: raw.id || keys[index] || String(index + 1),
    title: String(raw.title || `${keys[index]}案`),
    concept: String(raw.concept || ''),
    features: arr(raw.features),
    reasons: String(raw.reasons || ''),
    merits: arr(raw.merits),
    cautions: arr(raw.cautions),
    furniture: out,
    source: 'ai',
  };
}

/**
 * 配置提案を取得する。
 * 戻り値: { mode: 'ai' | 'demo', proposals, apiError? }
 */
export async function requestProposals(project, furniture, cond, { forceDemo = false } = {}) {
  let apiError = null;
  if (!forceDemo) {
    try {
      const res = await fetch('api/ai-layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildRequest(project, furniture, cond)),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.proposals) && data.proposals.length) {
          return { mode: 'ai', model: data.model, proposals: data.proposals.slice(0, 5).map((p, i) => normalizeProposal(p, furniture, i)) };
        }
        apiError = 'AIの返答に配置案が含まれていませんでした';
      } else if (![404, 405, 501].includes(res.status)) {
        const err = await res.json().catch(() => ({}));
        apiError = err.error || `AI APIエラー（HTTP ${res.status}）`;
      }
    } catch {
      // サーバーが無い（静的ホスティング・オフラインなど）→ デモモード
    }
  }
  const demo = generateDemoProposals(project, furniture, cond);
  return { ...demo, apiError };
}
