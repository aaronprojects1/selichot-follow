// Own the recognizer lifecycle independently of microphone level measurement.
export class SpeechSession {
  constructor({ Recognition, onResult, onState, releaseMicrophone, configure = () => {}, timers = globalThis }) {
    Object.assign(this, { Recognition, onResult, onState, releaseMicrophone, configure, timers });
    this.running = false;
    this.listener = null;
    this.timer = null;
    this.failures = 0;
    this.exclusive = false;
    this.hints = true;
  }

  start() {
    this.stop();
    this.running = true;
    this.failures = 0;
    this.exclusive = false;
    this.open();
  }

  clear() {
    this.timers.clearTimeout(this.timer);
    this.timer = null;
  }

  detach() {
    const old = this.listener;
    this.listener = null;
    if (!old) return;
    old.onstart = old.onresult = old.onerror = old.onend = old.onspeechstart = null;
    try { old.abort(); } catch { /* already ended */ }
  }

  stop() {
    this.running = false;
    this.clear();
    this.detach();
  }

  arm() {
    this.clear();
    this.timer = this.timers.setTimeout(() => this.retry('stalled'), 12000);
  }

  retry(reason) {
    if (!this.running) return;
    this.clear();
    this.detach();
    if (reason !== 'ended') this.failures += 1;
    // Some mobile devices cannot give Web Audio and Web Speech the mic together.
    if (!this.exclusive && (reason === 'audio-capture' || (reason === 'stalled' && this.failures >= 2))) {
      this.exclusive = true;
      this.releaseMicrophone();
    }
    if (reason !== 'ended') this.onState('retry', reason);
    const delay = reason === 'ended' ? 200 : Math.min(10000, 500 * 2 ** Math.min(this.failures - 1, 5));
    this.timer = this.timers.setTimeout(() => this.open(), delay);
  }

  open() {
    if (!this.running) return;
    this.clear();
    this.detach();
    const listener = new this.Recognition();
    this.listener = listener;
    const current = () => this.running && this.listener === listener;
    listener.lang = 'he-IL';
    listener.continuous = false;
    listener.interimResults = true;
    listener.maxAlternatives = 5;
    if (this.hints) this.configure(listener);
    listener.onstart = () => {
      if (!current()) return;
      this.arm();
      this.onState(this.failures ? 'recovering' : 'listening');
    };
    listener.onresult = event => {
      if (!current()) return;
      this.failures = 0;
      this.arm();
      this.onResult(event);
    };
    listener.onerror = event => {
      if (!current()) return;
      if (['not-allowed', 'service-not-allowed', 'language-not-supported'].includes(event.error)) {
        this.stop();
        this.onState('unavailable', event.error);
      } else {
        if (event.error === 'phrases-not-supported') this.hints = false;
        this.retry(event.error);
      }
    };
    listener.onend = () => { if (current()) this.retry('ended'); };
    this.arm(); // Also recover when start() produces no events at all.
    try { listener.start(); } catch (error) {
      if (error.name === 'NotAllowedError') {
        this.stop();
        this.onState('unavailable', 'not-allowed');
      } else this.retry('start-failed');
    }
  }
}
