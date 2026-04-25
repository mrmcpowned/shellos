import { useState, useCallback, useRef, useEffect } from 'react';
import { useShellOS } from '../hooks/useShellOS';

// Registry of fake domains → folder names in public/web/sites/
const FAKE_SITES: Record<string, string> = {
  'www.shellsearch.com': 'shellsearch.com',
  'shellsearch.com': 'shellsearch.com',
};

const HOMEPAGE = 'http://www.shellsearch.com/';
const BASE = import.meta.env.BASE_URL; // e.g. '/shellos/'

// Use local Vite proxy in dev, no proxy in prod (will show error page)
const PROXY_PREFIX = `${BASE}proxy/`;

function parseUrl(url: string): { domain: string; path: string; full: string } | null {
  try {
    let full = url.trim();
    if (!full.match(/^https?:\/\//)) full = 'http://' + full;
    const parsed = new URL(full);
    return {
      domain: parsed.hostname,
      path: parsed.pathname + parsed.search,
      full,
    };
  } catch {
    return null;
  }
}

/** Extract <body> inner content and <style>/<link> from an HTML string.
 *  Resolves relative URLs against <base> for Shadow DOM rendering. */
function extractPageContent(html: string): { body: string; styles: string; title: string } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const baseEl = doc.querySelector('base[href]');
  const baseUrl = baseEl?.getAttribute('href') || '';

  // Helper: resolve a URL against base
  const resolve = (url: string | null): string | null => {
    if (!url || !baseUrl) return url;
    if (url.match(/^(https?:|data:|blob:|javascript:|#)/)) return url;
    try { return new URL(url, baseUrl).href; } catch { return url; }
  };

  // Resolve all src/href/srcset/action attributes in the entire document
  if (baseUrl) {
    doc.querySelectorAll('[src]').forEach(el => {
      el.setAttribute('src', resolve(el.getAttribute('src')) || '');
    });
    doc.querySelectorAll('[href]').forEach(el => {
      if (el.tagName === 'BASE') return;
      el.setAttribute('href', resolve(el.getAttribute('href')) || '');
    });
    doc.querySelectorAll('[action]').forEach(el => {
      el.setAttribute('action', resolve(el.getAttribute('action')) || '');
    });
    doc.querySelectorAll('[srcset]').forEach(el => {
      const srcset = el.getAttribute('srcset') || '';
      el.setAttribute('srcset', srcset.replace(/(\S+)(\s+\S+)?/g, (_, url, desc) => {
        return (resolve(url) || url) + (desc || '');
      }));
    });
    // Resolve url() in inline style attributes
    doc.querySelectorAll('[style]').forEach(el => {
      const style = el.getAttribute('style') || '';
      el.setAttribute('style', style.replace(/url\(['"]?([^'")]+)['"]?\)/g, (match, url) => {
        const resolved = resolve(url);
        return resolved ? `url('${resolved}')` : match;
      }));
    });
  }

  // Collect all <link> and <style> from <head>
  const headStyles = Array.from(doc.head?.children || [])
    .filter(el => el.tagName === 'STYLE' || (el.tagName === 'LINK' && el.getAttribute('rel')?.includes('stylesheet')))
    .map(el => el.outerHTML)
    .join('\n');

  const title = doc.querySelector('title')?.textContent || '';

  return { body: doc.body?.innerHTML || html, styles: headStyles, title };
}

interface HistoryEntry {
  url: string;
}

interface BrowserProps {
  onTitleChange?: (title: string) => void;
}

export default function Browser({ onTitleChange }: BrowserProps) {
  const { settings } = useShellOS();
  const [urlBar, setUrlBar] = useState(HOMEPAGE);
  const [currentUrl, setCurrentUrl] = useState(HOMEPAGE);
  const [loading, setLoading] = useState(false);
  const [content, setContent] = useState<string | null>(null); // Shadow DOM content (fake pages + errors)
  const [proxyUrl, setProxyUrl] = useState<string | null>(null); // iframe src for real URLs
  const [pageDomain, setPageDomain] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([{ url: HOMEPAGE }]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [locationFocused, setLocationFocused] = useState(false);
  const [caretPos, setCaretPos] = useState(0);
  const onTitleChangeRef = useRef(onTitleChange);
  useEffect(() => { onTitleChangeRef.current = onTitleChange; }, [onTitleChange]);
  const shadowHostRef = useRef<HTMLDivElement>(null);
  const shadowRootRef = useRef<ShadowRoot | null>(null);
  const locationCaretRef = useRef<HTMLSpanElement>(null);
  const locationInputRef = useRef<HTMLInputElement>(null);

  // JS-driven caret blink for location bar — CSS animations don't survive snapdom
  useEffect(() => {
    const el = locationCaretRef.current;
    if (!el) return;
    if (!locationFocused) { el.style.opacity = '0'; return; }
    let visible = true;
    el.style.opacity = '1';
    const id = setInterval(() => {
      visible = !visible;
      el.style.opacity = visible ? '1' : '0';
    }, 530);
    return () => clearInterval(id);
  }, [locationFocused]);

  // Track caret position in location input
  const updateCaretPos = useCallback(() => {
    if (locationInputRef.current) {
      setCaretPos(locationInputRef.current.selectionStart || 0);
    }
  }, []);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const navigateRef = useRef<(url: string) => void>(() => {});

  // Fetch a fake page from public/web/sites/
  const fetchFakePage = useCallback(async (domain: string, path: string): Promise<string | null> => {
    const folder = FAKE_SITES[domain];
    if (!folder) return null;
    const pagePath = path === '/' ? '/index.html' : path;
    // Strip query string for fetch path
    const fetchPath = pagePath.split('?')[0];
    const fetchUrl = `${BASE}web/sites/${folder}${fetchPath}`;
    try {
      const res = await fetch(fetchUrl);
      if (!res.ok) return null;
      return await res.text();
    } catch {
      return null;
    }
  }, []);

  // Fetch the error page
  const fetchErrorPage = useCallback(async (failedUrl: string): Promise<string> => {
    try {
      const res = await fetch(`${BASE}web/error.html`);
      if (res.ok) {
        let html = await res.text();
        html = html.replace(/\{\{URL\}\}/g, failedUrl);
        return html;
      }
    } catch { /* fall through */ }
    return `<html><body style="font-family:sans-serif;padding:20px;">
      <h2>Page Cannot Be Displayed</h2>
      <p>The page at <b>${failedUrl}</b> could not be loaded.</p>
    </body></html>`;
  }, []);

  // Check if a real URL is reachable via proxy
  const checkRealPage = useCallback(async (url: string): Promise<boolean> => {
    try {
      const res = await fetch(PROXY_PREFIX + encodeURIComponent(url), {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  // Navigate to a URL
  const navigate = useCallback(async (url: string, pushHistory = true) => {
    const parsed = parseUrl(url);
    if (!parsed) return;

    setCurrentUrl(parsed.full);
    setUrlBar(parsed.full);
    setLoading(true);
    setContent(null);
    setProxyUrl(null);
    setPageDomain(parsed.domain);

    // Try fake site first (renders in Shadow DOM — works with CRT)
    const fakeHtml = await fetchFakePage(parsed.domain, parsed.path);
    if (fakeHtml) {
      setContent(fakeHtml);
      setLoading(false);
    } else {
      // Try real URL via proxy iframe (proper rendering with viewport etc.)
      const reachable = await checkRealPage(parsed.full);
      if (reachable) {
        setProxyUrl(PROXY_PREFIX + encodeURIComponent(parsed.full));
      } else {
        // Show error page in Shadow DOM
        const errorHtml = await fetchErrorPage(parsed.full);
        setContent(errorHtml);
        setPageDomain('');
      }
      setLoading(false);
    }

    if (pushHistory) {
      setHistory(prev => {
        const newHistory = prev.slice(0, historyIndex + 1);
        newHistory.push({ url: parsed.full });
        return newHistory;
      });
      setHistoryIndex(prev => prev + 1);
    }
  }, [fetchFakePage, checkRealPage, fetchErrorPage, historyIndex]);

  // Keep navigateRef current for shadow DOM event handlers
  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  // Listen for navigation messages from iframes and shadow DOM pages
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'shellos-navigate' && typeof e.data.url === 'string') {
        navigateRef.current(e.data.url);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // Read title from iframe when it loads
  const handleIframeLoad = useCallback(() => {
    setLoading(false);
    if (!iframeRef.current) return;
    try {
      const title = iframeRef.current.contentDocument?.title;
      if (title) onTitleChangeRef.current?.('ShellOS Browser - ' + title);
    } catch { /* cross-origin */ }
  }, []);

  // Render page content into Shadow DOM for style isolation + CRT visibility
  useEffect(() => {
    if (!shadowHostRef.current) return;
    if (!content) {
      if (shadowRootRef.current) {
        shadowRootRef.current.innerHTML = '';
      }
      return;
    }

    if (!shadowRootRef.current) {
      shadowRootRef.current = shadowHostRef.current.attachShadow({ mode: 'open' });
    }
    const shadow = shadowRootRef.current;

    const { body, styles, title } = extractPageContent(content);
    // When CRT is on, hide native cursor inside shadow DOM
    const cursorStyle = settings.crtEnabled
      ? '<style>*, *::before, *::after { cursor: none !important; }</style>'
      : '';
    shadow.innerHTML = cursorStyle + styles + body;
    if (title && onTitleChangeRef.current) onTitleChangeRef.current('ShellOS Browser - ' + title);

    // Signal to Window.tsx that shadow content changed (MutationObserver can't see into shadow DOM)
    shadowHostRef.current.dataset.contentVersion = String(Date.now());

    // Intercept link clicks — use composedPath to get real target in shadow DOM
    const clickHandler = (e: Event) => {
      const path = e.composedPath();
      let anchor: HTMLAnchorElement | null = null;
      for (const el of path) {
        if (el instanceof HTMLAnchorElement && el.hasAttribute('href')) {
          anchor = el;
          break;
        }
      }
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
      e.preventDefault();
      let resolved = href;
      if (!href.match(/^https?:\/\//) && pageDomain) {
        const origin = `http://${pageDomain}`;
        resolved = href.startsWith('/') ? origin + href : origin + '/' + href;
      }
      navigateRef.current(resolved);
    };

    // Intercept form submissions
    const submitHandler = (e: Event) => {
      e.preventDefault();
      const path = e.composedPath();
      let form: HTMLFormElement | null = null;
      for (const el of path) {
        if (el instanceof HTMLFormElement) { form = el; break; }
      }
      if (!form) return;
      const action = form.getAttribute('action') || '/';
      const data = new FormData(form);
      const params = new URLSearchParams(data as unknown as Record<string, string>).toString();
      const origin = pageDomain ? `http://${pageDomain}` : '';
      const url = origin + action + (params ? '?' + params : '');
      navigateRef.current(url);
    };

    shadow.addEventListener('click', clickHandler);
    shadow.addEventListener('submit', submitHandler);

    return () => {
      shadow.removeEventListener('click', clickHandler);
      shadow.removeEventListener('submit', submitHandler);
    };
  }, [content, pageDomain, settings.crtEnabled]);

  // Load homepage on mount
  const initialLoadRef = useRef(false);
  useEffect(() => {
    if (initialLoadRef.current) return;
    initialLoadRef.current = true;
    // Defer to avoid synchronous setState in effect
    queueMicrotask(() => navigate(HOMEPAGE, false));
  }, [navigate]);

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < history.length - 1;

  const goBack = useCallback(() => {
    if (!canGoBack) return;
    const newIndex = historyIndex - 1;
    setHistoryIndex(newIndex);
    navigate(history[newIndex].url, false);
  }, [canGoBack, historyIndex, history, navigate]);

  const goForward = useCallback(() => {
    if (!canGoForward) return;
    const newIndex = historyIndex + 1;
    setHistoryIndex(newIndex);
    navigate(history[newIndex].url, false);
  }, [canGoForward, historyIndex, history, navigate]);

  const refresh = useCallback(() => {
    navigate(currentUrl, false);
  }, [currentUrl, navigate]);

  const goHome = useCallback(() => {
    navigate(HOMEPAGE);
  }, [navigate]);

  const handleUrlSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    navigate(urlBar);
  }, [urlBar, navigate]);

  return (
    <div className="browser">
      {/* Toolbar */}
      <div className="browser-toolbar">
        <div className="browser-nav-buttons">
          <button
            className="browser-btn"
            disabled={!canGoBack}
            onClick={goBack}
            title="Back"
          >
            ◀
          </button>
          <button
            className="browser-btn"
            disabled={!canGoForward}
            onClick={goForward}
            title="Forward"
          >
            ▶
          </button>
          <button className="browser-btn" onClick={refresh} title="Reload">
            ⟳
          </button>
          <button className="browser-btn" onClick={goHome} title="Home">
            🏠
          </button>
        </div>
        <div className={`browser-throbber ${loading ? 'active' : ''}`}>
          🐚
        </div>
      </div>

      {/* Location bar */}
      <form className="browser-location-bar" onSubmit={handleUrlSubmit}>
        <label className="browser-location-label">Location:</label>
        <div className="browser-location-wrapper">
          <input
            ref={locationInputRef}
            className="browser-location-input"
            type="text"
            value={urlBar}
            onChange={e => { setUrlBar(e.target.value); updateCaretPos(); }}
            onFocus={() => { setLocationFocused(true); updateCaretPos(); }}
            onBlur={() => setLocationFocused(false)}
            onKeyUp={updateCaretPos}
            onClick={updateCaretPos}
            spellCheck={false}
          />
          {settings.crtEnabled && locationFocused && (
            <span
              ref={locationCaretRef}
              className="browser-location-caret"
              style={{ left: `${4 + caretPos * 7.2}px` }}
            />
          )}
        </div>
      </form>

      {/* Loading bar */}
      {loading && <div className="browser-loading-bar"><div className="browser-loading-progress" /></div>}

      {/* Content area */}
      <div className="browser-content">
        {/* Shadow DOM host for fake pages + error pages — visible to snapdom/CRT */}
        <div
          ref={shadowHostRef}
          className="browser-shadow-host"
          style={{ display: content ? 'block' : 'none' }}
        />
        {/* iframe for real URLs via proxy — proper rendering (not visible in CRT mode) */}
        {proxyUrl && !settings.crtEnabled && (
          <iframe
            ref={iframeRef}
            className="browser-iframe"
            src={proxyUrl}
            title="Browser content"
            onLoad={handleIframeLoad}
          />
        )}
        {proxyUrl && settings.crtEnabled && (
          <div className="browser-crt-notice">
            <p>⚠️ External pages cannot be displayed in CRT mode.</p>
            <p>Disable CRT effects in Settings to browse this page, or press Home to return.</p>
          </div>
        )}
        {!content && !proxyUrl && !loading ? (
          <div className="browser-blank">
            <div className="browser-blank-text">🐚</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
