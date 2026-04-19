import { useCallback, useRef } from 'react';
import { useShellOS } from './useShellOS';

export function useUISounds() {
  const { settings } = useShellOS();
  const toneRef = useRef<typeof import('tone') | null>(null);

  const loadTone = useCallback(async () => {
    if (!settings.soundEnabled) return null;
    if (!toneRef.current) {
      toneRef.current = await import('tone');
      await toneRef.current.start();
    }
    return toneRef.current;
  }, [settings.soundEnabled]);

  const playWindowOpen = useCallback(async () => {
    const Tone = await loadTone();
    if (!Tone) return;
    const synth = new Tone.Synth({
      oscillator: { type: 'square' },
      envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.03 },
    }).toDestination();
    synth.volume.value = -18;
    synth.triggerAttackRelease('C6', '0.05');
    setTimeout(() => synth.dispose(), 200);
  }, [loadTone]);

  const playWindowClose = useCallback(async () => {
    const Tone = await loadTone();
    if (!Tone) return;
    const synth = new Tone.Synth({
      oscillator: { type: 'square' },
      envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.03 },
    }).toDestination();
    synth.volume.value = -18;
    synth.triggerAttackRelease('G4', '0.05');
    setTimeout(() => synth.dispose(), 200);
  }, [loadTone]);

  const playMenuClick = useCallback(async () => {
    const Tone = await loadTone();
    if (!Tone) return;
    const synth = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.015, sustain: 0, release: 0.01 },
    }).toDestination();
    synth.volume.value = -22;
    synth.triggerAttackRelease('0.02');
    setTimeout(() => synth.dispose(), 200);
  }, [loadTone]);

  const playErrorBeep = useCallback(async () => {
    const Tone = await loadTone();
    if (!Tone) return;
    const synth = new Tone.Synth({
      oscillator: { type: 'sawtooth' },
      envelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.1 },
    }).toDestination();
    synth.volume.value = -10;
    synth.triggerAttackRelease('A3', '0.15');
    setTimeout(() => synth.dispose(), 500);
  }, [loadTone]);

  const playKeystroke = useCallback(async () => {
    const Tone = await loadTone();
    if (!Tone) return;
    const synth = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.008, sustain: 0, release: 0.005 },
    }).toDestination();
    synth.volume.value = -28;
    synth.triggerAttackRelease('0.01');
    setTimeout(() => synth.dispose(), 150);
  }, [loadTone]);

  return { playWindowOpen, playWindowClose, playMenuClick, playErrorBeep, playKeystroke };
}
