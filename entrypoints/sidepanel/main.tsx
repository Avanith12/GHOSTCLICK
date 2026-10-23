import React from 'react';
import ReactDOM from 'react-dom/client';
import { agent, chromeBrowser } from '@/features/agent/chromeBrowser';
import { chatWithTimeout, loadModel, loadedModel } from '@/features/local-ai/localModel';
import { App } from './App';
import './style.css';

// Lets browser-tests/agent-test.mjs and agent-bench.mjs drive the agent loop. Only extension
// pages can reach this window; websites cannot.
(window as unknown as { ghostclickAgent: unknown }).ghostclickAgent = { agent, chromeBrowser, loadModel, loadedModel, chatWithTimeout };

// Held open for the panel's lifetime so the background notices when the panel closes.
chrome.runtime.connect({ name: 'sidepanel' });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
