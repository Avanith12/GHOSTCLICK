async function ping(tabId: number) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'PING' }, { frameId: 0 });
    return Boolean(response?.ok);
  } catch {
    return false;
  }
}

export async function reachTab(tabId: number) {
  if (await ping(tabId)) return true;
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['/content-scripts/content.js'] });
  } catch {
    return false;
  }
  return ping(tabId);
}
