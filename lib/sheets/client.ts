/**
 * GAS Web App 経由で Google Sheets を操作するクライアント
 */

export type GasAction = "upsert" | "ping";

export interface GasRequest<T = unknown> {
  action: GasAction;
  secret: string;
  payload?: T;
}

export interface GasResponse<T = unknown> {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
  data?: T;
}

function env(): { url: string; secret: string } {
  const url = process.env.GAS_WEB_APP_URL;
  const secret = process.env.GAS_SHARED_SECRET;
  if (!url || !secret) {
    throw new Error(
      "GAS env missing: GAS_WEB_APP_URL / GAS_SHARED_SECRET"
    );
  }
  return { url, secret };
}

export async function callGas<TPayload = unknown, TResult = unknown>(
  action: GasAction,
  payload?: TPayload
): Promise<GasResponse<TResult>> {
  const { url, secret } = env();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, secret, payload }),
      redirect: "follow",
      signal: controller.signal,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`GAS fetch failed: ${msg}`);
  } finally {
    clearTimeout(timeout);
  }

  const bodyText = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(
      `GAS HTTP ${res.status} ${res.statusText}: ${bodyText.slice(0, 300)}`
    );
  }

  let json: GasResponse<TResult>;
  try {
    json = JSON.parse(bodyText) as GasResponse<TResult>;
  } catch {
    // GAS Web App は認可エラー時に HTML を返してくることがある
    throw new Error(
      `GAS response is not JSON (HTTP ${res.status}): ${bodyText.slice(0, 300)}`
    );
  }
  if (!json.ok) {
    throw new Error(`GAS action "${action}" failed: ${json.error ?? "unknown"}`);
  }
  return json;
}
