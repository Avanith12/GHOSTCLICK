import { words } from './format';
import type { Workflow } from './types';

export type PlanAction = 'run' | 'scrape' | 'save_page' | 'ask_page' | 'ask_data' | 'record' | 'read_pdf';

export type Plan = {
  action: PlanAction;
  workflowId?: string;
  variables?: Record<string, string>;
  question?: string;
  name?: string;
  reply: string;
  source: 'model' | 'rules';
};

const ACTIONS: PlanAction[] = ['run', 'scrape', 'save_page', 'ask_page', 'ask_data', 'record', 'read_pdf'];

export function workflowFields(workflow: Workflow) {
  return workflow.steps
    .filter((step) => step.variableKey)
    .map((step) => ({ key: step.variableKey!, label: step.label, example: step.value ?? '' }));
}

export function validatePlan(raw: Record<string, unknown> | null, workflows: Workflow[], request: string): Plan | null {
  if (!raw) return null;
  const action = String(raw.action ?? '') as PlanAction;
  if (!ACTIONS.includes(action)) return null;
  const reply = String(raw.reply ?? '').slice(0, 240);
  if (action === 'run') {
    const workflow = workflows.find((item) => item.id === raw.workflowId);
    if (!workflow) return null;
    const allowed = new Set(workflowFields(workflow).map((field) => field.key));
    const variables: Record<string, string> = {};
    const given = (raw.variables ?? {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(given)) {
      if (allowed.has(key) && value !== null && value !== undefined && String(value).trim()) {
        variables[key] = String(value).trim();
      }
    }
    return { action, workflowId: workflow.id, variables, reply, source: 'model' };
  }
  if (action === 'ask_page' || action === 'ask_data') {
    return { action, question: String(raw.question ?? request), reply, source: 'model' };
  }
  if (action === 'record') {
    return { action, name: String(raw.name ?? '').slice(0, 80), reply, source: 'model' };
  }
  return { action, reply, source: 'model' };
}

const STOP = new Set([
  'the', 'and', 'for', 'this', 'that', 'page', 'all', 'get', 'with', 'from', 'into', 'please', 'can', 'you',
  'https', 'http', 'www', 'com', 'org', 'test', 'run', 'again', 'site', 'website', 'what', 'are', 'was',
]);

function bestWorkflow(request: string, workflows: Workflow[]) {
  const wanted = new Set([...words(request)].filter((word) => !STOP.has(word)));
  let best: { workflow: Workflow; score: number } | null = null;
  for (const workflow of workflows) {
    const text = [workflow.name, workflow.goal, ...workflowFields(workflow).map((field) => field.label)].join(' ');
    const have = words(text);
    let score = 0;
    for (const word of wanted) if (have.has(word)) score += 1;
    if (!best || score > best.score) best = { workflow, score };
  }
  return best && best.score > 0 ? best.workflow : null;
}

function guessValues(request: string, workflow: Workflow) {
  const values: Record<string, string> = {};
  const email = request.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0];
  const longNumber = request.match(/\b\d{5,}\b/)?.[0];
  const name = request.match(/\bfor ([A-Z][a-z]+(?: [A-Z][a-z]+)+)/)?.[1];
  for (const field of workflowFields(workflow)) {
    const label = `${field.key} ${field.label}`.toLowerCase();
    if (email && label.includes('email')) values[field.key] = email;
    else if (longNumber && /\bid\b|number/.test(label)) values[field.key] = longNumber;
    else if (name && label.includes('name')) values[field.key] = name;
  }
  return values;
}

export function rulesPlan(request: string, workflows: Workflow[], hasData: boolean): Plan {
  const text = request.toLowerCase();
  if (/\bpdf\b/.test(text)) {
    return { action: 'read_pdf', reply: 'Read the PDF in this tab, then save it or pull out what you need.', source: 'rules' };
  }
  if (
    /\b(scrape|extract|collect|gather|grab|harvest|table|list)\b/.test(text) ||
    /\b(get|pull|copy|fetch|find)\b.*\b(all|every|each)\b/.test(text)
  ) {
    return { action: 'scrape', reply: 'Pick one item in the list on the page.', source: 'rules' };
  }
  if (/\b(save|download|export)\b.*\b(page|article|document)\b|\bclean (copy|document)\b|\bmarkdown\b/.test(text)) {
    return { action: 'save_page', reply: 'Save this page as a clean document.', source: 'rules' };
  }
  if (/\b(summar|what does|explain)\w*/.test(text)) {
    return {
      action: hasData && /\b(data|rows|results|table)\b/.test(text) ? 'ask_data' : 'ask_page',
      question: request,
      reply: 'Answer from the page with the local model.',
      source: 'rules',
    };
  }
  if (/\b(record|teach|show you|learn)\b/.test(text)) {
    return { action: 'record', name: request.slice(0, 60), reply: 'Show the task once while Ghostclick records.', source: 'rules' };
  }
  const workflow = bestWorkflow(request, workflows);
  if (workflow) {
    return {
      action: 'run',
      workflowId: workflow.id,
      variables: guessValues(request, workflow),
      reply: `Run “${workflow.name}”. Check the values before you start.`,
      source: 'rules',
    };
  }
  return {
    action: 'record',
    name: request.slice(0, 60),
    reply: 'No saved workflow matches. Show the task once and Ghostclick will remember it.',
    source: 'rules',
  };
}
