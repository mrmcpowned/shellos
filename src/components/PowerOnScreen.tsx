interface PowerOnScreenProps {
  onPowerOn: () => void;
}

export default function PowerOnScreen({ onPowerOn }: PowerOnScreenProps) {
  const handleClick = async () => {
    // Initialize audio context on user gesture
    try {
      const Tone = await import('tone');
      await Tone.start();
    } catch {
      // Audio init failed — continue without sound
    }
    onPowerOn();
  };

  return (
    <div className="poweron-screen" onClick={handleClick}>
      <div className="poweron-content">
        <div className="poweron-icon">⏻</div>
        <div className="poweron-text">Click to power on</div>
      </div>
    </div>
  );
}
