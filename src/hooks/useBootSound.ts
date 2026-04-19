import { useCallback, useRef } from 'react';
import { useShellOS } from './useShellOS';

let audioContextStarted = false;

async function ensureToneStarted() {
  if (audioContextStarted) return;
  const Tone = await import('tone');
  await Tone.start();
  audioContextStarted = true;
}

export function useBootSound() {
  const { settings } = useShellOS();
  const toneRef = useRef<typeof import('tone') | null>(null);

  const loadTone = useCallback(async () => {
    if (!settings.soundEnabled) return null;
    if (!toneRef.current) {
      toneRef.current = await import('tone');
    }
    await ensureToneStarted();
    return toneRef.current;
  }, [settings.soundEnabled]);

  const playPostBeep = useCallback(async () => {
    const Tone = await loadTone();
    if (!Tone) return;
    const synth = new Tone.Synth({
      oscillator: { type: 'square' },
      envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.05 },
    }).toDestination();
    synth.triggerAttackRelease('G5', '0.1');
    setTimeout(() => synth.dispose(), 300);
  }, [loadTone]);

  const playMemoryTick = useCallback(async () => {
    const Tone = await loadTone();
    if (!Tone) return;
    const synth = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.01, sustain: 0, release: 0.01 },
    }).toDestination();
    synth.volume.value = -20;
    synth.triggerAttackRelease('0.01');
    setTimeout(() => synth.dispose(), 200);
  }, [loadTone]);

  const playDriveSeek = useCallback(async () => {
    const Tone = await loadTone();
    if (!Tone) return;
    const synth = new Tone.NoiseSynth({
      noise: { type: 'brown' },
      envelope: { attack: 0.01, decay: 0.15, sustain: 0, release: 0.05 },
    }).toDestination();
    synth.volume.value = -12;
    synth.triggerAttackRelease('0.2');
    setTimeout(() => synth.dispose(), 500);
  }, [loadTone]);

  const playBootChime = useCallback(async () => {
    const Tone = await loadTone();
    if (!Tone) return;
    const synth = new Tone.Synth({
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.01, decay: 0.3, sustain: 0.2, release: 0.5 },
    }).toDestination();
    synth.triggerAttackRelease('C5', '0.2');
    setTimeout(() => {
      const synth2 = new Tone.Synth({
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.01, decay: 0.3, sustain: 0.2, release: 0.8 },
      }).toDestination();
      synth2.triggerAttackRelease('G5', '0.4');
      setTimeout(() => synth2.dispose(), 1500);
    }, 200);
    setTimeout(() => synth.dispose(), 1000);
  }, [loadTone]);

  return { playPostBeep, playMemoryTick, playDriveSeek, playBootChime };
}
