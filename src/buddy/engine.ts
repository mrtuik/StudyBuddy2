import { useBuddy } from '../store/buddy';
import { screenCtx } from '../lib/screenCtx';
import { MicCapture, Speaker } from './audio';
import { BuddySession } from './live';
import { buildInstruction } from './prompt';
import { langName } from './config';
import { ensureMic } from './mic';
import { captureScreen, gridDiff, screenCaptureAvailable } from './screen';
import { memoryReady, useBuddyMemory } from '../store/buddyMemory';

let speaker: Speaker | undefined;
let mic: MicCapture | undefined;
let sess: BuddySession | undefined;

let watchTimer: ReturnType<typeof setInterval> | undefined;
let lastGrid = '';
let lastShot = 0;
let shooting = false;

/** sends one picture of the app window to Gemini (only when it changed, unless forced) */
async function sendShot(force: boolean): Promise<boolean> {
  const b = useBuddy.getState();
  if (shooting || !sess || b.status !== 'live') return false;
  shooting = true;
  try {
    const shot = await captureScreen(768, 60);
    if (!shot) return false;
    if (!force && gridDiff(lastGrid, shot.grid) < 0.03) return false;
    lastGrid = shot.grid; lastShot = Date.now();
    sess?.sendImage(shot.data);
    return true;
  } finally { shooting = false; }
}

export function buddyWatch(on: boolean): string {
  if (watchTimer) { clearInterval(watchTimer); watchTimer = undefined; }
  useBuddy.getState().set({ watching: on });
  if (!on) return 'stopped watching';
  if (!screenCaptureAvailable()) { useBuddy.getState().set({ watching: false }); return 'cannot watch the screen on this phone; only the text context is available'; }
  lastGrid = '';
  void sendShot(true);
  watchTimer = setInterval(() => {
    const s = useBuddy.getState();
    if (document.hidden || s.muted || s.peek || s.status !== 'live') return;     // paused while backgrounded / muted / peeking
    void sendShot(false);
  }, 3000);
  return 'watching: you will now receive pictures of the screen when it changes';
}
const stopWatch = () => buddyWatch(false);

const path = () => window.location.hash.replace(/^#/, '') || '/';
export const buddyLevel = () => speaker?.level() ?? 0;

const EMOTION: Record<string, string> = { happy: 'happy', angry: 'angry', sad: 'sad', surprised: 'surprised', laugh: 'laugh' };

export function buddyStop(caption = '') {
  if (sess) useBuddyMemory.getState().endSession();
  stopWatch();
  sess?.stop(); mic?.stop(); speaker?.close();
  sess = undefined; mic = undefined; speaker = undefined;
  useBuddy.getState().set({ status: 'off', caption, peek: false });
}

const fail = (msg: string) => {
  stopWatch();
  sess?.stop(); mic?.stop(); speaker?.close();
  sess = undefined; mic = undefined; speaker = undefined;
  useBuddy.getState().set({ status: 'error', caption: msg });
};

export async function buddyStart() {
  const b = useBuddy.getState();
  if (b.status === 'connecting' || b.status === 'live') return;
  b.set({ status: 'connecting', caption: '', peek: false, muted: false, micBlocked: false });
  if (!(await ensureMic())) {
    useBuddy.getState().set({ micBlocked: true });
    fail('Buddy needs the microphone to hear you. Allow it and try again.');
    return;
  }
  try {
    speaker = new Speaker();
    await speaker.resume();
    mic = new MicCapture();
    await mic.start();                                   // Android shows the microphone permission dialog here
  } catch (e) {
    const denied = /denied|permission|NotAllowed/i.test(String(e));
    fail(denied ? 'Microphone permission is off. Allow it in the phone settings for StudyBuddy.' : 'Could not start the microphone.');
    return;
  }

  sess = new BuddySession({
    onOpen: () => { useBuddy.getState().set({ status: 'live' }); useBuddy.getState().doGesture('wave'); },
    onClose: (reason, error) => {
      const bad = /model|not found|404|unsupported|not supported/i.test(reason);
      const key = /api key|permission|401|403|invalid/i.test(reason);
      stopWatch();
      if (sess) useBuddyMemory.getState().endSession();
      mic?.stop(); speaker?.close(); sess = undefined; mic = undefined; speaker = undefined;
      useBuddy.getState().set({
        status: error ? 'error' : 'off',
        caption: error ? (key ? 'Gemini rejected the API key. Check it in Profile.' : bad ? 'This Gemini model is not available. Change the model in Profile.' : reason || 'Connection lost. Tap to try again.') : '',
      });
    },
    onAudio: (d) => speaker?.play(d),
    onInterrupted: () => speaker?.clear(),
    onCaption: (t) => useBuddy.getState().set({ caption: t.slice(-160) }),
    onTool: async (name, args) => {
      const s = useBuddy.getState();
      if (name === 'get_screen_context') return await screenCtx.get(path());
      if (name === 'get_screenshot') {
        if (!screenCaptureAvailable()) return 'screenshots are not available on this phone; use get_screen_context instead';
        return (await sendShot(true)) ? 'picture sent, look at it now' : 'could not take the picture; use get_screen_context instead';
      }
      if (name === 'start_watching') return buddyWatch(true);
      if (name === 'stop_watching') return buddyWatch(false);
      if (name === 'set_emotion') { s.doGesture(EMOTION[String(args.name)] ?? 'nod'); return 'ok'; }
      if (name === 'play_gesture') { s.doGesture(String(args.name)); return 'ok'; }
      if (name === 'save_note') { useBuddyMemory.getState().add(String(args.text ?? '')); return 'saved'; }
      if (name === 'recall_notes') { const r = useBuddyMemory.getState().search(String(args.query ?? '')); return r.length ? r.map((n) => n.text) : 'nothing found'; }
      if (name === 'move_character') { s.moveTo(String(args.position)); return 'ok'; }
      return 'unknown tool';
    },
    onUserSpeech: () => { if (useBuddy.getState().watching && Date.now() - lastShot > 1500) void sendShot(false); },
    onSilence: () => buddyStop('Buddy went to sleep because it was quiet. Tap to wake it.'),
  });
  mic.onChunk = (c) => { if (!useBuddy.getState().muted && useBuddy.getState().status === 'live') sess?.sendAudio(c); };

  const s = useBuddy.getState();
  await memoryReady;
  const mem = useBuddyMemory.getState();
  try {
    await sess.start({
      apiKey: s.apiKey.trim(),
      model: s.model.trim(),
      voice: s.voice,
      instruction: buildInstruction({ name: s.name, gender: s.gender, age: s.age, lang: s.lang, roast: s.roast, notes: mem.pick(40).map((n) => n.text), total: mem.notes.length, sessions: mem.sessions, lastSeen: mem.lastSeen }),
      hello: `The session just started. Greet ${s.name} now, in ${langName(s.lang)}.`,
    });
  } catch (e) {
    fail(/key|403|401|permission/i.test(String(e)) ? 'Gemini rejected the API key. Check it in Profile.' : `Could not connect: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
  }
}
