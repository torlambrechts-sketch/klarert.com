/* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS preload for tsx --require */
// Preloaded by `pnpm seed:demo` (tsx --require). The demo seed runs the app's own server commands
// (src/server/commands: authorise → validate with the field registry → RPC → automations), as the people of the demo
// workspace, so everything it writes takes the same path as a person in the app. Two things only exist inside
// Next.js's server and are provided here:
// - `server-only`: the guard that keeps server modules out of browser bundles. It resolves to the package's own empty
//   module, exactly as it does in the server build.
// - `next/headers`: the request's cookies, which hold the signed-in person's session. Here they come from a jar the
//   seed fills with the session of the person it is acting as (scripts/demo/session.ts); headers() is empty.
const Module = require('node:module');
const path = require('node:path');

const jar = new Map();
globalThis.__demoCookieJar = jar;

const store = {
  getAll: () => [...jar].map(([name, value]) => ({ name, value })),
  get: (name) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
  has: (name) => jar.has(name),
  set: (nameOrCookie, value) => {
    const c = typeof nameOrCookie === 'string' ? { name: nameOrCookie, value } : nameOrCookie;
    if (c.value) jar.set(c.name, c.value);
    else jar.delete(c.name);
  },
  delete: (name) => jar.delete(typeof name === 'string' ? name : name.name),
};
const shim = path.join(__dirname, 'next-headers.cjs');
globalThis.__demoNextHeaders = {
  cookies: async () => store,
  headers: async () => new Headers(),
  draftMode: async () => ({ isEnabled: false }),
};

const resolve = Module._resolveFilename;
let empty;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'server-only') {
    empty ??= path.join(path.dirname(resolve.call(this, request, ...rest)), 'empty.js');
    return empty;
  }
  if (request === 'next/headers') return shim;
  return resolve.call(this, request, ...rest);
};
