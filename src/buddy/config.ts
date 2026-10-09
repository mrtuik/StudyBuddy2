export const LANGS = [
  { code: 'bn', label: 'বাংলা', name: 'Bengali (বাংলা)' },
  { code: 'en', label: 'English', name: 'English' },
  { code: 'hi', label: 'हिन्दी', name: 'Hindi (हिन्दी)' },
  { code: 'ur', label: 'اردو', name: 'Urdu' },
  { code: 'ta', label: 'தமிழ்', name: 'Tamil' },
  { code: 'te', label: 'తెలుగు', name: 'Telugu' },
  { code: 'mr', label: 'मराठी', name: 'Marathi' },
  { code: 'gu', label: 'ગુજરાતી', name: 'Gujarati' },
];
export const langName = (code: string) => LANGS.find((l) => l.code === code)?.name ?? 'English';

export const VOICES = ['Puck', 'Zephyr', 'Kore', 'Aoede', 'Leda', 'Charon', 'Fenrir', 'Orus'];

/** shown in Profile as hints; the model name changes often, so it is editable there */
export const MODEL_HINTS = ['gemini-3.1-flash-live-preview', 'gemini-2.5-flash-native-audio-preview-12-2025'];

/** the video-call window (3:4) */
export const CHAR_W = 150;
export const CHAR_H = 200;
/** default spot: clearly above the "continue" bar */
export const POS_RIGHT = 12;
export const POS_BOTTOM = 164;
export const SILENCE_MS = 3 * 60 * 1000;
