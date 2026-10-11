import { useCallback, useState } from 'react';
import { loadModel, loadedModel, MODELS, modelReady } from './model';

export type ModelPhase = 'idle' | 'loading' | 'ready' | 'error';

export type ModelState = {
  phase: ModelPhase;
  text: string;
  load: (modelId: string) => Promise<boolean>;
};

export function useModel(): ModelState {
  const [phase, setPhase] = useState<ModelPhase>(modelReady() ? 'ready' : 'idle');
  const [text, setText] = useState(
    modelReady()
      ? `${labelFor(loadedModel())} is ready.`
      : 'Runs on this computer through WebGPU. Nothing is sent to a server. The first load downloads the model once.',
  );

  const load = useCallback(async (modelId: string) => {
    if (modelReady() && loadedModel() === modelId) return true;
    setPhase('loading');
    setText(`Loading ${labelFor(modelId)}…`);
    try {
      await loadModel(modelId, (progress) => setText(progress));
      setPhase('ready');
      setText(`${labelFor(modelId)} is ready.`);
      return true;
    } catch (error) {
      setPhase('error');
      setText(error instanceof Error ? error.message : 'The local model could not load.');
      return false;
    }
  }, []);

  return { phase, text, load };
}

function labelFor(id: string) {
  return MODELS.find((model) => model.id === id)?.label.split(' · ')[0] ?? id;
}
