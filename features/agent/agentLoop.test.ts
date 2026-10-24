import { describe, expect, it } from 'vitest';
import { AgentRunner, goalOpenTarget, hostsMatch, type AgentBrowser, type Answer, type Decide, type SavedRun } from './agentLoop';
import { AGENT_SYSTEM, PLAN_SYSTEM } from './agentPrompt';
import type { ActResult, AgentAction, ObservedElement, PageObservation } from './types';

type Tab = { tabId: number; title: string; url: string };

function page(url: string, elements: Partial<ObservedElement>[], text = ''): PageObservation {
  return {
    url,
    title: new URL(url).hostname,
    elements: elements.map((element, index) => ({ id: index + 1, kind: 'button', label: `Button ${index + 1}`, inView: true, ...element })),
    hidden: 0,
    text,
    problems: [],
    password: false,
    captcha: false,
    atBottom: true,
    fingerprint: `${url}|${elements.length}`,
  };
}

/** A fake browser: pages by URL, tabs in memory, and every action written to `calls`. */
function fakeBrowser(pages: Record<string, PageObservation>, tabs: Tab[] = [{ tabId: 1, title: 'Shop', url: 'https://shop.test/' }]) {
  let active = tabs[0]!.tabId;
  const calls: string[] = [];
  const allowed: string[] = [];
  const checkpoints: (SavedRun | null)[] = [];
  const tab = (id: number) => tabs.find((item) => item.tabId === id)!;
  const browser: AgentBrowser = {
    activeTab: async () => ({ tabId: active, url: tab(active).url }),
    tabs: async () => tabs.map((item) => ({ ...item })),
    tabUrl: async (id) => tab(id).url,
    observe: async (id) => {
      calls.push(`observe ${tab(id).url}`);
      return pages[tab(id).url] ?? null;
    },
    act: async (id, action: AgentAction): Promise<ActResult> => {
      calls.push(`${action.action} ${action.id ?? ''}`.trim());
      const element = pages[tab(id).url]?.elements.find((item) => item.id === action.id);
      const kind = action.action === 'TYPE' ? 'fill' : action.action === 'CLICK' ? 'click' : null;
      return {
        ok: true,
        message: `${action.action} done`,
        text: action.action === 'READ' ? 'Price: $12' : undefined,
        step: kind ? { id: `${calls.length}`, kind, url: tab(id).url, selector: `#e${action.id}`, fallbacks: [], label: element?.label ?? '', value: action.text } : undefined,
      };
    },
    navigate: async (id, url) => {
      calls.push(`navigate ${url}`);
      tab(id).url = url;
    },
    history: async () => undefined,
    openTab: async (url) => {
      const id = Math.max(...tabs.map((item) => item.tabId)) + 1;
      tabs.push({ tabId: id, title: url, url });
      active = id;
      calls.push(`open ${url}`);
      return id;
    },
    switchTab: async (id) => {
      active = id;
      calls.push(`switch ${id}`);
    },
    closeTab: async (id) => {
      tabs.splice(tabs.findIndex((item) => item.tabId === id), 1);
      if (active === id) active = tabs[0]!.tabId;
      calls.push(`close ${id}`);
    },
    download: async () => true,
    screenshot: async () => 'data:image/jpeg;base64,',
    saveRows: async () => undefined,
    saveRun: async (saved) => {
      checkpoints.push(saved ? structuredClone(saved) : null);
    },
    allowSite: async (host) => {
      allowed.push(host);
    },
    status: async () => undefined,
    stopRequested: async () => false,
    sleep: async () => undefined,
  };
  return { browser, calls, allowed, tabs, checkpoints };
}

/** Scripted model: plans, then answers each step from the list, and accepts finishes unless told otherwise. */
function script(replies: (string | ((prompt: string) => string))[], verdicts: boolean[] = []) {
  const prompts: string[] = [];
  const decide: Decide = async (system, user) => {
    if (system === PLAN_SYSTEM) return '{"plan":["do it"],"done_when":"it is done"}';
    if (system !== AGENT_SYSTEM) return JSON.stringify({ complete: verdicts.shift() ?? true, missing: 'the price' });
    prompts.push(user);
    const next = replies.shift();
    if (next === undefined) return '{"action":"NOTE","text":"still going ' + prompts.length + '","say":"waiting"}';
    return typeof next === 'function' ? next(user) : next;
  };
  return { decide, prompts };
}

/** Answer every question the agent asks with the given answers, in order. */
function answer(runner: AgentRunner, answers: Answer[]) {
  const asked: string[] = [];
  runner.subscribe((state) => {
    if (state.pending && asked.at(-1) !== state.pending.message + asked.length) {
      asked.push(state.pending.message + asked.length);
      const next = answers.shift() ?? 'no';
      queueMicrotask(() => runner.respond(next));
    }
  });
  return asked;
}

const form = page('https://shop.test/', [
  { kind: 'input', label: 'Name', formFields: 1 },
  { kind: 'button', label: 'Continue', submit: true, formFields: 1 },
]);

describe('goalOpenTarget', () => {
  it('detects open-only goals and ignores goals with more work', () => {
    expect(goalOpenTarget('can you go to youtube.com')).toBe('youtube.com');
    expect(goalOpenTarget('Open https://www.gmail.com/')).toBe('gmail.com');
    expect(goalOpenTarget('go to youtube.com and search for cats')).toBeNull();
    expect(goalOpenTarget('Find Jordan Lee')).toBeNull();
  });

  it('matches page hosts to the open target', () => {
    expect(hostsMatch('www.youtube.com', 'youtube.com')).toBe(true);
    expect(hostsMatch('m.youtube.com', 'youtube.com')).toBe(true);
    expect(hostsMatch('notyoutube.com', 'youtube.com')).toBe(false);
  });
});

describe('AgentRunner', () => {
  it('opens an open-only goal directly without asking the model', async () => {
    const yt = page('https://youtube.com/', [{ label: 'Home' }]);
    const { browser, calls } = fakeBrowser({ 'https://shop.test/': form, 'https://youtube.com/': yt });
    let modelSteps = 0;
    const decide: Decide = async (system) => {
      if (system === PLAN_SYSTEM || system === AGENT_SYSTEM) modelSteps += 1;
      return '{"plan":["nope"],"done_when":"no"}';
    };
    const state = await new AgentRunner(browser, decide).run('can you go to youtube.com');
    expect(state.phase).toBe('done');
    expect(state.result).toMatch(/youtube\.com/i);
    expect(calls).toContain('navigate https://youtube.com/');
    expect(modelSteps).toBe(0);
    expect(state.plan).toEqual(['Open youtube.com']);
  });

  it('treats already being on that site as done for open-only goals', async () => {
    const yt = page('https://www.youtube.com/', [{ label: 'Home' }]);
    const { browser, calls } = fakeBrowser({ 'https://www.youtube.com/': yt }, [
      { tabId: 1, title: 'YouTube', url: 'https://www.youtube.com/' },
    ]);
    const state = await new AgentRunner(browser, script([]).decide).run('go to youtube.com');
    expect(state.phase).toBe('done');
    expect(calls.some((call) => call.startsWith('navigate'))).toBe(false);
  });

  it('runs a task to a verified finish and records replayable steps', async () => {
    const { browser, calls } = fakeBrowser({ 'https://shop.test/': form });
    const { decide, prompts } = script([
      '{"say":"Type the name","action":"TYPE","id":1,"text":"Ada"}',
      '{"say":"Continue","action":"CLICK","id":2}',
      '{"say":"All done","action":"FINISH","text":"Submitted for Ada","success":true}',
    ]);
    const runner = new AgentRunner(browser, decide);
    const state = await runner.run('Fill in Ada and continue');
    expect(state.phase).toBe('done');
    expect(state.result).toBe('Submitted for Ada');
    expect(calls.filter((call) => !call.startsWith('observe'))).toEqual(['TYPE 1', 'CLICK 2']);
    expect(state.steps.map((step) => step.kind)).toEqual(['navigate', 'fill', 'click']);
    expect(prompts[0]).toContain('[1] input "Name"');
    expect(prompts[1]).toContain('TYPE "Ada" into [1] "Name" -> TYPE done');
  });

  it('asks before a consequential click and respects a decline', async () => {
    const shop = page('https://shop.test/', [{ label: 'Place order' }]);
    const { browser, calls } = fakeBrowser({ 'https://shop.test/': shop });
    const { decide, prompts } = script([
      '{"action":"CLICK","id":1,"say":"Buy it"}',
      '{"action":"FINISH","text":"The person did not want to order.","success":false}',
    ]);
    const runner = new AgentRunner(browser, decide);
    const asked = answer(runner, ['no']);
    const state = await runner.run('Buy the item');
    expect(asked[0]).toMatch(/Place order/);
    expect(calls).not.toContain('CLICK 1');
    expect(prompts[1]).toMatch(/did not approve/);
    expect(state.phase).toBe('failed');
    expect(state.result).toBe('The person did not want to order.');
  });

  it('runs the consequential action once approved', async () => {
    const shop = page('https://shop.test/', [{ label: 'Place order' }]);
    const { browser, calls } = fakeBrowser({ 'https://shop.test/': shop });
    const { decide } = script(['{"action":"CLICK","id":1}', '{"action":"FINISH","text":"Ordered"}']);
    const runner = new AgentRunner(browser, decide);
    answer(runner, ['yes']);
    expect((await runner.run('Buy the item')).phase).toBe('done');
    expect(calls).toContain('CLICK 1');
  });

  it('stops midway when asked and does nothing more', async () => {
    const { browser, calls } = fakeBrowser({ 'https://shop.test/': form });
    let runner: AgentRunner;
    const { decide } = script([
      '{"action":"TYPE","id":1,"text":"Ada"}',
      () => {
        runner.stop();
        return '{"action":"CLICK","id":2}';
      },
    ]);
    runner = new AgentRunner(browser, decide);
    const state = await runner.run('Fill the form');
    expect(state.phase).toBe('stopped');
    expect(calls).toContain('TYPE 1');
    expect(calls).not.toContain('CLICK 2');
  });

  it('refuses to repeat an action that made no progress, then gives up with a reason', async () => {
    const { browser, calls } = fakeBrowser({ 'https://shop.test/': form });
    const { decide, prompts } = script(Array(8).fill('{"action":"CLICK","id":2}'));
    const state = await new AgentRunner(browser, decide).run('Keep clicking');
    expect(calls.filter((call) => call === 'CLICK 2')).toHaveLength(1);
    expect(prompts[2]).toMatch(/did not visibly change|already did exactly this/);
    expect(state.phase).toBe('failed');
    expect(state.error).toMatch(/repeating/);
  });

  it('recovers from an invented element id', async () => {
    const { browser } = fakeBrowser({ 'https://shop.test/': form });
    const { decide, prompts } = script(['{"action":"CLICK","id":42}', '{"action":"CLICK","id":2}', '{"action":"FINISH","text":"ok"}']);
    const state = await new AgentRunner(browser, decide).run('Continue');
    expect(prompts[1]).toMatch(/no element \[42\]/);
    expect(state.log[0]).toMatchObject({ ok: false });
    expect(state.phase).toBe('done');
  });

  it('does not accept a finish the verifier rejects', async () => {
    const { browser } = fakeBrowser({ 'https://shop.test/': form });
    const { decide, prompts } = script(
      ['{"action":"FINISH","text":"done?"}', '{"action":"READ","text":"price"}', '{"action":"FINISH","text":"It costs $12"}'],
      [false, true],
    );
    const state = await new AgentRunner(browser, decide).run('Find the price');
    expect(prompts[1]).toMatch(/Not finished yet: the price/);
    expect(state.notes.join(' ')).toMatch(/\$12/);
    expect(state.result).toBe('It costs $12');
  });

  it('reports a task that cannot be done, and stops at the step limit', async () => {
    const { browser } = fakeBrowser({ 'https://shop.test/': form });
    const impossible = await new AgentRunner(browser, script(['{"action":"FINISH","text":"This site has no flights.","success":false}']).decide).run('Book a flight');
    expect(impossible).toMatchObject({ phase: 'failed', result: 'This site has no flights.' });
    const endless = await new AgentRunner(browser, script([]).decide).run('Go on forever', { maxSteps: 3 });
    expect(endless.error).toMatch(/limit of 3 steps/);
  });

  it('pauses between steps and resumes', async () => {
    const { browser, calls } = fakeBrowser({ 'https://shop.test/': form });
    let runner: AgentRunner;
    const { decide } = script([
      () => {
        runner.pause();
        return '{"action":"TYPE","id":1,"text":"Ada"}';
      },
      '{"action":"FINISH","text":"ok"}',
    ]);
    runner = new AgentRunner(browser, decide);
    const done = runner.run('Fill');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(runner.state.phase).toBe('paused');
    expect(calls).toContain('TYPE 1');
    const actions = calls.length;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls.length).toBe(actions);
    runner.resume();
    expect((await done).phase).toBe('done');
  });
});

describe('AgentRunner checkpoints', () => {
  it('checkpoints every step, forgets the checkpoint when a task ends, and resumes an interrupted one', async () => {
    const { browser, checkpoints, calls } = fakeBrowser({ 'https://shop.test/': form });
    const first = script(['{"action":"NOTE","text":"name is Ada"}', '{"action":"TYPE","id":1,"text":"Ada"}', '{"action":"FINISH","text":"x"}']);
    await new AgentRunner(browser, first.decide).run('Fill in Ada and continue');
    expect(checkpoints.at(-1)).toBeNull();
    // Pretend the panel closed just before step 3: continue from that checkpoint in a new runner.
    const saved = checkpoints.find((item) => item?.step === 3)!;
    expect(saved.memory.notes).toEqual(['name is Ada']);
    expect(saved.memory.steps.map((step) => step.kind)).toEqual(['navigate', 'fill']);
    const second = script(['{"action":"CLICK","id":2}', '{"action":"FINISH","text":"Continued and finished"}']);
    const state = await new AgentRunner(browser, second.decide).continueSaved(saved);
    expect(second.prompts[0]).toMatch(/closed and reopened/);
    expect(second.prompts[0]).toMatch(/name is Ada/);
    expect(second.prompts[0]).toMatch(/Step 3 of/);
    expect(state.phase).toBe('done');
    expect(state.steps.map((step) => step.kind)).toEqual(['navigate', 'fill', 'click']);
    expect(calls.filter((call) => call === 'CLICK 2')).toHaveLength(1);
  });
});

describe('AgentRunner with tabs', () => {
  const tabs = (): Tab[] => [
    { tabId: 1, title: 'Shop', url: 'https://shop.test/' },
    { tabId: 7, title: 'Prices – Compare', url: 'https://prices.test/compare' },
  ];
  const pages = { 'https://shop.test/': form, 'https://prices.test/compare': page('https://prices.test/compare', [{ label: 'Details' }], 'Widget costs $9 here') };

  it('sees every tab, asks before reading another site, and keeps its notes across tabs', async () => {
    const { browser, calls, allowed } = fakeBrowser(pages, tabs());
    const { decide, prompts } = script([
      '{"action":"NOTE","text":"shop price $12"}',
      '{"action":"SWITCH_TAB","tab":2,"say":"The compare tab has prices"}',
      '{"action":"READ","text":"widget"}',
      '{"action":"FINISH","text":"Shop $12, compare site $9"}',
    ]);
    const runner = new AgentRunner(browser, decide);
    const asked = answer(runner, ['always']);
    const state = await runner.run('Compare the widget price with the other tab');
    expect(prompts[0]).toMatch(/\[2\] "Prices – Compare" prices\.test\/compare \(reading needs permission\)/);
    expect(asked[0]).toMatch(/prices\.test/);
    expect(allowed).toEqual(['prices.test']);
    expect(calls).toContain('switch 7');
    expect(prompts[2]).toMatch(/shop price \$12/);
    expect(prompts[2]).toContain('[1] "Prices – Compare" prices.test/compare (current)');
    expect(state.phase).toBe('done');
    expect(state.steps.at(-1)).toMatchObject({ kind: 'navigate', url: 'https://prices.test/compare' });
  });

  it('stays put when the person does not allow the other site', async () => {
    const { browser, calls } = fakeBrowser(pages, tabs());
    const { decide, prompts } = script(['{"action":"SWITCH_TAB","tab":2}', '{"action":"FINISH","text":"Could not compare","success":false}']);
    const runner = new AgentRunner(browser, decide);
    answer(runner, ['no']);
    await runner.run('Compare');
    expect(calls).not.toContain('switch 7');
    expect(calls).not.toContain('observe https://prices.test/compare');
    expect(prompts[1]).toMatch(/did not allow Ghostclick to read prices\.test/);
  });

  it('closes its own tabs freely but asks before closing yours', async () => {
    const { browser, calls } = fakeBrowser({ ...pages, 'https://news.test/': page('https://news.test/', [{ label: 'Story' }]) }, tabs());
    const { decide } = script([
      '{"action":"OPEN_TAB","url":"https://news.test/"}',
      '{"action":"CLOSE_TAB"}',
      '{"action":"CLOSE_TAB","tab":2}',
      '{"action":"FINISH","text":"ok"}',
    ]);
    const runner = new AgentRunner(browser, decide);
    const asked = answer(runner, ['no']);
    await runner.run('Tidy up tabs', { readAnySite: true });
    expect(calls).toContain('open https://news.test/');
    expect(calls).toContain('close 8');
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatch(/Close the tab "Prices – Compare", which Ghostclick did not open/);
    expect(calls).not.toContain('close 7');
  });

  it('never opens blocked sites', async () => {
    const { browser, calls } = fakeBrowser(pages, tabs());
    const { decide, prompts } = script(['{"action":"NAVIGATE","url":"https://www.mybank.com/"}', '{"action":"FINISH","text":"blocked","success":false}']);
    await new AgentRunner(browser, decide).run('Check my bank', { blocked: ['mybank.com'] });
    expect(calls.some((call) => call.includes('mybank'))).toBe(false);
    expect(prompts[1]).toMatch(/blocked/);
  });
});
