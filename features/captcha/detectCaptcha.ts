export function captchaPending() {
  if (/just a moment|attention required/i.test(document.title) && document.querySelector('#challenge-form, #cf-challenge-running, [id^="cf-chl"]')) {
    return true;
  }
  const widgets = [
    ...document.querySelectorAll(
      'iframe[src*="recaptcha"], iframe[src*="hcaptcha.com"], iframe[src*="challenges.cloudflare.com"], .g-recaptcha, .h-captcha, .cf-turnstile',
    ),
  ].filter((element) => {
    if (element.closest('.grecaptcha-badge')) return false;
    if (element instanceof HTMLIFrameElement && /size=invisible/.test(element.src)) return false;
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  });
  if (widgets.length === 0) return false;
  const answers = [
    ...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'textarea[name="g-recaptcha-response"], textarea[name="h-captcha-response"], input[name="cf-turnstile-response"]',
    ),
  ];
  return !answers.some((answer) => answer.value.trim());
}
