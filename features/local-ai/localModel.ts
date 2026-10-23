import type { MLCEngine } from '@mlc-ai/web-llm';
import { bestKeywordMatches, keywordFilter, rowText, rowWords } from '@/features/ask/keywordSearch';
import { parseModelChoice, parseNumberChoice } from '@/features/workflows/selfRepair';
import type { HumanPrompt, Row } from '@/shared/types';

export const MODELS = [
  { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 1.5B · fastest, about 1 GB' },
  { id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 3B · balanced, about 2 GB' },
  { id: 'Phi-3.5-mini-instruct-q4f16_1-MLC', label: 'Phi-3.5 Mini · strongest, about 2.2 GB' },
  { id: 'Phi-3.5-vision-instruct-q4f16_1-MLC', label: 'Phi-3.5 Vision · also sees screenshots, about 4 GB' },
];

// WebLLM reserves graphics memory for the whole context window up front (about 0.75 MB per token for
// Phi-3.5 in 32-bit), so the default 4,096 does not fit an 8 GB card. Text prompts stay under
// ANSWER_CHARS plus 400 reply tokens; a vision prompt is a 1,921-token screenshot plus a short question.
const TEXT_CONTEXT = 3072;
const VISION_CONTEXT = 2560;
const ANSWER_CHARS = 5000;

let engine: MLCEngine | null = null;
let loadedId = '';
let loading: Promise<void> | null = null;

export function modelReady() {
  return Boolean(engine);
}

export function loadedModel() {
  return loadedId;
}

export function isVisionModel(modelId: string) {
  return modelId.includes('-vision-');
}

export function visionReady() {
  return Boolean(engine) && isVisionModel(loadedId);
}

export function textModelReady() {
  return Boolean(engine) && !isVisionModel(loadedId);
}

export const VISION_ONLY =
  'Phi-3.5 Vision is only used to repair replays, because it is too large to also answer questions. Pick Phi-3.5 Mini below and load it for questions and summaries.';

type GpuNavigator = Navigator & {
  gpu?: { requestAdapter: (options?: { powerPreference?: string }) => Promise<{ features: Set<string> } | null> };
};

async function resolveModelId(modelId: string) {
  const gpu = (navigator as GpuNavigator).gpu;
  if (!gpu) throw new Error('This Chrome profile does not expose WebGPU, so a local model cannot start.');
  const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('Chrome could not reach the graphics card. Open chrome://gpu and check that WebGPU is enabled.');
  return adapter.features.has('shader-f16') ? modelId : modelId.replace('q4f16_1', 'q4f32_1');
}

export async function loadModel(modelId: string, onProgress: (text: string) => void) {
  if (loading) await loading;
  const resolved = await resolveModelId(modelId);
  if (engine && loadedId === resolved) return;
  if (resolved !== modelId) onProgress('This graphics card lacks 16-bit support, so the 32-bit version of the model is used.');
  loading = (async () => {
    const { CreateMLCEngine } = await import('@mlc-ai/web-llm');
    if (engine) {
      await engine.unload();
      engine = null;
    }
    engine = await CreateMLCEngine(
      resolved,
      { initProgressCallback: (report) => onProgress(report.text) },
      { context_window_size: isVisionModel(resolved) ? VISION_CONTEXT : TEXT_CONTEXT },
    );
    loadedId = resolved;
  })();
  try {
    await loading;
  } finally {
    loading = null;
  }
}

async function withEngine<T>(task: (current: MLCEngine) => Promise<T>) {
  if (!engine) throw new Error('Load a local model first.');
  try {
    return await task(engine);
  } catch (error) {
    // WebLLM unloads itself when the GPU device is lost, leaving our engine reference stale.
    if (error instanceof Error && error.name === 'ModelNotLoadedError') {
      engine = null;
      loadedId = '';
      throw new Error(
        'The graphics card dropped the local model, usually because it ran low on memory. Choose Load model to load it again, or pick a smaller model.',
      );
    }
    throw error;
  }
}

async function chat(system: string, user: string, maxTokens: number) {
  const reply = await withEngine((current) =>
    current.chat.completions.create({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0,
      max_tokens: maxTokens,
    }),
  );
  return reply.choices[0]?.message?.content ?? '';
}

export function parseJson(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export type PlannerWorkflow = {
  id: string;
  name: string;
  goal: string;
  fields: { key: string; label: string; example: string }[];
};

export async function planTask(request: string, workflows: PlannerWorkflow[], hasData: boolean) {
  const catalog = workflows
    .slice(0, 8)
    .map(
      (workflow) =>
        `- id: ${workflow.id}\n  name: ${workflow.name}\n  goal: ${workflow.goal || 'not given'}\n  fields: ${
          workflow.fields.map((field) => `${field.key} (${field.label}, example "${field.example}")`).join('; ') || 'none'
        }`,
    )
    .join('\n');
  const text = await chat(
    `You plan tasks for a browser extension. Reply with one JSON object only.
Actions:
{"action":"run","workflowId":"<id>","variables":{"<field key>":"<value>"},"reply":"<one sentence>"}  use a saved workflow; only fill fields the request gives a value for
{"action":"find","question":"<what items to keep, or empty for all>","reply":"..."}  collect items from the main list or table on the current page, optionally only those matching a description
{"action":"scrape","reply":"..."}  the user wants to click the list themselves
{"action":"save_page","reply":"..."}  save the current page as a clean document
{"action":"ask_page","question":"<question>","reply":"..."}  answer any question about the current page (default when unsure)
{"action":"ask_data","question":"<question>","reply":"..."}  answer using data already scraped${hasData ? '' : ' (no data scraped yet)'}
{"action":"read_pdf","reply":"..."}  the request is about a PDF document
{"action":"record","name":"<short name>","reply":"..."}  only when the user explicitly asks to record, teach, or show a new workflow
Examples:
"Release the hold for Ada Lovelace, ID 1234567" -> {"action":"run","workflowId":"<id of the hold workflow>","variables":{"<name field>":"Ada Lovelace","<id field>":"1234567"},"reply":"Run the hold workflow for Ada Lovelace."}
"which repos here are about databases" -> {"action":"find","question":"databases","reply":"Keep repos about databases."}
"what is this page about" -> {"action":"ask_page","question":"what is this page about","reply":"Answer from the page."}
"what is this article saying" -> {"action":"ask_page","question":"What is this article saying?","reply":"Answer from the page."}`,
    `Saved workflows:\n${catalog || 'none'}\n\nRequest: ${request}`,
    260,
  );
  return parseJson(text);
}

const DESTRUCTIVE = /\b(cancel|delete|remove|back|reset|clear|discard|unsubscribe|sign ?out|log ?out)\b/i;

export async function suggestRepair(prompt: HumanPrompt, screenshot?: string) {
  const safe = DESTRUCTIVE.test(prompt.step.label)
    ? prompt.candidates
    : prompt.candidates.filter((candidate) => !DESTRUCTIVE.test(`${candidate.label} ${candidate.selector}`));
  const candidates = safe.length ? safe : prompt.candidates;
  if (screenshot && visionReady()) return lookForRepair(prompt, candidates, screenshot);
  const choices = candidates
    .map((candidate) => `- selector: ${candidate.selector} | label: ${candidate.label} | tag: ${candidate.tag}`)
    .join('\n');
  const text = await chat(
    'You repair one recorded browser step. Choose exactly one selector from the list. Never choose a control that cancels, deletes, or goes back unless the recorded control did that. Reply with JSON only: {"selector":"...","reason":"short reason"}.',
    `The recorded control was "${prompt.step.label}" and its selector ${prompt.step.selector} is missing.\nChoose the control that continues the same task.\n${choices}`,
    120,
  );
  return parseModelChoice(text, candidates.map((candidate) => candidate.selector));
}

async function lookForRepair(prompt: HumanPrompt, candidates: HumanPrompt['candidates'], screenshot: string) {
  const allowed = new Set(candidates.map((candidate) => candidate.selector));
  const choices = prompt.candidates
    .map((candidate, index) => ({ candidate, number: index + 1 }))
    .filter(({ candidate }) => allowed.has(candidate.selector))
    .map(({ candidate, number }) => `${number}. "${candidate.label}" (${candidate.tag})`)
    .join('\n');
  const action = prompt.step.kind === 'click' ? 'clicked' : 'typed into';
  const reply = await withEngine((current) =>
    current.chat.completions.create({
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `This is a screenshot of a web page. Orange tags with numbers mark the controls that can be used.
A recorded step ${action} "${prompt.step.label}", but that control has moved or changed.
Which numbered control continues the same task?
${choices}
Never choose a control that cancels, deletes, or goes back unless the recorded control did that.
Reply with JSON only: {"number":<tag number>,"reason":"short reason"}`,
            },
            { type: 'image_url', image_url: { url: screenshot } },
          ],
        },
      ],
      temperature: 0,
      max_tokens: 80,
    }),
  );
  const choice = parseNumberChoice(
    reply.choices[0]?.message?.content ?? '',
    prompt.candidates.map((candidate) => candidate.selector),
    [...allowed],
  );
  return choice ? { ...choice, sawPage: true } : null;
}

export async function extractRows(request: string, columns: string[], text: string) {
  const keys = columns.length ? columns : ['item', 'value'];
  const keyList = keys.map((column) => JSON.stringify(column)).join(', ');
  const example = Object.fromEntries(keys.map((key, index) => [key, index === 0 ? '2D cancer cases' : '7351']));
  const reply = await chat(
    `You copy facts from document text into a table of rows.
Use exactly these keys in every row, in this order: ${keyList}.
Each row is one fact or one listed item. Do not put every number into one column named "type".
Copy values exactly as written. Use "" when missing. Never invent numbers or labels.
Reply with JSON only shaped like: {"rows":[${JSON.stringify(example)}]}.
If nothing matches, reply {"rows":[]}.`,
    `What to pull out: ${request}\n\nDocument text:\n${text}`,
    900,
  );
  const data = parseJson(reply);
  const rows = Array.isArray(data?.rows) ? (data.rows as unknown[]) : [];
  return rows
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object' && !Array.isArray(row))
    .map((row) => {
      const ordered = keys.map((key) => [key, row[key] == null ? '' : String(row[key])] as const);
      // Keep any extra keys the model added, but prefer the requested shape first.
      const extras = Object.entries(row)
        .filter(([key]) => !keys.includes(key))
        .map(([key, value]) => [key, value == null ? '' : String(value)] as const);
      return Object.fromEntries([...ordered, ...extras]);
    });
}

async function yesScore(topic: string, item: string) {
  const reply = await withEngine((current) =>
    current.chat.completions.create({
      messages: [
        { role: 'system', content: 'You decide if an item is mainly about a topic. Answer with one word: yes or no.' },
        { role: 'user', content: 'Topic: cooking\nItem: Easy weeknight pasta recipes with five ingredients' },
        { role: 'assistant', content: 'yes' },
        { role: 'user', content: 'Topic: cooking\nItem: A kitchen-themed puzzle game for iPhone' },
        { role: 'assistant', content: 'no' },
        { role: 'user', content: `Topic: ${topic}\nItem: ${item}` },
      ],
      temperature: 1,
      top_p: 1,
      max_tokens: 1,
      logprobs: true,
      top_logprobs: 5,
    }),
  );
  let yes = 0;
  let no = 0;
  for (const { token, logprob } of reply.choices[0]?.logprobs?.content?.[0]?.top_logprobs ?? []) {
    const word = token.trim().toLowerCase();
    if (word.startsWith('yes')) yes += Math.exp(logprob);
    else if (word.startsWith('no')) no += Math.exp(logprob);
  }
  return yes + no > 0 ? yes / (yes + no) : 0;
}

const MAX_SCORED = 150;

export async function filterRows(filter: string, rows: Row[], onProgress?: (done: number, total: number) => void) {
  const mentioned = keywordFilter(filter, rows);
  const first = new Set(mentioned);
  const order = [...mentioned, ...rows.map((_, index) => index).filter((index) => !first.has(index))].slice(0, MAX_SCORED);
  const literal = new Set(keywordFilter(filter, rows, true));
  const kept = new Set(literal);
  for (const [done, index] of order.entries()) {
    if ((await yesScore(filter, rowWords(rows[index]!))) >= 0.5) kept.add(index);
    onProgress?.(done + 1, order.length);
  }
  if (kept.size === 0) return bestKeywordMatches(filter, rows);
  return [...kept].sort((left, right) => left - right);
}

export async function answer(question: string, context: string, maxChars = ANSWER_CHARS) {
  const clipped = context.trim().slice(0, Math.max(ANSWER_CHARS, maxChars));
  if (!clipped) {
    return 'No text was available to answer from. For PDFs, use Data → PDF → Read / Open a PDF file first (scanned image PDFs cannot be read yet).';
  }
  return chat(
    'Answer using only the provided content. Prefer concrete facts (names, dates, numbers, section titles). Quote short phrases when helpful. If the content is incomplete for the question, say what is missing instead of guessing.',
    `Content:\n${clipped}\n\nQuestion: ${question}`,
    500,
  );
}
