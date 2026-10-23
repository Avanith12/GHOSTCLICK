export type StepKind = 'navigate' | 'fill' | 'click' | 'check' | 'extract' | 'assert';

export type ExtractField = {
  name: string;
  selector: string;
  attr: 'text' | 'href' | 'src';
  next?: boolean;
  closest?: string;
  alt?: string;
  index?: number;
};

export type ExtractSpec = {
  mode: 'list' | 'table';
  itemSelector: string;
  requires?: string;
  fields: ExtractField[];
};

export type WorkflowStep = {
  id: string;
  kind: StepKind;
  url: string;
  selector: string;
  fallbacks: string[];
  label: string;
  value?: string;
  variableKey?: string;
  inputType?: string;
  extract?: ExtractSpec;
  expectedText?: string;
  screenshot?: string;
  /** Press Enter after filling, for search boxes and forms that submit on Enter. */
  pressEnter?: boolean;
};

export type Workflow = {
  id: string;
  name: string;
  goal: string;
  createdAt: number;
  steps: WorkflowStep[];
};

export type Candidate = {
  selector: string;
  label: string;
  tag: string;
  score: number;
};

export type HumanPrompt = {
  token: string;
  kind: 'repair' | 'captcha';
  step: WorkflowStep;
  candidates: Candidate[];
  reason: string;
};

export type Decision = {
  token: string;
  approved: boolean;
  selector: string;
};

export type LogLine = {
  id: string;
  text: string;
  tone: 'info' | 'ok' | 'warn' | 'wait';
};

export type Row = Record<string, string>;

export type Results = {
  columns: string[];
  rows: Row[];
  source: string;
};

export type CheckResult = {
  text: string;
  passed: boolean;
  run: number;
};

export type Batch = {
  rows: Record<string, string>[];
  index: number;
};

export type SessionMode = 'idle' | 'recording' | 'replaying' | 'paused' | 'picking';

export type Session = {
  mode: SessionMode;
  tabId: number | null;
  draft: Workflow | null;
  replayWorkflowId: string | null;
  replayIndex: number;
  variables: Record<string, string>;
  batch: Batch | null;
  log: LogLine[];
  prompt: HumanPrompt | null;
  resolution: Decision | null;
  checks: CheckResult[];
  statusText: string;
  pickReturnMode: 'idle' | 'recording';
};

export type Settings = {
  screenshots: boolean;
  model: string;
  theme: 'dark' | 'light';
  /** Most actions one agent task may take. */
  agentMaxSteps: number;
  /** Sites the agent may read without asking, one host per line. */
  agentAllowed: string;
  /** Sites the agent must never open or act on. */
  agentBlocked: string;
  /** Let the agent read any site it opens without asking first. */
  agentReadAny: boolean;
};

export type Snapshot = Session & {
  workflows: Workflow[];
  replayTotal: number;
  results: Results;
  settings: Settings;
};
