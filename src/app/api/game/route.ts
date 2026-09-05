import { NextResponse } from "next/server";
import { applyAction, createGame, getGameByCode, getGameById, joinPlayerToRoom, listGames } from "@/lib/game-store";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const roomId = searchParams.get("roomId");
  const roomCode = searchParams.get("roomCode");

  if (roomCode) {
    const room = getGameByCode(roomCode);
    if (!room) {
      return NextResponse.json({ error: "Room not found.", field: "joinCode" }, { status: 404 });
    }
    return NextResponse.json(room);
  }

  if (roomId) {
    const room = getGameById(roomId);
    if (!room) {
      return NextResponse.json({ error: "Room not found." }, { status: 404 });
    }
    return NextResponse.json(room);
  }

  return NextResponse.json({ games: listGames() });
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
      return NextResponse.json(room);
    }

    if (action === "join") {
      const room = getGameByCode(payload.roomCode);
      if (!room) {
        return NextResponse.json({ error: "Room code not found.", field: "joinCode" }, { status: 404 });
      }
      if (room.password && room.password !== (payload.password ?? "")) {
        return NextResponse.json({ error: "Incorrect room password.", field: "joinPassword" }, { status: 401 });
      }
      if (!payload.playerName?.trim()) {
        return NextResponse.json({ error: "Player name is required.", field: "joinName" }, { status: 400 });
      }

      const nextRoom = joinPlayerToRoom(room.code, payload.playerName.trim());
      const socketServer = (globalThis as typeof globalThis & { __mafiaSocketServer?: { to: (roomCode: string) => { emit: (event: string, data: unknown) => void } } }).__mafiaSocketServer;
      socketServer?.to(room.code).emit("room:update", nextRoom);
      return NextResponse.json(nextRoom);
    }

    if (action === "mafia-kill" || action === "village-vote" || action === "restart" || action === "start-game") {
      const room = applyAction(payload);
      const socketServer = (globalThis as typeof globalThis & { __mafiaSocketServer?: { to: (roomCode: string) => { emit: (event: string, data: unknown) => void } } }).__mafiaSocketServer;
      socketServer?.to(room.code).emit("room:update", room);
      return NextResponse.json(room);
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return NextResponse.json({ error: message, field: "form" }, { status: 400 });
  }
}
