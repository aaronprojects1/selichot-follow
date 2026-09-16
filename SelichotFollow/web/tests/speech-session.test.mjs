import test from 'node:test';
import assert from 'node:assert/strict';
import { SpeechSession } from '../speech-session.mjs';

function setup() {
  const instances = [], tasks = new Map(), states = [], results = [];
  let id = 0, released = 0;
  class Recognition {
    constructor() { instances.push(this); }
    start() { this.started = true; }
    abort() { this.aborted = true; this.onend?.(); }
  }
  const session = new SpeechSession({
    Recognition, onResult: result => results.push(result),
    onState: (...state) => states.push(state),
    releaseMicrophone: () => released++,
    configure: listener => { listener.phrases = ['hint']; },
    timers: {
      setTimeout(fn, ms) { tasks.set(++id, { fn, ms }); return id; },
      clearTimeout(id) { tasks.delete(id); }
    }
  });
  const tick = () => {
    assert.equal(tasks.size, 1);
    const [key, task] = tasks.entries().next().value;
    tasks.delete(key); task.fn();
    return task.ms;
  };
  return { session, instances, states, results, tasks, tick, released: () => released };
}

test('silent start and stalled recognition recover even without an end event', () => {
  const s = setup(); s.session.start();
  assert.equal(s.tick(), 12000);
  assert.equal(s.instances[0].aborted, true);
  s.tick();
  assert.equal(s.instances.length, 2);
  s.tick();
  assert.equal(s.released(), 1);
  s.tick();
  assert.equal(s.instances.length, 3);
});

test('capture conflict releases the competing stream and resumes word results', () => {
  const s = setup(); s.session.start();
  s.instances[0].onerror({ error: 'audio-capture' });
  assert.equal(s.released(), 1);
  s.tick();
  s.instances[1].onresult({ results: ['Hebrew'] });
  assert.equal(s.results.length, 1);
  assert.equal(s.session.failures, 0);
});

test('unsupported hints retry without hints', () => {
  const s = setup(); s.session.start();
  s.instances[0].onerror({ error: 'phrases-not-supported' });
  s.tick();
  assert.equal(s.instances[1].phrases, undefined);
});

test('Stop cancels retries and ignores callbacks from a retired recognizer', () => {
  const s = setup(); s.session.start();
  const lateResult = s.instances[0].onresult;
  const lateEnd = s.instances[0].onend;
  s.session.stop();
  lateResult({}); lateEnd();
  assert.equal(s.tasks.size, 0);
  assert.equal(s.results.length, 0);
});

test('permission and unsupported Hebrew failures stop automatic retries', () => {
  for (const error of ['not-allowed', 'service-not-allowed', 'language-not-supported']) {
    const s = setup(); s.session.start();
    s.instances[0].onerror({ error });
    assert.equal(s.tasks.size, 0);
    assert.deepEqual(s.states.at(-1), ['unavailable', error]);
  }
});

test('network failures back off and never accumulate retry timers', () => {
  const s = setup(); s.session.start();
  for (const delay of [500, 1000, 2000, 4000, 8000, 10000]) {
    s.instances.at(-1).onerror({ error: 'network' });
    assert.equal(s.tick(), delay);
  }
});
