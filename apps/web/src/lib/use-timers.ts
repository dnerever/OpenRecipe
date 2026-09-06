import { useCallback, useEffect, useRef, useState } from 'react';

export type RunningTimer = {
  id: number;
  label: string;
  /** Seconds the timer was started with — the denominator of the progress bar. */
  total: number;
  endsAt: number;
  remaining: number;
};

/**
 * Timers belong to the cooking session, not to the step that started them: you
 * set the oven going and move on to the next thing, which is the entire reason
 * a timer is useful. They live here, above the step list, and keep running as
 * you page through.
 */
export function useTimers() {
  const [timers, setTimers] = useState<RunningTimer[]>([]);
  const rung = useRef<Set<number>>(new Set());
  const nextId = useRef(1);

  useEffect(() => {
    if (timers.length === 0) return;

    const tick = () => {
      const now = Date.now();
      setTimers((current) =>
        current.map((timer) => ({
          ...timer,
          remaining: Math.max(0, Math.round((timer.endsAt - now) / 1000)),
        })),
      );
    };

    const handle = window.setInterval(tick, 500);
    tick();
    return () => window.clearInterval(handle);
  }, [timers.length]);

  useEffect(() => {
    for (const timer of timers) {
      if (timer.remaining === 0 && !rung.current.has(timer.id)) {
        rung.current.add(timer.id);
        alarm();
      }
    }
  }, [timers]);

  const start = useCallback((seconds: number, label: string) => {
    const id = nextId.current++;
    setTimers((current) => [
      ...current,
      { id, label, total: seconds, endsAt: Date.now() + seconds * 1000, remaining: seconds },
    ]);
  }, []);

  const dismiss = useCallback((id: number) => {
    rung.current.delete(id);
    setTimers((current) => current.filter((timer) => timer.id !== id));
  }, []);

  return { timers, start, dismiss };
}

/**
 * Three short beeps and a buzz. Built on the gesture that started the timer, so
 * the audio context is already unlocked by the time it has to make a sound —
 * an alarm that needs a click to be heard is not an alarm.
 */
function alarm(): void {
  navigator.vibrate?.([300, 150, 300]);

  const Context = window.AudioContext;
  if (!Context) return;

  try {
    const context = new Context();
    for (let beep = 0; beep < 3; beep++) {
      const at = context.currentTime + beep * 0.35;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.25, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.25);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.3);
    }
    window.setTimeout(() => void context.close(), 1500);
  } catch {
    // No audio available. The vibration and the red timer still land.
  }
}
