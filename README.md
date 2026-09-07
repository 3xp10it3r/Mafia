# Mafia Game Room

Realtime, password-protected Mafia rooms built with Next.js, Socket.IO, and SQLite.

## Local development

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. Room passwords must be 8–128 characters. The development database defaults to `./data/mafia.db`.

## Railway deployment

1. Create a Railway service from this repository.
2. Add a Railway Volume and mount it at `/data`.
3. Set these service variables:

```bash
NODE_ENV=production
SQLITE_DB_PATH=/data/mafia.db
ALLOWED_ORIGIN=https://your-public-domain.up.railway.app
```

Use the exact public URL assigned by Railway for `ALLOWED_ORIGIN` (including `https://`, with no trailing slash). Railway provides `PORT` automatically; do not hard-code it.

The build command is `npm run build` and the start command is `npm run start`. The Volume is required because the container filesystem is ephemeral; without it, the SQLite database and all rooms can be lost on redeploy or restart. Do not commit `data/mafia.db`, `data/mafia.db-wal`, or `data/mafia.db-shm`.

## Other production deployments

Run the custom Node server on a single persistent Node host (Railway, Render, Fly.io, or a VPS). Do not deploy this app as serverless functions: SQLite and the Socket.IO process must be shared and persistent.

Required environment:

```bash
NODE_ENV=production
PORT=3000
SQLITE_DB_PATH=/var/lib/mafia/mafia.db
ALLOWED_ORIGIN=https://mafia.example.com
```

`SQLITE_DB_PATH` must be an absolute path on a persistent writable volume and must not be `/tmp`. Create and permission the parent directory before starting the service. `ALLOWED_ORIGIN` should be the exact public origin (scheme and host) used by browsers.

The server stores only scrypt password hashes and SHA-256 hashes of short-lived player session tokens. Sessions are delivered in Secure, HttpOnly, SameSite cookies. HTTP actions and Socket.IO actions use the same session authorization. WebSockets are the primary update transport; HTTP polling is only a 30-second fallback when a socket is disconnected.

```bash
npm run build
npm run start
```

`npm run lint` and `npx tsc --noEmit` are useful pre-deployment checks. The SQLite file and its volume should be backed up using the host's normal persistent-volume process.
