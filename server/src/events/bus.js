// In-process event bus. Events: risk_update, risk_escalation, risk_deescalation, inbox_message, inbox_updated,
// weather_refreshed, controls_changed, alert_published (Phase 2+).
import { EventEmitter } from 'node:events';

export const bus = new EventEmitter();
bus.setMaxListeners(100);
