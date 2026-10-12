// Phi-3.5 Vision cuts an image into tiles by its shape. A 1400 x 1008 frame gives 1,921 image tokens,
// under WebLLM's 2,048-token limit for one image; a widescreen shot would give 2,353 and fail.
const WIDTH = 1400;
const HEIGHT = 1008;

export async function pageScreenshot(tabId: number) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.active) return null;
  const shot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const image = await createImageBitmap(await (await fetch(shot)).blob());
  const canvas = new OffscreenCanvas(WIDTH, HEIGHT);
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, WIDTH, HEIGHT);
  const scale = Math.min(WIDTH / image.width, HEIGHT / image.height);
  context.drawImage(image, 0, 0, image.width * scale, image.height * scale);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
