// Local plain-HTTP relay -> Supabase. Chromium can't do TLS through this
// sandbox's proxy, but Node can (with the CA bundle, fully verified). So the
// browser talks HTTP to localhost and Node does the real, verified TLS hop.
// Sandbox-only test scaffolding; nothing here relaxes certificate checking.
import { createServer } from 'node:http';
const UPSTREAM = 'https://wpkdpukpllxuyqqlxkxf.supabase.co';
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'access-control-expose-headers': '*',
};
createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  const chunks = []; for await (const c of req) chunks.push(c);
  const headers = { ...req.headers }; delete headers.host; delete headers.connection;
  try {
    const r = await fetch(UPSTREAM + req.url, {
      method: req.method, headers,
      body: ['GET','HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
      redirect: 'manual',
    });
    const out = Object.fromEntries(r.headers);
    delete out['content-encoding']; delete out['transfer-encoding']; delete out['content-length'];
    res.writeHead(r.status, { ...out, ...CORS });
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    res.writeHead(502, CORS); res.end(JSON.stringify({ relay_error: String(e) }));
  }
}).listen(8090, () => console.log('relay on 8090'));
