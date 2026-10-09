import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mrtuik.studybuddy',
  appName: 'StudyBuddy',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    // YouTube lessons are played in an embedded player
    allowNavigation: ['www.youtube.com', '*.youtube.com', 'www.youtube-nocookie.com', '*.youtube-nocookie.com', 'i.ytimg.com'],
  },
};

export default config;
