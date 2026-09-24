// STUB (clearly labelled): SMS and push delivery adapters. Dashboard delivery is real (SSE + alerts table);
// SMS and push are logged as 'stub_sent' until a provider is configured. Swap in Twilio / FCM here.
export const smsProvider = {
  name: 'twilio-stub',
  async send({ alertId, text, target }) {
    // Real implementation: POST to Twilio Messages API with numbers resolved for `target`.
    return { status: 'stub_sent', detail: `SMS stub for ${target.type}:${target.id} (${text.length} chars) — alert ${alertId}` };
  },
};

export const pushProvider = {
  name: 'fcm-stub',
  async send({ alertId, title, target }) {
    // Real implementation: FCM topic message to `area-${target.id}`.
    return { status: 'stub_sent', detail: `Push stub for ${target.type}:${target.id} "${title}" — alert ${alertId}` };
  },
};
