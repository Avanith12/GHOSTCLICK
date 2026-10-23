import type { Row, WorkflowStep } from '@/shared/types';

export const ACTION_NAMES = [
  'NAVIGATE',
  'SEARCH',
  'CLICK',
  'TYPE',
  'CLEAR',
  'SELECT',
  'SCROLL',
  'HOVER',
  'WAIT',
  'READ',
  'EXTRACT',
  'NOTE',
  'OPEN_TAB',
  'SWITCH_TAB',
  'CLOSE_TAB',
  'GO_BACK',
  'GO_FORWARD',
  'DOWNLOAD',
  'SUBMIT',
  'UPLOAD_FILE',
  'SCREENSHOT',
  'VERIFY',
  'ASK_USER',
  'FINISH',
] as const;

export type ActionName = (typeof ACTION_NAMES)[number];

/** One schema-checked browser action chosen by the model. Never contains code. */
export type AgentAction = {
  action: ActionName;
  say: string;
  id?: number;
  text?: string;
  url?: string;
  option?: string;
  direction?: 'up' | 'down' | 'top' | 'bottom';
  submit?: boolean;
  tab?: number;
  ms?: number;
  success?: boolean;
};

export type ElementKind = 'link' | 'button' | 'input' | 'textarea' | 'select' | 'checkbox' | 'radio' | 'editable' | 'other';

export type ObservedElement = {
  id: number;
  kind: ElementKind;
  label: string;
  type?: string;
  value?: string;
  options?: string[];
  checked?: boolean;
  href?: string;
  disabled?: boolean;
  required?: boolean;
  invalid?: string;
  /** Submits a form when clicked. */
  submit?: boolean;
  /** Number of text-like fields in the element's form; 1 usually means a search box. */
  formFields?: number;
  password?: boolean;
  inView: boolean;
};

export type PageObservation = {
  url: string;
  title: string;
  elements: ObservedElement[];
  /** Interactive elements on the page that were left out of the list. */
  hidden: number;
  text: string;
  dialog?: string;
  problems: string[];
  password: boolean;
  captcha: boolean;
  atBottom: boolean;
  fingerprint: string;
};

export type TabInfo = {
  tabId: number;
  title: string;
  url: string;
  current: boolean;
  /** Opened by the agent during this task, so it may close it without asking. */
  opened: boolean;
  /** The person allows the agent to read this site. */
  allowed: boolean;
};

/** What the content script reports after running one action in the page. */
export type ActResult = {
  ok: boolean;
  message: string;
  step?: WorkflowStep;
  text?: string;
  href?: string;
  rows?: Row[];
};
