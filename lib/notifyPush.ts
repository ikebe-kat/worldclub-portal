const WC_PUSH_URL = "https://pktqlbpdjemmomfanvgt.supabase.co/functions/v1/send-push-wc";

export async function notifyPush(type: string, payload: Record<string, unknown>): Promise<void> {
  try {
    await fetch(WC_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, payload }),
    });
  } catch (err) {
    console.error("[notifyPush] failed:", err);
  }
}
