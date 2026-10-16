import { filterPhrase } from '@/features/ask/keywordSearch';
import { words } from '@/shared/textHelpers';
import type { Workflow } from '@/shared/types';

export type PlanAction = 'run' | 'find' | 'scrape' | 'save_page' | 'ask_page' | 'ask_data' | 'record' | 'read_pdf';

export type Plan = {
  action: PlanAction;
  workflowId?: string;
  variables?: Record<string, string>;
  question?: string;
  name?: string;
  reply: string;
  source: 'model' | 'rules';
  confident?: boolean;
};

const ACTIONS: PlanAction[] = ['run', 'find', 'scrape', 'save_page', 'ask_page', 'ask_data', 'record', 'read_pdf'];

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
  if (action === 'find') {
    return { action, question: String(raw.question ?? filterPhrase(request)).trim(), reply, source: 'model' };
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
  return best && best.score > 0 ? best : null;
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

const LIST_HINT =
  /\b(all|every|each|any|list|lists|items?|which|ones|find|show|get|collect|scrape|extract|repos?|results?|related|about|products?|stories|articles|posts|links|rows|table|headlines)\b/i;

export function choosePlan(model: Plan | null, rules: Plan, request: string): Plan {
  if (!model) return rules;
  if (rules.confident && (model.action !== rules.action || (rules.action === 'run' && model.workflowId !== rules.workflowId))) {
    return rules;
  }
  if ((model.action === 'find' || model.action === 'scrape') && rules.action !== model.action && !LIST_HINT.test(request)) {
    return rules;
  }
  if (model.action === 'run') {
    const lower = request.toLowerCase();
    const stated = Object.entries(model.variables ?? {}).filter(([, value]) => lower.includes(value.toLowerCase()));
    const guessed = rules.action === 'run' && rules.workflowId === model.workflowId ? rules.variables : {};
    return { ...model, variables: { ...guessed, ...Object.fromEntries(stated) } };
  }
  if (model.action === 'find') {
    const question =
      rules.action === 'find' ? (rules.question ?? '') : filterPhrase(model.question ?? '') || (model.question ?? '');
    return { ...model, question };
  }
  return model;
}

export function rulesPlan(request: string, workflows: Workflow[], hasData: boolean): Plan {
  const text = request.toLowerCase();
  if (/\bpdf\b/.test(text)) {
    return { action: 'read_pdf', reply: 'Read the PDF in this tab, then save it or pull out what you need.', source: 'rules', confident: true };
  }
  if (/\b(pick|choose|click)\b.*\b(list|table|items?)\b/.test(text)) {
    return { action: 'scrape', reply: 'Click one item in the list you want.', source: 'rules', confident: true };
  }
  if (
    /\b(scrape|extract|collect|gather|grab|harvest|table|list)\b/.test(text) ||
    /\b(get|pull|copy|fetch|find|show|want|need|give me)\b.*\b(all|every|each|any)\b/.test(text) ||
    /\b(find|show|get|want|need|give me)\b.*\b(related to|about|that mention|mentioning|containing)\b/.test(text)
  ) {
    const question = filterPhrase(request);
    return {
      action: 'find',
      question,
      reply: question
        ? `Find the main list on this page and keep items about “${question}”.`
        : 'Find the main list on this page and collect every item.',
      source: 'rules',
      confident: true,
    };
  }
  const named = request.match(
    /^\s*(?:please\s+)?(?:(?:can|could) you\s+)?(?:find|fine|fnd|fin|finde|fidn|search(?: for)?|look for|show|list|which are|where (?:is|are)|is there|are there|any)\s+(?:me\s+)?(?:the\s+|any\s+|an?\s+|some\s+)?(.+?)(\s+(?:on|in|from)\s+(?:this|the)\s+(?:page|site|website|list|results)\b.*)?[\s.?!]*$/i,
  );
  const wanted = named && !/^(you|items?|things|stuff|everything|results?|rows|links|list|products?)\b/i.test(named[1]!.trim()) ? named[1]!.trim() : '';
  const findWanted = (confident: boolean): Plan => ({
    action: 'find',
    question: wanted,
    reply: `Find the main list on this page and keep items about “${wanted}”.`,
    source: 'rules',
    confident,
  });
  if (wanted && named?.[2]) return findWanted(true);
  if (/\b(save|download|export)\b.*\b(page|article|document)\b|\bclean (copy|document)\b|\bmarkdown\b/.test(text)) {
    return { action: 'save_page', reply: 'Save this page as a clean document.', source: 'rules', confident: true };
  }
  if (/\b(summar|what does|explain)\w*/.test(text)) {
    return {
      action: hasData && /\b(data|rows|results|table)\b/.test(text) ? 'ask_data' : 'ask_page',
      question: request,
      reply: 'Answer from the page with the local model.',
      source: 'rules',
      confident: /\bsummar/.test(text),
    };
  }
  if (/\b(record|teach|show you|learn)\b/.test(text)) {
    return { action: 'record', name: request.slice(0, 60), reply: 'Show the task once while Ghostclick records.', source: 'rules', confident: true };
  }
  const match = bestWorkflow(request, workflows);
  if (match) {
    return {
      action: 'run',
      workflowId: match.workflow.id,
      variables: guessValues(request, match.workflow),
      reply: `Run “${match.workflow.name}”. Check the values before you start.`,
      source: 'rules',
      confident: match.score >= 2,
    };
  }
  if (wanted) return findWanted(false);
  return {
    action: 'record',
    name: request.slice(0, 60),
    reply: 'No saved workflow matches. Show the task once and Ghostclick will remember it.',
    source: 'rules',
  };
}
