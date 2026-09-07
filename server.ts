import { createServer } from "node:http";
import { parse } from "node:url";
import next from "next";
import { Server } from "socket.io";
import { applyAction, getGameByCode, projectGame } from "./src/lib/game-store";
import { allowRate, parseSessionCookie, validName, validRoomCode } from "./src/lib/security";
import { getPlayerSession } from "./src/lib/game-store";
import type { GameAction } from "./src/lib/game";

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = Number(process.env.PORT || 3000);
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url ?? "/", true);
    handle(req, res, parsedUrl);
  });

  const allowedOrigin = process.env.ALLOWED_ORIGIN?.trim();
  const io = new Server(httpServer, {
    cors: {
      origin: allowedOrigin || false,
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ["websocket", "polling"],
    maxHttpBufferSize: 16 * 1024,
  });

  const broadcastRoom = async (roomCode: string, event: "room:update" | "room:closed", room?: ReturnType<typeof getGameByCode>) => {
    if (event === "room:closed") {
      io.to(roomCode).emit(event);
      return;
    }
    if (!room) return;
    const sockets = await io.in(roomCode).fetchSockets();
    for (const connectedSocket of sockets) {
      const playerName = connectedSocket.data.playerName as string | undefined;
      if (playerName) connectedSocket.emit(event, projectGame(room, playerName));
    }
  };

  (globalThis as typeof globalThis & {
    __mafiaSocketServer?: typeof io & { broadcastRoom?: typeof broadcastRoom };
  }).__mafiaSocketServer = Object.assign(io, { broadcastRoom });

  io.on("connection", (socket) => {
    const session = () => getPlayerSession(parseSessionCookie(socket.handshake.headers.cookie));
    const reject = (message: string) => socket.emit("room:error", { message });

    socket.on("room:join", (payload: { roomCode?: string }) => {
      if (!allowRate(`socket-join:${socket.handshake.address}`, 20, 60_000)) return reject("Too many requests.");
      const activeSession = session();
      const code = payload?.roomCode?.trim().toUpperCase();
      if (!activeSession || !validRoomCode(code) || activeSession.roomCode !== code) return reject("Room session required.");
      const room = getGameByCode(code);
      if (!room || !room.players.some((player) => player.name === activeSession.playerName)) return reject("Room session is no longer valid.");
      socket.join(code);
      socket.data.roomCode = code;
      socket.data.playerName = activeSession.playerName;
      socket.emit("room:update", projectGame(room, activeSession.playerName));
    });

    socket.on(
      "room:action",
      (payload: { roomCode?: string; action?: string; target?: string }) => {
        try {
          if (!allowRate(`socket-action:${socket.handshake.address}`, 60, 60_000)) throw new Error("Too many actions. Try again shortly.");
          const activeSession = session();
          const code = payload?.roomCode?.trim().toUpperCase();
          if (!activeSession || !validRoomCode(code) || activeSession.roomCode !== code || socket.data.roomCode !== code) {
            throw new Error("This socket is not authorized for that room action.");
          }
          const supportedActions: GameAction[] = ["mafia-kill", "declare-innocent", "village-suspect", "village-vote", "restart", "start-game", "transfer-moderator"];
          if (!supportedActions.includes(payload.action as GameAction)) {
            throw new Error("Unsupported action.");
          }
          const nextRoom = applyAction({
            roomCode: code,
            action: payload.action as GameAction,
            actor: activeSession.playerName,
            target: validName(payload.target) ? payload.target.trim() : undefined,
          });
          void broadcastRoom(code, "room:update", nextRoom);
        } catch (error) {
          reject(error instanceof Error ? error.message : "Unable to update the room.");
        }
      },
    );
  });

  httpServer.listen(port, hostname, () => {
    console.log(`> Ready on http://localhost:${port}`);
  });
});
