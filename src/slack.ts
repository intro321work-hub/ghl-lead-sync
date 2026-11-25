// Error alerts to Slack through an Incoming Webhook.

export interface Alerter {
  alert(message: string): Promise<void>;
}

export class SlackAlerter implements Alerter {
  constructor(private readonly webhookUrl: string, private readonly fetchFn: typeof fetch = fetch) {}

  async alert(message: string): Promise<void> {
    try {
      const res = await this.fetchFn(this.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: message }),
      });
      if (!res.ok) console.error(`Slack alert failed with HTTP ${res.status}`);
    } catch (err) {
      // Never let a failed alert hide the original error.
      console.error("Slack alert failed:", (err as Error).message);
    }
  }
}

/** Fallback when no Slack webhook is configured: alerts go to the function logs. */
export class ConsoleAlerter implements Alerter {
  async alert(message: string): Promise<void> {
    console.error(`[ALERT] ${message}`);
  }
}
