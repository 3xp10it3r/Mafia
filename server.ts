import { createServer } from "node:http";
import { parse } from "node:url";
import next from "next";
import { Server } from "socket.io";
import { applyAction, getGameByCode } from "./src/lib/game-store";

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

  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  (globalThis as typeof globalThis & { __mafiaSocketServer?: typeof io }).__mafiaSocketServer = io;

  io.on("connection", (socket) => {
    socket.on(
      "room:join",
      ({ roomCode, playerName, password }: { roomCode?: string; playerName?: string; password?: string }) => {
        const code = roomCode?.trim().toUpperCase();
        const name = playerName?.trim();

        if (!code || !name) {
          socket.emit("room:error", { message: "Room code and player name are required." });
          return;
        }

        const room = getGameByCode(code);
        if (!room) {
          socket.emit("room:error", { message: "Room not found." });
          return;
        }

        if (room.password && room.password !== (password ?? "")) {
          socket.emit("room:error", { message: "Incorrect room password." });
          return;
        }

        if (!room.players.some((player) => player.name === name)) {
          socket.emit("room:error", { message: "Player name not found in this room." });
          return;
        }

        socket.join(code);
        socket.data.roomCode = code;
        socket.data.playerName = name;
        socket.emit("room:update", room);
      },
    );

    socket.on(
      "room:action",
      (payload: {
        roomCode?: string;
        roomId?: string;
        action: "mafia-kill" | "village-vote" | "restart" | "start-game" | "transfer-moderator";
        actor?: string;
        target?: string;
        message?: string;
      }) => {
        try {
          const requestedRoomCode = payload.roomCode?.trim().toUpperCase();
          if (!requestedRoomCode || socket.data.roomCode !== requestedRoomCode || socket.data.playerName !== payload.actor) {
            throw new Error("This socket is not authorized for that room action.");
          }

          const nextRoom = applyAction(payload);
          const roomCode = requestedRoomCode;
          io.to(roomCode).emit("room:update", nextRoom);
        } catch (error) {
          socket.emit("room:error", {
            message: error instanceof Error ? error.message : "Unable to update the room.",
          });
        }
      },
    );
  });

  httpServer.listen(port, hostname, () => {
    console.log(`> Ready on http://localhost:${port}`);
  });
});
