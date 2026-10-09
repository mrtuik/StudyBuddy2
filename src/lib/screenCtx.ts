import { useLibrary } from '../store/library';

/** Screens (PDF reader, video player) register a function that describes what the student is looking at right now. Buddy asks for it. */
type Provider = () => string | Promise<string>;
let provider: Provider | undefined;

export const screenCtx = {
  set(p?: Provider) { provider = p; },
  async get(path: string): Promise<string> {
    let extra = '';
    try { extra = provider ? await provider() : ''; } catch { /* ignore */ }
    if (!extra) {
      const last = useLibrary.getState().recents[0];
      extra = last ? `Nothing specific is open. The student last opened: "${last.title}".` : 'Nothing specific is open.';
    }
    return `Screen: ${path || '/'}\n${extra}`;
  },
};
