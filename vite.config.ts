import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'cors-proxy',
      configureServer(server) {
        server.middlewares.use('/shellos/proxy/', (req, res) => {
          const target = decodeURIComponent(req.url?.slice(1) || '');
          if (!target) { res.statusCode = 400; res.end('Missing URL'); return; }
          fetch(target)
            .then(async (r) => {
              const contentType = r.headers.get('content-type') || 'text/html';
              res.setHeader('Content-Type', contentType);
              res.statusCode = r.status;
              let body = await r.text();
              // For HTML responses, inject base tag + navigation script
              if (contentType.includes('html')) {
                let origin: string;
                try { origin = new URL(target).origin; } catch { origin = ''; }
                const injection = `<base href="${origin}/">` +
                  `<script>(function(){` +
                  `document.addEventListener('click',function(e){` +
                  `var a=e.target;while(a&&a.tagName!=='A')a=a.parentElement;` +
                  `if(!a||!a.href)return;` +
                  `var h=a.href;` +
                  `if(h.startsWith('javascript:'))return;` +
                  `e.preventDefault();e.stopImmediatePropagation();` +
                  `parent.postMessage({type:'shellos-navigate',url:h},'*');` +
                  `},true);` +
                  `document.addEventListener('submit',function(e){` +
                  `e.preventDefault();e.stopImmediatePropagation();` +
                  `var f=e.target,action=f.action||location.href;` +
                  `var d=new URLSearchParams(new FormData(f));` +
                  `parent.postMessage({type:'shellos-navigate',url:action+'?'+d},'*');` +
                  `},true);` +
                  `})()</script>`;
                if (body.includes('<head>')) {
                  body = body.replace('<head>', '<head>' + injection);
                } else if (body.includes('<HEAD>')) {
                  body = body.replace('<HEAD>', '<HEAD>' + injection);
                } else {
                  body = injection + body;
                }
              }
              res.end(body);
            })
            .catch(() => {
              res.statusCode = 502;
              res.end('Proxy error');
            });
        });
      },
    },
  ],
  base: '/shellos/',
  assetsInclude: ['**/*.frag', '**/*.vert'],
  server: {
    host: true,
    allowedHosts: ['chriss-macbook-pro.local'],
  },
})