import { SHELL_LOGO_FULL } from '../assets/shellArt';

interface AboutShellOSProps {
  onClose: () => void;
}

export default function AboutShellOS({ onClose }: AboutShellOSProps) {
  return (
    <div className="about-dialog">
      <pre className="about-logo">{SHELL_LOGO_FULL}</pre>
      <div className="about-title">ShellOS v1.0</div>
      <div className="about-info">
        Conch Computing Inc.<br />
        640K RAM • 20MB HDD<br />
        CRT Display 80×25<br />
        Built: {new Date().getFullYear()}<br />
        <br />
        "The shell that never closes."
      </div>
      <button className="about-ok-btn" onClick={onClose}>
        OK
      </button>
    </div>
  );
}
