import { Capacitor, registerPlugin } from '@capacitor/core';

interface BuddyMicPlugin { ask(): Promise<{ granted: boolean }>; openSettings(): Promise<void>; }
const BuddyMic = registerPlugin<BuddyMicPlugin>('BuddyMic');
const native = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('BuddyMic');

/** shows the Android microphone dialog (once Android allows it); true when the mic may be used */
export async function ensureMic(): Promise<boolean> {
  if (!native()) return true;            // browser: getUserMedia asks by itself
  try { return (await BuddyMic.ask()).granted; } catch { return true; }
}

export const openMicSettings = () => (native() ? BuddyMic.openSettings() : Promise.resolve());
