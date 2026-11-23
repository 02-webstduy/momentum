// Momentum Cloud Agent contract: POST {action, input} -> {ok:true,data} or {ok:false,error}.
// The frontend (src/agent/client.ts) validates every field again, so this handler
// only has to call the LLM and return parsed JSON; errors degrade to the local fallback.
// LLM_API_KEY is a Qoder Sites Secret read at runtime, never hardcoded or returned.

type Action = "decompose" | "daySummary";

const UPSTREAM_URL = "https://api.openai.com/v1/chat/completions";
// Must stay below the frontend's 9s timeout so the client can map failures itself.
const UPSTREAM_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 100_000;

function rulesFor(action: Action): string[] {
  if (action === "decompose") {
    return [
      "生成 4–7 个阶段，每阶段 2–4 个里程碑。",
      "阶段与里程碑 weight 取 1–10 整数。",
      "metric 型必须给 metricKey（commits|sessions|days|custom）与 targetValue，且与 manual 型混合。",
      '返回 JSON：{"stages":[{name,weight,milestones:[{name,weight,type,metricKey?,targetValue?}]}]}',
    ];
  }
  return [
    "只转述给定 facts，不推测动机，不评价努力程度。",
    "narrative 不超过 120 字。",
    "highlights 每条必须能在 evidence 中找到对应项，最多 5 条。",
    "blockers 没有证据时必须是空数组。",
    "nextStep 只能引用未完成里程碑。",
    "禁用感叹号堆砌与空泛夸奖。",
    '返回 JSON：{"narrative","highlights","blockers","nextStep","evidence":[{ref,kind}]}',
  ];
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function handler(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  let body: { action?: unknown; input?: unknown };
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return json({ ok: false, error: "payload_too_large" }, 413);
    body = JSON.parse(text);
  } catch {
    return json({ ok: false, error: "bad_json" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ ok: false, error: "bad_json" }, 400);
  }

  const { action, input } = body;
  if (action !== "decompose" && action !== "daySummary") {
    return json({ ok: false, error: "unknown_action" }, 400);
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return json({ ok: false, error: "missing_input" }, 400);
  }

  const key = Deno.env.get("LLM_API_KEY");
  if (!key) return json({ ok: false, error: "no_key" }, 503);

  const prompt = [
    ...rulesFor(action),
    "---",
    "输入数据：",
    JSON.stringify(input).slice(0, 6000),
  ].join("\n");

  try {
    const resp = await fetch(UPSTREAM_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "你是数据转述器。只输出合法 JSON，不加任何解释。" },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!resp.ok) return json({ ok: false, error: "upstream" }, 502);
    const payload = await resp.json();
    const text = payload?.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) {
      return json({ ok: false, error: "upstream" }, 502);
    }
    return json({ ok: true, data: JSON.parse(text) });
  } catch {
    return json({ ok: false, error: "upstream" }, 502);
  }
}
