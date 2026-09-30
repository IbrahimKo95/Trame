// Appels au serveur IA (server/index.mjs). La clé Groq reste côté serveur.
import type { Schema } from "../../store";

export type AiResult = { schema: Schema; warnings: string[] };

let health: Promise<boolean> | null = null;
/** Vrai si le serveur répond et que GROQ_API_KEY est configurée (mis en cache). */
export function aiAvailable(): Promise<boolean> {
  return (health ||= fetch("/api/health").then((r) => (r.ok ? r.json() : null)).then((j) => !!j?.ai).catch(() => false));
}

export async function generateSchema(prompt: string, dialect: string, current: Schema | null, signal?: AbortSignal): Promise<AiResult> {
  let res: Response;
  try {
    res = await fetch("/api/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt, dialect, current }), signal });
  } catch (e: any) {
    if (e?.name === "AbortError") throw e;
    throw new Error("Serveur injoignable.");
  }
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.schema) throw new Error(j?.error || `Erreur ${res.status}`);
  return j as AiResult;
}
