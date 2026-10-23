import { confirmReset, escapeHtml, loadState, mountShell, STORE_KEY, toast } from '../app.js';
import { CHALLENGES, grade } from '../challenges.js';

mountShell('challenges.html');

let filter = '';

function render() {
  const results = grade(loadState());
  const passed = results.filter((result) => result.pass).length;
  document.querySelector('#score').textContent = `${passed} / ${results.length}`;
  document.querySelector('#checked').textContent = new Date().toLocaleTimeString();
  document.querySelector('#list').innerHTML = CHALLENGES.map((challenge, index) => ({ challenge, result: results[index], index }))
    .filter(({ challenge }) => !filter || challenge.difficulty === filter)
    .map(
      ({ challenge, result, index }) => `<article class="card challenge" id="challenge-${challenge.id}" aria-labelledby="title-${challenge.id}">
        <header>
          <div>
            <p class="eyebrow">Challenge ${index + 1}</p>
            <h2 id="title-${challenge.id}">${escapeHtml(challenge.title)}</h2>
          </div>
          <span class="difficulty ${challenge.difficulty.toLowerCase()}">${challenge.difficulty}</span>
        </header>
        <p class="instruction">${escapeHtml(challenge.instruction)}</p>
        <dl>
          <dt>Expected outcome</dt><dd>${escapeHtml(challenge.outcome)}</dd>
          <dt>Pages</dt><dd>${escapeHtml(challenge.pages.join(' → '))}</dd>
          <dt>Expected actions</dt><dd>About ${challenge.actions}</dd>
          <dt>Shows</dt><dd>${escapeHtml(challenge.features)}</dd>
        </dl>
        <div>
          <p class="verdict ${result.pass ? 'pass' : 'fail'}" data-verdict="${result.pass ? 'pass' : 'fail'}">${result.pass ? '✓ Passed' : 'Not passed yet'}</p>
          <ul class="criteria">${result.criteria.map((item) => `<li class="${item.met ? 'met' : 'unmet'}">${escapeHtml(item.text)}</li>`).join('')}</ul>
        </div>
        <div class="toolbar"><button type="button" class="button small" data-copy="${challenge.id}">Copy instruction</button></div>
      </article>`,
    )
    .join('');
}

document.querySelector('#list').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-copy]');
  if (!button) return;
  const challenge = CHALLENGES.find((item) => item.id === button.dataset.copy);
  try {
    await navigator.clipboard.writeText(challenge.instruction);
    toast('Instruction copied. Paste it into Ghostclick.');
  } catch {
    toast('Copy is blocked here; select the text instead.', 'error');
  }
});
document.querySelector('#filters').addEventListener('click', (event) => {
  const chip = event.target.closest('[data-filter]');
  if (!chip) return;
  filter = chip.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach((item) => item.setAttribute('aria-pressed', String(item === chip)));
  render();
});
document.querySelector('#recheck').addEventListener('click', render);
document.querySelector('#reset').addEventListener('click', confirmReset);
// Grade again whenever another tab changes the demo state.
window.addEventListener('storage', (event) => {
  if (event.key === STORE_KEY) render();
});
window.addEventListener('focus', render);

render();
