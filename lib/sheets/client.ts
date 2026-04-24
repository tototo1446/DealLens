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
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, secret, payload }),
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`GAS request failed: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as GasResponse<TResult>;
  if (!json.ok) {
    throw new Error(`GAS action "${action}" failed: ${json.error ?? "unknown"}`);
  }
  return json;
}
