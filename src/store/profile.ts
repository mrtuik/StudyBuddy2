import { create } from 'zustand';
import { CONTACT_URL } from '../lib/format';

export interface Profile {
  name: string;
  handle: string;
  tagline: string;
  bio: string;
  link: string;
  avatarMsgId?: number;
}

export const DEFAULT_PROFILE: Profile = {
  name: 'Mr. Tuik',
  handle: 'mrtuik',
  tagline: 'BUILDING SIMPLE STUDY APPS',
  bio: 'Independent developer building simple, fast and offline-friendly apps for students.',
  link: CONTACT_URL,
};

const KEY = 'sb_profile_v1';
const load = (): Profile => {
  try { return { ...DEFAULT_PROFILE, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return DEFAULT_PROFILE; }
};

interface ProfileState {
  profile: Profile;
  /** Merge new values (used later when the profile is read from a Telegram post). */
  setProfile: (p: Partial<Profile>) => void;
}

export const useProfile = create<ProfileState>((set, get) => ({
  profile: load(),
  setProfile: (p) => {
    const profile = { ...get().profile, ...p };
    set({ profile });
    try { localStorage.setItem(KEY, JSON.stringify(profile)); } catch { /* ignore */ }
  },
}));
