// Posting from inside the app. Uses a SEPARATE "poster" bot (its token is typed in once on the phone and
// stored only on the phone, never inside the APK). The reader bot in the APK has no post permission.
import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { Preferences } from '@capacitor/preferences';
import bigInt from 'big-integer';

const API_ID = Number(import.meta.env.VITE_TG_API_ID);
const API_HASH = String(import.meta.env.VITE_TG_API_HASH ?? '');
const READER_TOKEN = String(import.meta.env.VITE_TG_BOT_TOKEN ?? '');
const CHANNEL_ID = String(import.meta.env.VITE_CHANNEL_ID ?? '').trim();
const K = { token: 'tg_poster_token', session: 'tg_poster_session', hash: 'tg_poster_hash' };

let client: TelegramClient | null = null;
let peer: Api.TypeInputPeer | null = null;
let connecting: Promise<TelegramClient> | null = null;

export const getPosterToken = async () => (await Preferences.get({ key: K.token })).value ?? '';

export async function forgetPoster() {
  for (const k of Object.values(K)) await Preferences.remove({ key: k });
  const c = client;
  client = null;
  peer = null;
  if (c) { try { await c.destroy(); } catch { /* ignore */ } }
}

async function posterClient(): Promise<TelegramClient> {
  if (client) return client;
  connecting ??= (async () => {
    const token = await getPosterToken();
    if (!token) throw new Error('Posting bot token is not set.');
    const { value } = await Preferences.get({ key: K.session });
    const c = new TelegramClient(new StringSession(value ?? ''), API_ID, API_HASH, { connectionRetries: 5, useWSS: true });
    await c.start({ botAuthToken: token });
    await Preferences.set({ key: K.session, value: c.session.save() as unknown as string });
    client = c;
    return c;
  })().finally(() => (connecting = null));
  return connecting;
}

async function channelPeer(): Promise<Api.TypeInputPeer> {
  if (peer) return peer;
  const c = await posterClient();
  const id = CHANNEL_ID.replace(/^-100/, '').replace(/^-/, '');
  const saved = (await Preferences.get({ key: K.hash })).value;
  if (saved) {
    peer = new Api.InputPeerChannel({ channelId: bigInt(id), accessHash: bigInt(saved) });
    return peer;
  }
  try {
    const ent = await c.getEntity(new Api.PeerChannel({ channelId: bigInt(id) }));
    if (ent instanceof Api.Channel && ent.accessHash) {
      await Preferences.set({ key: K.hash, value: ent.accessHash.toString() });
      peer = new Api.InputPeerChannel({ channelId: ent.id, accessHash: ent.accessHash });
      return peer;
    }
  } catch { /* fall through */ }
  throw new Error('The posting bot cannot see the channel. Add it as an admin of the channel with the "Post messages" permission.');
}

/** Saves the token, logs in once and checks the channel. Returns the bot username. */
export async function connectPoster(raw: string): Promise<string> {
  const token = raw.trim();
  if (!/^\d+:[\w-]{30,}$/.test(token)) throw new Error('That does not look like a bot token (123456:ABC...).');
  if (token === READER_TOKEN) throw new Error('This is the app\'s reading bot. Create a second bot in @BotFather just for posting.');
  await forgetPoster();
  await Preferences.set({ key: K.token, value: token });
  try {
    const c = await posterClient();
    const me = (await c.getMe()) as Api.User;
    await channelPeer();
    return me.username ?? 'bot';
  } catch (e) {
    await forgetPoster();
    throw e;
  }
}

/* ---------- helpers ---------- */
export interface VideoMeta { duration: number; w: number; h: number; thumb?: File }

/** Reads length / size of a picked video and grabs one frame as its preview picture. Never fails: falls back to defaults. */
export function readVideoMeta(file: File): Promise<VideoMeta> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    let meta: VideoMeta = { duration: 0, w: 1280, h: 720 };
    let finished = false;
    const done = (m: VideoMeta) => {
      if (finished) return;
      finished = true;
      clearTimeout(t);
      URL.revokeObjectURL(url);
      v.removeAttribute('src');
      v.load();
      resolve(m);
    };
    const t = setTimeout(() => done(meta), 10000);
    v.preload = 'auto';
    v.muted = true;
    v.playsInline = true;
    v.onerror = () => done(meta);
    v.onloadedmetadata = () => {
      meta = { duration: Math.round(v.duration || 0), w: v.videoWidth || 1280, h: v.videoHeight || 720 };
      const at = v.duration > 4 ? Math.min(v.duration * 0.1, 30) : 0.1;   // a little way in, so it is not a black first frame
      try { v.currentTime = at; } catch { done(meta); }
    };
    v.onseeked = () => {
      try {
        const k = Math.min(1, 480 / Math.max(v.videoWidth, v.videoHeight, 1));
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(v.videoWidth * k));
        cv.height = Math.max(1, Math.round(v.videoHeight * k));
        cv.getContext('2d')!.drawImage(v, 0, 0, cv.width, cv.height);
        cv.toBlob((b) => done(b ? { ...meta, thumb: new File([b], 'thumb.jpg', { type: 'image/jpeg' }) } : meta), 'image/jpeg', 0.8);
      } catch { done(meta); }
    };
    v.src = url;
  });
}

type ImgKind = 'jpeg' | 'png' | 'gif' | 'webp' | 'heic' | 'avif' | 'unknown';

/** Looks at the first bytes, because the file name / mime type a phone picker reports is not always right. */
function sniff(b: Uint8Array): ImgKind {
  const at = (i: number, s: string) => [...s].every((ch, k) => b[i + k] === ch.charCodeAt(0));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x89 && at(1, 'PNG')) return 'png';
  if (at(0, 'GIF8')) return 'gif';
  if (at(0, 'RIFF') && at(8, 'WEBP')) return 'webp';
  if (at(4, 'ftyp')) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if (/^(avif|avis)$/.test(brand)) return 'avif';
    if (/^(heic|heix|hevc|hevx|mif1|msf1)$/.test(brand)) return 'heic';
  }
  return 'unknown';
}
const MIME: Record<ImgKind, string> = { jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', avif: 'image/avif', unknown: 'image/jpeg' };

const asDataUrl = (blob: Blob) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result));
  r.onerror = () => rej(r.error ?? new Error('read failed'));
  r.readAsDataURL(blob);
});

/** Decodes image bytes. Several routes are tried because Android WebViews are picky (blob URLs, ImageBitmap, data URLs). */
async function decodeImage(bytes: Uint8Array, kind: ImgKind): Promise<{ src: CanvasImageSource; w: number; h: number; close: () => void }> {
  const blob = new Blob([bytes], { type: MIME[kind] });
  let lastErr: unknown;
  try {
    const bmp = await createImageBitmap(blob);
    return { src: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close() };
  } catch (e) { lastErr = e; }
  for (const mk of [async () => URL.createObjectURL(blob), () => asDataUrl(blob)]) {
    let url = '';
    try {
      url = await mk();
      const img = new Image();
      img.src = url;
      await img.decode();
      if (!img.naturalWidth) throw new Error('empty image');
      return { src: img, w: img.naturalWidth, h: img.naturalHeight, close: () => { if (url.startsWith('blob:')) URL.revokeObjectURL(url); } };
    } catch (e) { lastErr = e; if (url.startsWith('blob:')) URL.revokeObjectURL(url); }
  }
  throw lastErr instanceof Error ? lastErr : new Error('The image could not be decoded.');
}

/**
 * Shrinks a picked image to a JPEG so Telegram treats it as a photo (needed for covers).
 * If this phone cannot decode the image, a JPEG / PNG is sent as it is: Telegram reads those itself.
 */
export async function toJpeg(file: File, max = 1280): Promise<File> {
  if (!file.size) throw new Error('The selected image is empty. Pick it again.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniff(bytes);
  try {
    const img = await decodeImage(bytes, kind);
    try {
      const k = Math.min(1, max / Math.max(img.w, img.h));
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(img.w * k));
      cv.height = Math.max(1, Math.round(img.h * k));
      const ctx = cv.getContext('2d')!;
      ctx.fillStyle = '#fff';                            // PNG transparency would turn black in a JPEG
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img.src, 0, 0, cv.width, cv.height);
      const blob = await new Promise<Blob>((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('Could not process the image'))), 'image/jpeg', 0.88));
      return new File([blob], 'cover.jpg', { type: 'image/jpeg' });
    } finally { img.close(); }
  } catch (e) {
    if (kind === 'jpeg' || kind === 'png') return new File([bytes], kind === 'jpeg' ? 'cover.jpg' : 'cover.png', { type: MIME[kind] });
    if (kind === 'heic' || kind === 'avif') throw new Error('This photo is in HEIC / AVIF format, which this phone cannot read. Pick a JPG or PNG image instead.');
    throw new Error(`This image could not be read. Pick a JPG or PNG image. (${String((e as Error)?.message ?? e)})`);
  }
}

/* ---------- uploading ---------- */
// The file is sent to Telegram in 512 KB parts straight from disk (File.slice), a few parts at a time.
// Nothing needs the whole file in memory, so big PDFs / videos work, and gramjs' own file wrapper is not involved.
const PART = 512 * 1024;
const MAX_PARTS = 4000;                                 // Telegram limit: about 2 GB per file
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const randomId = () => bigInt.randBetween(bigInt('-9223372036854775808'), bigInt('9223372036854775807'));

async function sendPart(fn: () => Promise<unknown>) {
  for (let attempt = 0; ; attempt++) {
    try { return await withFlood(fn); } catch (e) {
      const m = String((e as Error)?.message ?? e);
      if (attempt >= 3 || /FILE_PART|FILE_PARTS|AUTH_KEY|BOT_|CHAT_|USER_/.test(m)) throw e;
      await sleep(800 * (attempt + 1));
    }
  }
}

async function uploadBlob(file: File, onProgress?: (p: number) => void): Promise<Api.TypeInputFile> {
  const c = await posterClient();
  const size = file.size;
  if (!size) throw new Error('The selected file is empty. Pick it again.');
  const parts = Math.ceil(size / PART);
  if (parts > MAX_PARTS) throw new Error('This file is larger than 2 GB, which is the Telegram limit for bots.');
  const big = size > 10 * 1024 * 1024;
  const id = randomId();
  const name = file.name || 'file';
  let next = 0, done = 0, failed = false;

  const worker = async () => {
    while (!failed) {
      const i = next++;
      if (i >= parts) return;
      try {
        const bytes = Buffer.from(await file.slice(i * PART, Math.min(size, (i + 1) * PART)).arrayBuffer());
        await sendPart(() => c.invoke(big
          ? new Api.upload.SaveBigFilePart({ fileId: id, filePart: i, fileTotalParts: parts, bytes })
          : new Api.upload.SaveFilePart({ fileId: id, filePart: i, bytes })));
      } catch (e) { failed = true; throw e; }
      done++;
      onProgress?.(done / parts);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, parts) }, worker));
  return big ? new Api.InputFileBig({ id, parts, name }) : new Api.InputFile({ id, parts, name, md5Checksum: '' });
}

function messageIdOf(res: Api.TypeUpdates): number {
  const list = ((res as { updates?: Api.TypeUpdate[] }).updates ?? []);
  for (const u of list) {
    if (u instanceof Api.UpdateNewChannelMessage || u instanceof Api.UpdateNewMessage) {
      const m = u.message as { id?: number };
      if (m.id) return m.id;
    }
  }
  for (const u of list) if (u instanceof Api.UpdateMessageID) return u.id;
  return 0;
}

async function sendMedia(media: Api.TypeInputMedia, caption: string, replyTo?: number): Promise<number> {
  const c = await posterClient();
  const p = await channelPeer();
  const rid = randomId();                               // same id on a retry, so a flood-wait retry can never post twice
  const res = await withFlood(() => c.invoke(new Api.messages.SendMedia({
    peer: p, media, message: caption, randomId: rid,
    replyTo: replyTo ? new Api.InputReplyToMessage({ replyToMsgId: replyTo }) : undefined,
  })));
  const id = messageIdOf(res as Api.TypeUpdates);
  if (!id) throw new Error('The file was uploaded but Telegram did not confirm the post. Check the channel before posting again.');
  return id;
}

/* ---------- posting ---------- */
export async function postText(text: string): Promise<number> {
  const c = await posterClient();
  const p = await channelPeer();
  const m = await c.sendMessage(p, { message: text, linkPreview: false });
  return m.id;
}

export async function postFile(
  file: File,
  caption: string,
  o: { video?: VideoMeta; onProgress?: (p: number) => void } = {},
): Promise<number> {
  const input = await uploadBlob(file, o.onProgress);
  const attributes: Api.TypeDocumentAttribute[] = [new Api.DocumentAttributeFilename({ fileName: file.name || (o.video ? 'video.mp4' : 'book.pdf') })];
  if (o.video) attributes.push(new Api.DocumentAttributeVideo({ duration: o.video.duration, w: o.video.w, h: o.video.h, supportsStreaming: true }));
  let thumb: Api.TypeInputFile | undefined;
  if (o.video?.thumb) { try { thumb = await uploadBlob(o.video.thumb); } catch { /* the video is posted without a preview */ } }
  const media = new Api.InputMediaUploadedDocument({
    file: input,
    thumb,
    mimeType: o.video ? file.type || 'video/mp4' : 'application/pdf',
    attributes,
    forceFile: !o.video,
  });
  return sendMedia(media, caption);
}

/** photo post: course cover (with caption) or book cover (replyTo = the book message id, no caption) */
export async function postPhoto(file: File, o: { caption?: string; replyTo?: number } = {}): Promise<number> {
  const jpg = await toJpeg(file);
  const input = await uploadBlob(jpg);
  return sendMedia(new Api.InputMediaUploadedPhoto({ file: input }), o.caption ?? '', o.replyTo);
}

/* ---------- edit / delete (Admin > Manage) ---------- */
async function withFlood<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; i < 4; i++) {
    try { return await fn(); } catch (e) {
      const m = /FLOOD_WAIT_(\d+)/.exec(String((e as Error)?.message ?? e));
      if (!m) throw e;
      await new Promise((r) => setTimeout(r, (Number(m[1]) + 1) * 1000));
    }
  }
  return fn();
}

function friendly(e: unknown): Error {
  const m = String((e as Error)?.message ?? e);
  if (/CHAT_ADMIN_REQUIRED|MESSAGE_AUTHOR_REQUIRED|CHAT_WRITE_FORBIDDEN|USER_NOT_PARTICIPANT/.test(m)) {
    return new Error('The posting bot needs the "Edit messages of others" and "Delete messages" admin permissions in the channel.');
  }
  return e instanceof Error ? e : new Error(m);
}

/** changes the text of a post, or the caption if the post has a file / photo */
export async function editCaption(id: number, text: string): Promise<void> {
  const c = await posterClient();
  const p = await channelPeer();
  try {
    await withFlood(() => c.editMessage(p, { message: id, text, linkPreview: false }));
  } catch (e) {
    if (/MESSAGE_NOT_MODIFIED/.test(String((e as Error)?.message ?? e))) return;
    throw friendly(e);
  }
}

export async function deleteMessages(ids: number[]): Promise<void> {
  const list = [...new Set(ids.filter((x) => x > 0))];
  if (!list.length) return;
  const c = await posterClient();
  const p = await channelPeer();
  try {
    for (let i = 0; i < list.length; i += 100) {
      await withFlood(() => c.deleteMessages(p, list.slice(i, i + 100), { revoke: true }));
    }
  } catch (e) { throw friendly(e); }
}
