import { api } from './cloud-handler.mjs';
import assets from './assets.generated.mjs';
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return api(request, env, ctx);
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
    const asset = assets[url.pathname === '/' ? '/index.html' : url.pathname];
    if (!asset) return new Response('Not found', { status: 404 });
    const body = asset.base64 ? Uint8Array.from(atob(asset.base64), c => c.charCodeAt(0)) : asset.content;
    return new Response(request.method === 'HEAD' ? null : body, { headers: {
      'Content-Type': asset.type, 'Cache-Control': asset.base64 ? 'public, max-age=31536000, immutable' : 'no-cache', 'X-Content-Type-Options': 'nosniff',
    } });
  },
};
