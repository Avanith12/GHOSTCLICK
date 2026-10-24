type SpeechRec = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: {
    resultIndex: number;
    results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
  }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

const status = document.getElementById('status')!;
const dot = document.getElementById('dot')!;
const done = document.getElementById('done')!;

let committed = '';
let recognition: SpeechRec | null = null;
let closing = false;
let silenceTimer = 0;

/** After a short pause with text, finish and send so Ask can run without clicking Done. */
function scheduleFinish() {
  window.clearTimeout(silenceTimer);
  silenceTimer = window.setTimeout(() => {
    if (closing || !committed.trim()) return;
    closing = true;
    stop();
    sendTranscript(committed.trim(), true);
    window.close();
  }, 1500);
}

function setStatus(text: string, kind: '' | 'live' | 'err' = '') {
  status.textContent = text;
  status.className = kind;
}

function speechEngine(): SpeechRec | null {
  const Speech =
    (window as unknown as { SpeechRecognition?: new () => SpeechRec }).SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: new () => SpeechRec }).webkitSpeechRecognition;
  return Speech ? new Speech() : null;
}

async function ensureMic() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  for (const track of stream.getTracks()) track.stop();
}

function sendTranscript(text: string, finalChunk: boolean) {
  const trimmed = text.trim();
  if (!trimmed) return;
  void chrome.runtime.sendMessage({ type: 'VOICE_TRANSCRIPT', text: trimmed, final: finalChunk });
}

function stop() {
  const engine = recognition;
  recognition = null;
  if (!engine) return;
  engine.onresult = null;
  engine.onerror = null;
  engine.onend = null;
  try {
    engine.abort();
  } catch {
    try {
      engine.stop();
    } catch {
      /* ignore */
    }
  }
}

async function start() {
  try {
    await ensureMic();
  } catch {
    setStatus('Microphone blocked. Allow mic for this Ghostclick window, then reopen Voice.', 'err');
    dot.classList.add('off');
    return;
  }

  const engine = speechEngine();
  if (!engine) {
    setStatus('Speech is not available in this Chrome. Type in the side panel instead.', 'err');
    return;
  }

  committed = '';
  engine.continuous = true;
  engine.interimResults = true;
  engine.lang = 'en-US';
  engine.onresult = (event) => {
    let interim = '';
    let finals = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const piece = event.results[i]![0]!.transcript;
      if (event.results[i]!.isFinal) finals += piece;
      else interim += piece;
    }
    if (finals.trim()) {
      committed = `${committed} ${finals}`.replace(/\s+/g, ' ').trim();
      sendTranscript(committed, false);
      scheduleFinish();
    }
    if (interim.trim()) {
      window.clearTimeout(silenceTimer);
    }
    const shown = `${committed}${interim ? ` ${interim}` : ''}`.replace(/\s+/g, ' ').trim();
    setStatus(shown || 'Listening… speak now', 'live');
  };
  engine.onerror = (event) => {
    if (event.error === 'aborted' || event.error === 'no-speech') return;
    if (event.error === 'network') {
      setStatus('Speech needs network (Chrome’s speech service). Check Wi‑Fi and try again.', 'err');
    } else if (event.error === 'not-allowed') {
      setStatus('Microphone blocked for Ghostclick. Allow mic, then try again.', 'err');
    } else {
      setStatus(`Voice error: ${event.error}. You can type in the side panel.`, 'err');
    }
    dot.classList.add('off');
  };
  engine.onend = () => {
    if (closing) return;
    // Chrome often ends after a pause — restart while the window stays open.
    try {
      engine.start();
    } catch {
      setStatus(committed ? `Got: “${committed}”. Click Done.` : 'Stopped. Click Done or reopen Voice.', committed ? 'live' : 'err');
      dot.classList.add('off');
    }
  };

  recognition = engine;
  try {
    engine.start();
    dot.classList.remove('off');
    setStatus('Listening… speak now', 'live');
  } catch {
    setStatus('Could not start listening. Close this window and click Voice again.', 'err');
    dot.classList.add('off');
  }
}

done.addEventListener('click', () => {
  window.clearTimeout(silenceTimer);
  closing = true;
  stop();
  if (committed.trim()) sendTranscript(committed.trim(), true);
  window.close();
});

window.addEventListener('beforeunload', () => {
  window.clearTimeout(silenceTimer);
  closing = true;
  stop();
  if (committed.trim()) sendTranscript(committed.trim(), true);
});

void start();
