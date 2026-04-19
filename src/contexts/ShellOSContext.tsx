import { createContext, useState, type ReactNode } from 'react';
import type { ShellOSSettings } from '../types';

const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;

const defaultSettings: ShellOSSettings = {
  crtEnabled: !isMobile,
  crtIntensity: 0.6,
  terminalColor: 'green',
  desktopPattern: 'crosshatch',
  soundEnabled: true,
  quickBootEnabled: true,
  screensaverTimeout: 120000, // 2 minutes
  screensaverMode: 'starfield',
};

interface ShellOSContextValue {
  settings: ShellOSSettings;
  updateSettings: (partial: Partial<ShellOSSettings>) => void;
}

const ShellOSContext = createContext<ShellOSContextValue>({
  settings: defaultSettings,
  updateSettings: () => {},
});

export { ShellOSContext };

const STORAGE_KEY = 'shellos-settings';

function loadSettings(): ShellOSSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return { ...defaultSettings, ...JSON.parse(stored) };
    }
  } catch {
    // Ignore parse errors
  }
  return defaultSettings;
}

function saveSettings(settings: ShellOSSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage errors
  }
}

export function ShellOSProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<ShellOSSettings>(loadSettings);

  const updateSettings = (partial: Partial<ShellOSSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      saveSettings(next);
      return next;
    });
  };

  return (
    <ShellOSContext.Provider value={{ settings, updateSettings }}>
      {children}
    </ShellOSContext.Provider>
  );
}
