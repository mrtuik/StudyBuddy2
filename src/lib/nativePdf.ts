import { Capacitor, registerPlugin } from '@capacitor/core';

export interface NativePdfPlugin {
  open(o: { uri: string }): Promise<{ pages: number; ratio?: number }>;
  renderPage(o: { page: number; width: number }): Promise<{ uri: string; width: number; height: number }>;
  close(): Promise<void>;
}

export const NativePdf = registerPlugin<NativePdfPlugin>('NativePdf');

/** True only inside the Android app build that contains the native plugin. */
export const nativePdfAvailable = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('NativePdf');
