import { NextResponse } from "next/server";
import { applyAction, createGame, deleteRoom, getGameByCode, getGameById, joinPlayerToRoom, leavePlayerFromRoom, listGames } from "@/lib/game-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStore = { "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate" };

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const roomId = searchParams.get("roomId");
  const roomCode = searchParams.get("roomCode");

  if (roomCode) {
    const room = getGameByCode(roomCode);
    if (!room) {
      return NextResponse.json({ error: "Room not found.", field: "joinCode" }, { status: 404, headers: noStore });
    }
    return NextResponse.json(room, { headers: noStore });
  }

  if (roomId) {
    const room = getGameById(roomId);
    if (!room) {
      return NextResponse.json({ error: "Room not found." }, { status: 404, headers: noStore });
    }
    return NextResponse.json(room, { headers: noStore });
  }

  return NextResponse.json({ games: listGames() }, { headers: noStore });
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const { action } = payload;

    if (action === "create") {
      const room = createGame({
        roomName: payload.roomName,
        mode: "without-god",
        mafiaCount: payload.mafiaCount,
        moderatorName: payload.moderatorName,
        players: Array.isArray(payload.players) ? payload.players : [],
        password: payload.password,
        physicalMode: payload.physicalMode,
      });

      const socketServer = (globalThis as typeof globalThis & { __mafiaSocketServer?: { to: (roomCode: string) => { emit: (event: string, data: unknown) => void } } }).__mafiaSocketServer;
      socketServer?.to(room.code).emit("room:update", room);
      return NextResponse.json(room, { headers: noStore });
    }

    if (action === "join") {
      const room = getGameByCode(payload.roomCode);
      if (!room) {
        return NextResponse.json({ error: "Room code not found.", field: "joinCode" }, { status: 404, headers: noStore });
      }
      if (room.password && room.password !== (payload.password ?? "")) {
        return NextResponse.json({ error: "Incorrect room password.", field: "joinPassword" }, { status: 401, headers: noStore });
      }
      if (!payload.playerName?.trim()) {
        return NextResponse.json({ error: "Player name is required.", field: "joinName" }, { status: 400, headers: noStore });
      }

      const nextRoom = joinPlayerToRoom(room.code, payload.playerName.trim());
      const socketServer = (globalThis as typeof globalThis & { __mafiaSocketServer?: { to: (roomCode: string) => { emit: (event: string, data: unknown) => void } } }).__mafiaSocketServer;
      socketServer?.to(room.code).emit("room:update", nextRoom);
      return NextResponse.json(nextRoom, { headers: noStore });
    }

    if (action === "leave-room") {
      const room = getGameByCode(payload.roomCode);
      if (!room) {
        return NextResponse.json({ error: "Room not found." }, { status: 404, headers: noStore });
      }
      const nextRoom = leavePlayerFromRoom(room.code, payload.actor);
      const socketServer = (globalThis as typeof globalThis & { __mafiaSocketServer?: { to: (roomCode: string) => { emit: (event: string, data?: unknown) => void } } }).__mafiaSocketServer;
      if (!nextRoom) {
        socketServer?.to(room.code).emit("room:closed");
        return NextResponse.json({ closed: true }, { headers: noStore });
      }
      socketServer?.to(room.code).emit("room:update", nextRoom);
      return NextResponse.json(nextRoom, { headers: noStore });
    }

    if (action === "quit-room") {
      const room = getGameByCode(payload.roomCode);
      if (!room) {
        return NextResponse.json({ error: "Room not found." }, { status: 404, headers: noStore });
      }
      if (room.temporaryModerator !== payload.actor) {
        return NextResponse.json({ error: "Only the moderator can close this game." }, { status: 403, headers: noStore });
      }
      deleteRoom(room.code);
      const socketServer = (globalThis as typeof globalThis & { __mafiaSocketServer?: { to: (roomCode: string) => { emit: (event: string, data?: unknown) => void } } }).__mafiaSocketServer;
      socketServer?.to(room.code).emit("room:closed");
      return NextResponse.json({ closed: true }, { headers: noStore });
    }

    if (action === "mafia-kill" || action === "village-vote" || action === "restart" || action === "start-game" || action === "transfer-moderator") {
      const room = applyAction(payload);
      const socketServer = (globalThis as typeof globalThis & { __mafiaSocketServer?: { to: (roomCode: string) => { emit: (event: string, data: unknown) => void } } }).__mafiaSocketServer;
      socketServer?.to(room.code).emit("room:update", room);
      return NextResponse.json(room, { headers: noStore });
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400, headers: noStore });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return NextResponse.json({ error: message, field: "form" }, { status: 400, headers: noStore });
  }
}
