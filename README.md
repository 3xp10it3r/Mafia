# Mafia Game Room

A realtime, room-based Mafia game built with Next.js, Socket.IO, and SQLite.

## Deployment requirement

This app uses a custom Node server (`server.ts`) for Socket.IO and writes room state to SQLite. Deploy it on a persistent Node host such as Railway, Render, Fly.io, or a VPS. Netlify's serverless filesystem and isolated function instances cannot provide durable shared SQLite state or a shared Socket.IO process, so rooms can disappear or fail to broadcast there.

For production, set `SQLITE_DB_PATH` to a persistent mounted path or replace the SQLite store with a hosted database. The client also polls the room API as a fallback when WebSocket delivery is unavailable.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
