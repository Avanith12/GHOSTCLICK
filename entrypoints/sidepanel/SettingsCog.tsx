import { MODELS } from '@/features/local-ai/localModel';
import type { Snapshot } from '@/shared/types';
import type { Command } from './api';
import type { ModelState } from '@/features/local-ai/useLocalModel';

type Panel = 'workflows' | 'data';

export function SettingsCog({
  open,
  onClose,
  onDone,
  snap,
  model,
  command,
  openPanel,
}: {
  open: boolean;
  onClose: () => void;
  /** After changing theme/model/etc — back to home */
  onDone: () => void;
  snap: Snapshot;
  model: ModelState;
  command: Command;
  openPanel: (panel: Panel) => void;
}) {
  if (!open) return null;

  return (
    <div className="cog-panel" role="dialog" aria-label="Settings">
      <div className="cog-head">
        <h2>Settings</h2>
        <button type="button" className="ghost" aria-label="Close settings" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="cog-section">
        <p className="tag">Go to</p>
        <button
          type="button"
          className="cog-link"
          onClick={() => openPanel('workflows')}
        >
          Workflows
          <small>{snap.workflows.length}</small>
        </button>
        <button
          type="button"
          className="cog-link"
          onClick={() => openPanel('data')}
        >
          Data
          <small>{snap.results.rows.length}</small>
        </button>
      </div>

      <div className="cog-section">
        <p className="tag">Appearance</p>
        <button
          type="button"
          className="cog-link"
          onClick={() => {
            // Stay in settings so the top banner can crossfade with the theme.
            void command({
              type: 'SET_SETTINGS',
              settings: { theme: snap.settings.theme === 'light' ? 'dark' : 'light' },
            });
          }}
        >
          Theme
          <small>{snap.settings.theme === 'light' ? 'Light' : 'Dark'}</small>
        </button>
        <button
          type="button"
          className="cog-link"
          onClick={() => {
            void command({
              type: 'SET_SETTINGS',
              settings: { showGhostCursor: !(snap.settings.showGhostCursor !== false) },
            });
          }}
        >
          Ghost cursor
          <small>{snap.settings.showGhostCursor !== false ? 'On' : 'Off'}</small>
        </button>
      </div>

      <div className="cog-section">
        <p className="tag">Default model</p>
        <p className="hint">Used for Ask, summaries, and replay repair.</p>
        <select
          value={snap.settings.model}
          disabled={model.phase === 'loading'}
          onChange={(event) => {
            const id = event.target.value;
            void command({ type: 'SET_SETTINGS', settings: { model: id } }).then(() => onDone());
          }}
        >
          {MODELS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <p className="hint">{model.text}</p>
        <button
          type="button"
          className="ghost"
          disabled={model.phase === 'loading'}
          onClick={() => void model.load(snap.settings.model).then(() => onDone())}
        >
          {model.phase === 'loading' ? 'Loading…' : model.phase === 'ready' ? 'Reload model' : 'Load model'}
        </button>
      </div>
    </div>
  );
}
