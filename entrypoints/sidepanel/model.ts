import type { MLCEngine } from '@mlc-ai/web-llm';
import { parseModelChoice } from '@/lib/heal';
import type { HumanPrompt } from '@/lib/types';

export const MODELS = [
  { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 1.5B · fastest, about 1 GB' },
  { id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 3B · balanced, about 2 GB' },
  { id: 'Phi-3.5-mini-instruct-q4f16_1-MLC', label: 'Phi-3.5 Mini · strongest, about 2.2 GB' },
];

let engine: MLCEngine | null = null;
let loadedId = '';
let loading: Promise<void> | null = null;

export function modelReady() {
  return Boolean(engine);
}

export function loadedModel() {
  return loadedId;
}

export async function loadModel(modelId: string, onProgress: (text: string) => void) {
  if (engine && loadedId === modelId) return;
  if (!(navigator as Navigator & { gpu?: unknown }).gpu) {
    throw new Error('This Chrome profile does not expose WebGPU, so a local model cannot start.');
  }
  if (loading) await loading;
  if (engine && loadedId === modelId) return;
  loading = (async () => {
    const { CreateMLCEngine } = await import('@mlc-ai/web-llm');
    if (engine) {
      await engine.unload();
      engine = null;
    }
    engine = await CreateMLCEngine(modelId, {
      initProgressCallback: (report) => onProgress(report.text),
    });
    loadedId = modelId;
  })();
  try {
    await loading;
  } finally {
    loading = null;
  }
}

async function chat(system: string, user: string, maxTokens: number) {
  if (!engine) throw new Error('Load a local model first.');
  const reply = await engine.chat.completions.create({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0,
    max_tokens: maxTokens,
  });
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
{"action":"scrape","reply":"..."}  collect a repeated list or table from the current page
{"action":"save_page","reply":"..."}  save the current page as a clean document
{"action":"ask_page","question":"<question>","reply":"..."}  answer or summarize using the current page
{"action":"ask_data","question":"<question>","reply":"..."}  answer using data already scraped${hasData ? '' : ' (no data scraped yet)'}
{"action":"read_pdf","reply":"..."}  the request is about a PDF document
{"action":"record","name":"<short name>","reply":"..."}  no saved workflow fits, so the user must show the task once`,
    `Saved workflows:\n${catalog || 'none'}\n\nRequest: ${request}`,
    260,
  );
  return parseJson(text);
}

export async function suggestRepair(prompt: HumanPrompt) {
  const choices = prompt.candidates
    .map((candidate) => `- selector: ${candidate.selector} | label: ${candidate.label} | tag: ${candidate.tag}`)
    .join('\n');
  const text = await chat(
    'You repair one recorded browser step. Choose exactly one selector from the list. Never choose a control that cancels, deletes, or goes back unless the recorded control did that. Reply with JSON only: {"selector":"...","reason":"short reason"}.',
    `The recorded control was "${prompt.step.label}" and its selector ${prompt.step.selector} is missing.\nChoose the control that continues the same task.\n${choices}`,
    120,
  );
  return parseModelChoice(text, prompt.candidates.map((candidate) => candidate.selector));
}

export async function extractRows(request: string, columns: string[], text: string) {
  const columnRule = columns.length
    ? `Use exactly these keys in this order: ${columns.map((column) => JSON.stringify(column)).join(', ')}.`
    : 'Choose short, clear keys and use the same keys for every row.';
  const reply = await chat(
    `You copy information out of document text into a table. ${columnRule}
Copy values exactly as written in the text. Use "" when a value is not in the text. Never invent rows.
Reply with JSON only: {"rows":[{"key":"value"}]}. If nothing matches, reply {"rows":[]}.`,
    `What to pull out: ${request}\n\nDocument text:\n${text}`,
    900,
  );
  const data = parseJson(reply);
  const rows = Array.isArray(data?.rows) ? (data.rows as unknown[]) : [];
  return rows
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object' && !Array.isArray(row))
    .map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value == null ? '' : String(value)])));
}

export async function answer(question: string, context: string) {
  return chat(
    'Answer using only the provided content. Be brief and concrete. If the content does not contain the answer, say so.',
    `Content:\n${context.slice(0, 6000)}\n\nQuestion: ${question}`,
    400,
  );
}
