import { useCallback, useEffect, useState } from 'react';
import './styles/shellos.css';
import { ShellOSProvider } from './contexts/ShellOSContext';
import { useShellOS } from './hooks/useShellOS';
import { useWindowManager } from './hooks/useWindowManager';
import { useIdleTimer } from './hooks/useIdleTimer';
import { useUISounds } from './hooks/useUISounds';
import CRTOverlay from './components/CRTOverlay';
import PowerOnScreen from './components/PowerOnScreen';
import BootSequence from './components/BootSequence';
import MenuBar from './components/MenuBar';
import DesktopIcon from './components/DesktopIcon';
import Window from './components/Window';
import SystemError, { randomErrorChance, makeRandomError } from './components/SystemError';
import ScreenSaver from './components/ScreenSaver';
import ShutdownScreen from './components/ShutdownScreen';
import Terminal from './apps/Terminal';
import FileExplorer from './apps/FileExplorer';
import TextEditor from './apps/TextEditor';
import AboutShellOS from './apps/AboutShellOS';
import Settings from './apps/Settings';
import Snake from './apps/Snake';
import Browser from './apps/Browser';
import type { AppType } from './types';

const ICON_CONFIG: { appType: AppType; icon: string; label: string; title: string }[] = [
  { appType: 'terminal', icon: '🖥️', label: 'Terminal', title: 'Terminal' },
  { appType: 'fileExplorer', icon: '📁', label: 'Files', title: 'File Explorer' },
  { appType: 'textEditor', icon: '📝', label: 'Editor', title: 'Text Editor' },
  { appType: 'snake', icon: '🐍', label: 'Snake', title: 'Snake' },
  { appType: 'browser', icon: '🌐', label: 'Browser', title: 'ShellOS Browser' },
];

function ShellOSApp() {
  const { settings } = useShellOS();
  const {
    state, openWindow, closeWindow, focusWindow, moveWindow, resizeWindow, setWindowTitle,
    powerOn, bootComplete, shutdown, cancelShutdown, screensaverOn, screensaverOff, showError, dismissError, deactivateAll, restart,
  } = useWindowManager();
  const { playWindowOpen, playWindowClose } = useUISounds();
  const isIdle = useIdleTimer(settings.screensaverTimeout);

  // Screensaver trigger
  useEffect(() => {
    if (isIdle && state.phase === 'desktop') screensaverOn();
  }, [isIdle, state.phase, screensaverOn]);

  const handleOpenWindow = useCallback(
    (appType: AppType, title: string, data?: Record<string, unknown>) => {
      // Random error chance
      if (randomErrorChance()) {
        showError(makeRandomError());
        return;
      }
      openWindow(appType, title, data);
      playWindowOpen();
    },
    [openWindow, showError, playWindowOpen]
  );

  const handleCloseWindow = useCallback(
    (id: string) => {
      closeWindow(id);
      playWindowClose();
    },
    [closeWindow, playWindowClose]
  );

  const handleOpenFile = useCallback(
    (path: string, content: string) => {
      const name = path.split('/').pop() || 'Untitled';
      handleOpenWindow('textEditor', name, { filePath: path, initialContent: content });
    },
    [handleOpenWindow]
  );

  const handleShutdown = useCallback(() => shutdown(), [shutdown]);
  const handleForceError = useCallback(
    () => showError(makeRandomError()),
    [showError]
  );

  const activeWindow = state.windows.find((w) => w.id === state.activeWindowId);
  const APP_NAMES: Partial<Record<AppType, string>> = {
    terminal: 'Terminal',
    fileExplorer: 'File Explorer',
    textEditor: 'Text Editor',
    snake: 'Snake',
    browser: 'ShellOS Browser',
    about: 'About ShellOS',
    settings: 'Settings',
  };
  const activeAppTitle = activeWindow ? (APP_NAMES[activeWindow.appType] || activeWindow.title) : null;

  // When CRT is enabled, force solid background to avoid moiré from crosshatch + scanlines
  const desktopPattern = settings.crtEnabled
    ? 'solid'
    : settings.desktopPattern === 'crosshatch' ? undefined : settings.desktopPattern;

  const renderAppContent = (win: typeof state.windows[0]) => {
    const isActive = win.id === state.activeWindowId;
    switch (win.appType) {
      case 'terminal':
        return (
          <Terminal
            isActive={isActive}
            onOpenFile={handleOpenFile}
            onShutdown={handleShutdown}
            onCrash={handleForceError}
          />
        );
      case 'fileExplorer':
        return <FileExplorer onOpenFile={handleOpenFile} />;
      case 'textEditor':
        return (
          <TextEditor
            filePath={win.data?.filePath as string | undefined}
            initialContent={win.data?.initialContent as string | undefined}
          />
        );
      case 'about':
        return <AboutShellOS onClose={() => handleCloseWindow(win.id)} />;
      case 'settings':
        return <Settings onTryScreensaver={screensaverOn} />;
      case 'snake':
        return <Snake isActive={isActive} />;
      case 'browser':
        return <Browser onTitleChange={(title) => setWindowTitle(win.id, title)} />;
      default:
        return null;
    }
  };

  // Determine if any open window has animated content (affects CRT capture rate)
  const hasAnimatedContent = state.windows.some(
    (w) => !w.minimized && (w.appType === 'snake' || w.appType === 'terminal')
  );

  // Fade-from-black overlay when transitioning boot→desktop
  const [bootFade, setBootFade] = useState(false);
  useEffect(() => {
    if (state.phase === 'desktop' && bootFade) {
      // After fade animation completes, remove the overlay
      const timer = setTimeout(() => setBootFade(false), 600);
      return () => clearTimeout(timer);
    }
  }, [state.phase, bootFade]);

  // Intercept boot complete to trigger fade
  const handleBootComplete = useCallback(() => {
    setBootFade(true);
    bootComplete();
  }, [bootComplete]);

  return (
    <CRTOverlay phase={state.phase} hasAnimatedContent={hasAnimatedContent}>
      {/* Power On splash */}
      {state.phase === 'poweron' && <PowerOnScreen onPowerOn={powerOn} />}

      {/* Boot Sequence */}
      {state.phase === 'booting' && <BootSequence onComplete={handleBootComplete} />}

      {/* Desktop */}
      {(state.phase === 'desktop' || state.phase === 'screensaver' || state.phase === 'shutdown') && (
        <div className="desktop" data-pattern={desktopPattern}>
          <MenuBar
            activeAppName={activeAppTitle}
            onAbout={() => handleOpenWindow('about', 'About ShellOS')}
            onSettings={() => handleOpenWindow('settings', 'Settings')}
            onShutdown={handleShutdown}
            onForceError={handleForceError}
          />
          <div className="desktop-area" data-crt={settings.crtEnabled || undefined} onClick={(e) => {
            // Click on empty desktop area deactivates all windows
            if (e.target === e.currentTarget) deactivateAll();
          }}>
            <div className="desktop-icons">
              {ICON_CONFIG.map((cfg) => (
                <DesktopIcon
                  key={cfg.appType}
                  icon={cfg.icon}
                  label={cfg.label}
                  onOpen={() => handleOpenWindow(cfg.appType, cfg.title)}
                />
              ))}
            </div>
            {state.windows
              .filter((w) => !w.minimized)
              .map((win) => (
                <Window
                  key={win.id}
                  windowState={win}
                  isActive={win.id === state.activeWindowId}
                  onClose={() => handleCloseWindow(win.id)}
                  onFocus={() => focusWindow(win.id)}
                  onMove={(x, y) => moveWindow(win.id, x, y)}
                  onResize={(w, h) => resizeWindow(win.id, w, h)}
                >
                  {renderAppContent(win)}
                </Window>
              ))}
          </div>

          {/* System Error Modal */}
          {state.errorState && (
            <SystemError
              error={state.errorState}
              onRestart={restart}
              onContinue={dismissError}
            />
          )}

          {/* Shutdown Modal (rendered over desktop like crash dialog) */}
          {state.phase === 'shutdown' && <ShutdownScreen onRestart={restart} onCancel={cancelShutdown} />}
        </div>
      )}

      {/* Screen Saver */}
      {state.phase === 'screensaver' && <ScreenSaver onDismiss={screensaverOff} />}

      {/* Fade-from-black overlay for boot→desktop transition (non-CRT only) */}
      {bootFade && !settings.crtEnabled && (
        <div className="boot-fade-overlay" />
      )}
    </CRTOverlay>
  );
}

export default function App() {
  return (
    <ShellOSProvider>
      <ShellOSApp />
    </ShellOSProvider>
  );
}
