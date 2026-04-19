import { useReducer, useCallback } from 'react';
import type { DesktopState, DesktopAction, AppType, ErrorState } from '../types';

let windowIdCounter = 0;

const DEFAULT_SIZES: Record<AppType, { width: number; height: number }> = {
  terminal: { width: 600, height: 400 },
  fileExplorer: { width: 500, height: 380 },
  textEditor: { width: 520, height: 400 },
  about: { width: 340, height: 300 },
  settings: { width: 380, height: 420 },
  snake: { width: 420, height: 460 },
};

const SINGLETONS: AppType[] = ['about', 'settings'];

const initialState: DesktopState = {
  phase: 'booting',
  windows: [],
  nextZIndex: 10,
  activeWindowId: null,
  errorState: null,
};

function reducer(state: DesktopState, action: DesktopAction): DesktopState {
  switch (action.type) {
    case 'BOOT_COMPLETE':
      return { ...state, phase: 'desktop' };

    case 'OPEN_WINDOW': {
      // Singleton check
      if (SINGLETONS.includes(action.appType)) {
        const existing = state.windows.find((w) => w.appType === action.appType);
        if (existing) {
          return {
            ...state,
            activeWindowId: existing.id,
            windows: state.windows.map((w) =>
              w.id === existing.id ? { ...w, zIndex: state.nextZIndex, minimized: false } : w
            ),
            nextZIndex: state.nextZIndex + 1,
          };
        }
      }

      const id = `win-${++windowIdCounter}`;
      const size = DEFAULT_SIZES[action.appType];
      const offset = (state.windows.length % 8) * 20;

      return {
        ...state,
        windows: [
          ...state.windows,
          {
            id,
            title: action.title,
            appType: action.appType,
            x: 80 + offset,
            y: 40 + offset,
            width: size.width,
            height: size.height,
            zIndex: state.nextZIndex,
            minimized: false,
            maximized: false,
            data: action.data,
          },
        ],
        nextZIndex: state.nextZIndex + 1,
        activeWindowId: id,
      };
    }

    case 'CLOSE_WINDOW':
      return {
        ...state,
        windows: state.windows.filter((w) => w.id !== action.id),
        activeWindowId:
          state.activeWindowId === action.id
            ? state.windows.filter((w) => w.id !== action.id).at(-1)?.id ?? null
            : state.activeWindowId,
      };

    case 'FOCUS_WINDOW':
      return {
        ...state,
        activeWindowId: action.id,
        windows: state.windows.map((w) =>
          w.id === action.id ? { ...w, zIndex: state.nextZIndex } : w
        ),
        nextZIndex: state.nextZIndex + 1,
      };

    case 'MOVE_WINDOW':
      return {
        ...state,
        windows: state.windows.map((w) =>
          w.id === action.id ? { ...w, x: action.x, y: action.y } : w
        ),
      };

    case 'RESIZE_WINDOW':
      return {
        ...state,
        windows: state.windows.map((w) =>
          w.id === action.id ? { ...w, width: action.width, height: action.height } : w
        ),
      };

    case 'MINIMIZE_WINDOW':
      return {
        ...state,
        windows: state.windows.map((w) =>
          w.id === action.id ? { ...w, minimized: !w.minimized } : w
        ),
      };

    case 'MAXIMIZE_WINDOW':
      return {
        ...state,
        windows: state.windows.map((w) =>
          w.id === action.id ? { ...w, maximized: !w.maximized } : w
        ),
      };

    case 'SHUTDOWN':
      return { ...state, phase: 'shutdown' };

    case 'SCREENSAVER_ON':
      return state.phase === 'desktop' ? { ...state, phase: 'screensaver' } : state;

    case 'SCREENSAVER_OFF':
      return state.phase === 'screensaver' ? { ...state, phase: 'desktop' } : state;

    case 'SHOW_ERROR':
      return { ...state, errorState: action.error };

    case 'DISMISS_ERROR':
      return { ...state, errorState: null };

    case 'DEACTIVATE_ALL':
      return { ...state, activeWindowId: null };

    case 'RESTART':
      return { ...initialState, phase: 'booting' };

    default:
      return state;
  }
}

export function useWindowManager() {
  const [state, dispatch] = useReducer(reducer, initialState);

  const openWindow = useCallback(
    (appType: AppType, title: string, data?: Record<string, unknown>) =>
      dispatch({ type: 'OPEN_WINDOW', appType, title, data }),
    []
  );
  const closeWindow = useCallback((id: string) => dispatch({ type: 'CLOSE_WINDOW', id }), []);
  const focusWindow = useCallback((id: string) => dispatch({ type: 'FOCUS_WINDOW', id }), []);
  const moveWindow = useCallback(
    (id: string, x: number, y: number) => dispatch({ type: 'MOVE_WINDOW', id, x, y }),
    []
  );
  const resizeWindow = useCallback(
    (id: string, width: number, height: number) =>
      dispatch({ type: 'RESIZE_WINDOW', id, width, height }),
    []
  );
  const minimizeWindow = useCallback((id: string) => dispatch({ type: 'MINIMIZE_WINDOW', id }), []);
  const maximizeWindow = useCallback((id: string) => dispatch({ type: 'MAXIMIZE_WINDOW', id }), []);
  const bootComplete = useCallback(() => dispatch({ type: 'BOOT_COMPLETE' }), []);
  const shutdown = useCallback(() => dispatch({ type: 'SHUTDOWN' }), []);
  const screensaverOn = useCallback(() => dispatch({ type: 'SCREENSAVER_ON' }), []);
  const screensaverOff = useCallback(() => dispatch({ type: 'SCREENSAVER_OFF' }), []);
  const showError = useCallback(
    (error: ErrorState) => dispatch({ type: 'SHOW_ERROR', error }),
    []
  );
  const dismissError = useCallback(() => dispatch({ type: 'DISMISS_ERROR' }), []);
  const deactivateAll = useCallback(() => dispatch({ type: 'DEACTIVATE_ALL' }), []);
  const restart = useCallback(() => dispatch({ type: 'RESTART' }), []);

  return {
    state,
    openWindow,
    closeWindow,
    focusWindow,
    moveWindow,
    resizeWindow,
    minimizeWindow,
    maximizeWindow,
    bootComplete,
    shutdown,
    screensaverOn,
    screensaverOff,
    showError,
    dismissError,
    deactivateAll,
    restart,
  };
}
