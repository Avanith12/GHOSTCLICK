import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Ghostclick',
    version: '0.1.4',
    description:
      'Show a website task once, then ask for it again in plain words. Replays, scrapes, and checks pages with a local model that never leaves your computer.',
    permissions: ['sidePanel', 'storage', 'unlimitedStorage', 'tabs', 'downloads', 'scripting', 'audioCapture', 'windows'],
    host_permissions: ['http://*/*', 'https://*/*'],
    action: {
      default_title: 'Open Ghostclick',
    },
    icons: {
      16: 'icon-16.png',
      32: 'icon-32.png',
      48: 'icon-48.png',
      128: 'icon-128.png',
    },
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
  },
});
