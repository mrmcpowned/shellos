import { createContext, useContext, useState, type ReactNode } from 'react';
import type { ShellOSSettings } from '../types';

const defaultSettings: ShellOSSettings = {
  crtEnabled: true,
  crtIntensity: 0.6,
  terminalColor: 'green',
  desktopPattern: 'crosshatch',
  soundEnabled: true,
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

export function ShellOSProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<ShellOSSettings>(defaultSettings);

  const updateSettings = (partial: Partial<ShellOSSettings>) => {
    setSettings((prev) => ({ ...prev, ...partial }));
  };

  return (
    <ShellOSContext.Provider value={{ settings, updateSettings }}>
      {children}
    </ShellOSContext.Provider>
  );
}

export function useShellOS() {
  return useContext(ShellOSContext);
}
