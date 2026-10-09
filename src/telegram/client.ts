import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { Preferences } from '@capacitor/preferences';
import bigInt from 'big-integer';

const API_ID = Number(import.meta.env.VITE_TG_API_ID);
const API_HASH = String(import.meta.env.VITE_TG_API_HASH ?? '');
const BOT_TOKEN = String(import.meta.env.VITE_TG_BOT_TOKEN ?? '');
const CHANNEL_ID = String(import.meta.env.VITE_CHANNEL_ID ?? '').trim();

let client: TelegramClient | null = null;
let connecting: Promise<TelegramClient> | null = null;
let peer: Api.TypeInputPeer | null = null;

let needsCheck = false;
let hiddenAt = 0;
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > 15000) needsCheck = true;
  });
}

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });

/** Ping Telegram; if the connection went stale (phone slept, network changed) drop it so a fresh one is created. */
async function verify(c: TelegramClient) {
  try {
    await withTimeout(c.invoke(new Api.Ping({ pingId: bigInt(Date.now()) })), 8000);
  } catch {
    client = null;
    try { await c.destroy(); } catch { /* ignore */ }
  }
}

/** Forces a connection health check, then returns a working client. */
export function checkConnection(): Promise<TelegramClient> {
  needsCheck = true;
  return getClient();
}

export async function getClient(): Promise<TelegramClient> {
  if (client && needsCheck) { needsCheck = false; await verify(client); }
  if (client) return client;
  connecting ??= (async () => {
    if (!API_ID || !API_HASH || !BOT_TOKEN) throw new Error('Missing VITE_TG_* env (check GitHub Secrets)');
    const { value } = await Preferences.get({ key: 'tg_session' });
    const c = new TelegramClient(new StringSession(value ?? ''), API_ID, API_HASH, {
      connectionRetries: 5,
      useWSS: true,
    });
    await c.start({ botAuthToken: BOT_TOKEN });
    await Preferences.set({ key: 'tg_session', value: c.session.save() as unknown as string });
    client = c;
    return c;
  })().finally(() => (connecting = null));
  return connecting;
}

/** Channel id without -100 prefix */
function rawChannelId(): string {
  return CHANNEL_ID.replace(/^-100/, '').replace(/^-/, '');
}

export async function getChannelPeer(): Promise<Api.TypeInputPeer> {
  if (peer) return peer;
  const c = await getClient();
  const id = rawChannelId();

  const saved = (await Preferences.get({ key: 'tg_channel_hash' })).value;
  if (saved) {
    peer = new Api.InputPeerChannel({ channelId: bigInt(id), accessHash: bigInt(saved) });
    return peer;
  }
  try {
    const ent = await c.getEntity(new Api.PeerChannel({ channelId: bigInt(id) }));
    if (ent instanceof Api.Channel && ent.accessHash) {
      await Preferences.set({ key: 'tg_channel_hash', value: ent.accessHash.toString() });
      peer = new Api.InputPeerChannel({ channelId: ent.id, accessHash: ent.accessHash });
      return peer;
    }
  } catch {
    /* fall through */
  }
  throw new Error(
    'Channel not resolved. Make sure the bot is admin in the channel and post one message there, then retry.',
  );
}

export async function resetSession() {
  await Preferences.remove({ key: 'tg_session' });
  await Preferences.remove({ key: 'tg_channel_hash' });
  client = null;
  peer = null;
}
