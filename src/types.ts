export type AppType = 'terminal' | 'fileExplorer' | 'textEditor' | 'about' | 'settings' | 'snake';

export interface WindowState {
  id: string;
  title: string;
  appType: AppType;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  minimized: boolean;
  maximized: boolean;
  data?: Record<string, unknown>;
}

export type Phase = 'booting' | 'desktop' | 'shutdown' | 'screensaver';

export interface ErrorState {
  message: string;
  code: string;
  fatal: boolean;
}

export interface DesktopState {
  phase: Phase;
  windows: WindowState[];
  nextZIndex: number;
  activeWindowId: string | null;
  errorState: ErrorState | null;
}

export type DesktopAction =
  | { type: 'BOOT_COMPLETE' }
  | { type: 'OPEN_WINDOW'; appType: AppType; title: string; data?: Record<string, unknown> }
  | { type: 'CLOSE_WINDOW'; id: string }
  | { type: 'FOCUS_WINDOW'; id: string }
  | { type: 'MOVE_WINDOW'; id: string; x: number; y: number }
  | { type: 'RESIZE_WINDOW'; id: string; width: number; height: number }
  | { type: 'MINIMIZE_WINDOW'; id: string }
  | { type: 'MAXIMIZE_WINDOW'; id: string }
  | { type: 'SHUTDOWN' }
  | { type: 'SCREENSAVER_ON' }
  | { type: 'SCREENSAVER_OFF' }
  | { type: 'SHOW_ERROR'; error: ErrorState }
  | { type: 'DISMISS_ERROR' }
  | { type: 'DEACTIVATE_ALL' }
  | { type: 'RESTART' };

export interface FSNode {
  name: string;
  type: 'file' | 'directory';
  content?: string;
  children?: FSNode[];
}

export interface ShellOSSettings {
  crtEnabled: boolean;
  crtIntensity: number;
  terminalColor: 'green' | 'amber' | 'white';
  desktopPattern: 'crosshatch' | 'solid' | 'lines' | 'dots';
  soundEnabled: boolean;
  quickBootEnabled: boolean;
  screensaverTimeout: number;
  screensaverMode: 'starfield' | 'bouncing';
}
