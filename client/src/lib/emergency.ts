// Immediate-danger check for what people type or say to Saathi. Runs in the browser before anything is sent, so it
// works offline and without a chosen place. The word list is shared with the server (shared/config/emergency.json).
import emergency from '@shared/config/emergency.json';

const RE = new RegExp(emergency.patterns.join('|'), 'i');

export const isEmergency = (text: string) => RE.test(text.normalize('NFC'));
