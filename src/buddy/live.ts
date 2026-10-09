import { GoogleGenAI, Modality, Type, type LiveServerMessage, type Session } from '@google/genai';
import { SILENCE_MS } from './config';

export interface LiveHooks {
  onOpen: () => void;
  onClose: (reason: string, error: boolean) => void;
  onAudio: (b64: string) => void;
  onInterrupted: () => void;
  onCaption: (text: string, done: boolean) => void;
  onTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  onSilence: () => void;
  onUserSpeech?: () => void;
}

const GESTURES = ['wave', 'nod', 'shake_head', 'jump', 'punch', 'flinch', 'duck', 'die_dramatically'];

const tools = [{
  functionDeclarations: [
    { name: 'get_screen_context', description: 'Returns what the student is looking at right now in the app: the book and page (with page text) or the lecture and time.' },
    { name: 'get_screenshot', description: 'Takes a picture of the app screen right now and shows it to you. Use it when the student says "see this", "look", or asks about something visual (diagram, figure, table, slide, video frame, a page whose text you cannot read).' },
    { name: 'start_watching', description: 'Start watching the student screen: you will keep receiving pictures of the app screen whenever it changes. Use when the student says things like "watch my screen" or "amar screen dekho".' },
    { name: 'stop_watching', description: 'Stop watching the screen. Use when the student says stop looking, or "ar dekhis na".' },
    { name: 'set_emotion', description: 'Show an emotion on the character.', parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING, description: 'happy, angry, sad, surprised or laugh' } }, required: ['name'] } },
    { name: 'play_gesture', description: 'Play a body animation on the character.', parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING, description: GESTURES.join(', ') } }, required: ['name'] } },
    { name: 'save_note', description: 'Save one short fact about the student so you remember it in future chats.', parameters: { type: Type.OBJECT, properties: { text: { type: Type.STRING, description: 'one short sentence in English' } }, required: ['text'] } },
    { name: 'recall_notes', description: 'Search ALL your saved memories about the student by keyword (a topic, subject, name). Use it when the student mentions something you might remember.', parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: 'a few keywords' } }, required: ['query'] } },
    { name: 'move_character', description: 'Move the character on the screen when the student asks (move away, go down, go up).', parameters: { type: Type.OBJECT, properties: { position: { type: Type.STRING, description: 'bottom, left, right, top, peek or hide' } }, required: ['position'] } },
  ],
}];

export class BuddySession {
  private session?: Session;
  private caption = '';
  private last = Date.now();
  private timer?: ReturnType<typeof setInterval>;
  private closed = false;

  constructor(private hooks: LiveHooks) {}

  async start(o: { apiKey: string; model: string; voice: string; instruction: string; hello: string }) {
    const ai = new GoogleGenAI({ apiKey: o.apiKey });
    this.session = await ai.live.connect({
      model: o.model,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: o.instruction,
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: o.voice } } },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        contextWindowCompression: { slidingWindow: {} },
        tools,
      },
      callbacks: {
        onopen: () => { this.hooks.onOpen(); },
        onmessage: (m: LiveServerMessage) => { void this.onMessage(m); },
        onerror: (e: ErrorEvent) => { this.finish(e?.message || 'Connection error', true); },
        onclose: (e: CloseEvent) => { this.finish(e?.reason || '', !!e?.reason); },
      },
    });
    this.timer = setInterval(() => {
      if (Date.now() - this.last > SILENCE_MS) { this.hooks.onSilence(); }
    }, 15000);
    this.session.sendRealtimeInput({ text: o.hello });
  }

  sendAudio(b64: string) {
    if (!this.session || this.closed) return;
    try { this.session.sendRealtimeInput({ audio: { data: b64, mimeType: 'audio/pcm;rate=16000' } }); } catch { /* socket closing */ }
  }

  sendImage(b64: string) {
    if (!this.session || this.closed) return;
    try { this.session.sendRealtimeInput({ video: { data: b64, mimeType: 'image/jpeg' } }); } catch { /* socket closing */ }
  }

  sendText(t: string) {
    try { this.session?.sendRealtimeInput({ text: t }); } catch { /* ignore */ }
  }

  stop() {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    try { this.session?.close(); } catch { /* ignore */ }
    this.session = undefined;
  }

  private finish(reason: string, error: boolean) {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.hooks.onClose(reason, error);
  }

  private async onMessage(m: LiveServerMessage) {
    const sc = m.serverContent;
    if (sc) {
      if (sc.interrupted) { this.caption = ''; this.hooks.onInterrupted(); }
      for (const p of sc.modelTurn?.parts ?? []) {
        if (p.inlineData?.data) { this.last = Date.now(); this.hooks.onAudio(p.inlineData.data); }
      }
      if (sc.inputTranscription?.text) { this.last = Date.now(); this.hooks.onUserSpeech?.(); }
      if (sc.outputTranscription?.text) {
        this.caption += sc.outputTranscription.text;
        this.hooks.onCaption(this.caption, false);
      }
      if (sc.turnComplete) { this.hooks.onCaption(this.caption, true); this.caption = ''; }
    }
    const calls = m.toolCall?.functionCalls;
    if (calls?.length) {
      const functionResponses = [];
      for (const c of calls) {
        let output: unknown = 'ok';
        try { output = await this.hooks.onTool(c.name ?? '', (c.args ?? {}) as Record<string, unknown>); } catch (e) { output = `error: ${String(e)}`; }
        functionResponses.push({ id: c.id, name: c.name, response: { output } });
      }
      try { this.session?.sendToolResponse({ functionResponses }); } catch { /* ignore */ }
    }
  }
}
