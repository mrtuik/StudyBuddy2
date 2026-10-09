import { Capacitor, registerPlugin } from '@capacitor/core';

export interface Shot { data: string; width: number; height: number; grid: string; }
interface BuddyScreenPlugin { capture(o: { maxSide: number; quality: number }): Promise<Shot>; }
const BuddyScreen = registerPlugin<BuddyScreenPlugin>('BuddyScreen');

export const screenCaptureAvailable = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('BuddyScreen');

/** small JPEG of this app's own window (Android PixelCopy). null when it cannot be captured (browser, old Android). */
export async function captureScreen(maxSide = 768, quality = 60): Promise<Shot | null> {
  if (!screenCaptureAvailable()) return null;
  try { return await BuddyScreen.capture({ maxSide, quality }); } catch { return null; }
}

/** share of the 24x24 brightness cells that changed noticeably (0..1) */
export function gridDiff(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return 1;
  let n = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(parseInt(a[i], 16) - parseInt(b[i], 16)) > 1) n++;
  return n / a.length;
}
