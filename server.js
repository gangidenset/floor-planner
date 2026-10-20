// AI Floor Planner 用の小さなサーバー
// - アプリの静的ファイルを配信する
// - /api/ai-layout で Claude API を呼び出す（APIキーはサーバーの環境変数 ANTHROPIC_API_KEY にのみ置く）
//   キーまたは SDK が無い場合は 501 を返し、ブラウザ側はデモモードで動作する
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || Number(process.argv[2]) || 5173;
const MODEL = process.env.AI_MODEL || 'claude-opus-5-5';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
};

// ---------------------------------------------------------------------------
// Claude API（SDK は任意。`npm install` 済みかつキー設定時のみ有効）
// ---------------------------------------------------------------------------
let client = null;
if (process.env.ANTHROPIC_API_KEY) {
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    client = new Anthropic();
  } catch {
    console.warn('[AI] @anthropic-ai/sdk が見つかりません。`npm install` を実行するとAI提案が有効になります（現在はデモモード）。');
  }
}

const furnitureSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'type', 'name', 'x', 'y', 'width', 'depth', 'height', 'rotation', 'color'],
  properties: {
    id: { type: 'string', description: '既存家具を使う場合はその id、新規は空文字' },
    type: { type: 'string' }, name: { type: 'string' },
    x: { type: 'number' }, y: { type: 'number' },
    width: { type: 'number' }, depth: { type: 'number' }, height: { type: 'number' },
    rotation: { type: 'number' }, color: { type: 'string' },
  },
};
const proposalSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['proposals'],
  properties: {
    proposals: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'concept', 'features', 'reasons', 'merits', 'cautions', 'furniture'],
        properties: {
          id: { type: 'string' }, title: { type: 'string' }, concept: { type: 'string' },
          features: { type: 'array', items: { type: 'string' } },
          reasons: { type: 'string' },
          merits: { type: 'array', items: { type: 'string' } },
          cautions: { type: 'array', items: { type: 'string' } },
          furniture: { type: 'array', items: furnitureSchema },
        },
      },
    },
  },
};

const SYSTEM = `あなたは住宅のインテリア配置の専門家です。与えられた部屋・ドア・窓・家具のデータから、実際に配置できる家具レイアウトを3案作成します。
座標と単位のルール（厳守）:
- 単位はすべて cm。部屋は room.x, room.y を左上とする矩形（横幅 width、奥行き depth）。x は右向き、y は下向きに増える。
- 家具の x, y は家具の「中心」。width は家具の横幅、depth は奥行き。rotation は時計回りの角度（度）。
- rotation=0 のとき家具の正面（座る側・使う側）は画面下向き(+y)、背面は上向き(-y)。90 で正面は左(-x)、180 で上(-y)、270 で右(+x)。壁に背を付ける家具は、上の壁=0、右の壁=90、下の壁=180、左の壁=270。
- ドア・窓の位置: wall は top/right/bottom/left、offset は壁の左端（左右の壁は上端）からの距離、width は開口幅。
ルール:
- 家具は部屋からはみ出さない。家具同士は重ねない（ラグの上の家具、テーブルとチェアの一部、天井照明は可）。
- ドアの開閉範囲（開口幅の正方形）、収納扉の前70cm、掃き出し窓(sill=floor)の前50cmには家具を置かない。腰窓の前に高さ90cm以上の家具を置かない。
- 入口から幅50cm以上の通路を確保し、ソファの前・収納の前・ベッドの横に使うためのスペースを残す。
- locked=true の家具は位置を変えずにそのまま出力する。既存家具（conditions.owned に含まれる id）は寸法を変えず、同じ id を使う。conditions.wanted の type は新しく追加し id は空文字にする。
- type は library にある type のみを使う。
- 3案は A=生活動線重視、B=開放感重視、C=インテリア性重視 とし、それぞれ明確に異なる配置にする。説明文は日本語で、features/merits/cautions は各2〜4項目。`;

async function aiLayout(body) {
  const user = `次のデータで3つの配置案を作成してください。\n${JSON.stringify(body)}`;
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: proposalSchema } },
    system: SYSTEM,
    messages: [{ role: 'user', content: user }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw Object.assign(new Error('AIが提案を作成できませんでした'), { status: 502 });
  if (msg.stop_reason === 'max_tokens') throw Object.assign(new Error('AIの返答が長すぎて途中で終了しました'), { status: 502 });
  const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const data = JSON.parse(text);
  return { model: msg.model || MODEL, proposals: data.proposals || [] };
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
function sendJSON(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

async function readBody(req, limit = 2_000_000) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('リクエストが大きすぎます'), { status: 413 });
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/status') {
      return sendJSON(res, 200, { ai: !!client, model: client ? MODEL : null });
    }
    if (url.pathname === '/api/ai-layout') {
      if (req.method !== 'POST') return sendJSON(res, 405, { error: 'POST のみ対応しています' });
      if (!client) return sendJSON(res, 501, { error: 'AI API が未設定です（デモモード）' });
      const body = await readBody(req);
      const result = await aiLayout(body);
      return sendJSON(res, 200, result);
    }
    // 静的ファイル
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT) || rel.includes('node_modules') || path.basename(file).startsWith('.')) {
      res.writeHead(403); return res.end('Forbidden');
    }
    const st = await stat(file).catch(() => null);
    if (!st || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(await readFile(file));
  } catch (err) {
    console.error('[server]', err);
    sendJSON(res, err.status || 500, { error: err.status ? err.message : `サーバーエラー: ${err.message}` });
  }
});

server.listen(PORT, () => {
  console.log(`AI Floor Planner: http://localhost:${PORT}`);
  console.log(client ? `AI提案: 有効（${MODEL}）` : 'AI提案: デモモード（ANTHROPIC_API_KEY 未設定、または SDK 未インストール）');
});
