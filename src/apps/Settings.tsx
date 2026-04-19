import { useShellOS } from '../contexts/ShellOSContext';

export default function Settings() {
  const { settings, updateSettings } = useShellOS();

  return (
    <div className="settings-panel">
      <div className="settings-group">
        <div className="settings-group-title">CRT Display</div>
        <div className="settings-row">
          <span>CRT Effects</span>
          <div
            className={`settings-toggle ${settings.crtEnabled ? 'on' : ''}`}
            onClick={() => updateSettings({ crtEnabled: !settings.crtEnabled })}
            role="switch"
            aria-checked={settings.crtEnabled}
          />
        </div>
        <div className="settings-row">
          <span>Intensity</span>
          <input
            type="range"
            min="0"
            max="100"
            value={settings.crtIntensity * 100}
            onChange={(e) => updateSettings({ crtIntensity: Number(e.target.value) / 100 })}
            style={{ width: '100px' }}
          />
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">Sound</div>
        <div className="settings-row">
          <span>Enable Sound</span>
          <div
            className={`settings-toggle ${settings.soundEnabled ? 'on' : ''}`}
            onClick={() => updateSettings({ soundEnabled: !settings.soundEnabled })}
            role="switch"
            aria-checked={settings.soundEnabled}
          />
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">Terminal Color</div>
        <div className="settings-color-picker">
          {(['green', 'amber', 'white'] as const).map((c) => (
            <div
              key={c}
              className={`settings-color-swatch ${settings.terminalColor === c ? 'active' : ''}`}
              style={{
                backgroundColor:
                  c === 'green' ? '#33ff33' : c === 'amber' ? '#ffb000' : '#e0e0e0',
              }}
              onClick={() => updateSettings({ terminalColor: c })}
              title={c}
            />
          ))}
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">Desktop Pattern</div>
        <div className="settings-color-picker">
          {(['crosshatch', 'solid', 'lines', 'dots'] as const).map((p) => (
            <div
              key={p}
              className={`settings-color-swatch ${settings.desktopPattern === p ? 'active' : ''}`}
              style={{ backgroundColor: '#a8a8a8', fontSize: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              onClick={() => updateSettings({ desktopPattern: p })}
              title={p}
            >
              {p === 'crosshatch' ? '╳' : p === 'solid' ? '■' : p === 'lines' ? '≡' : '⠿'}
            </div>
          ))}
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">Boot</div>
        <div className="settings-row">
          <span>Quick Boot</span>
          <div
            className={`settings-toggle ${settings.quickBootEnabled ? 'on' : ''}`}
            onClick={() => updateSettings({ quickBootEnabled: !settings.quickBootEnabled })}
            role="switch"
            aria-checked={settings.quickBootEnabled}
          />
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">Screen Saver</div>
        <div className="settings-row">
          <span>Timeout</span>
          <select
            value={settings.screensaverTimeout}
            onChange={(e) => updateSettings({ screensaverTimeout: Number(e.target.value) })}
            style={{ fontFamily: 'var(--font-system)', fontSize: '10px' }}
          >
            <option value={60000}>1 min</option>
            <option value={120000}>2 min</option>
            <option value={300000}>5 min</option>
          </select>
        </div>
        <div className="settings-row">
          <span>Mode</span>
          <select
            value={settings.screensaverMode}
            onChange={(e) =>
              updateSettings({ screensaverMode: e.target.value as 'starfield' | 'bouncing' })
            }
            style={{ fontFamily: 'var(--font-system)', fontSize: '10px' }}
          >
            <option value="starfield">Starfield</option>
            <option value="bouncing">Bouncing Logo</option>
          </select>
        </div>
      </div>
    </div>
  );
}
