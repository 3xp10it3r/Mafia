import { NextResponse } from "next/server";
import { applyAction, createGame, getGameByCode, getGameById, listGames } from "@/lib/game-store";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const roomId = searchParams.get("roomId");
  const roomCode = searchParams.get("roomCode");

  if (roomCode) {
    const room = getGameByCode(roomCode);
    if (!room) {
      return NextResponse.json({ error: "Room not found." }, { status: 404 });
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
        mode: payload.mode,
        mafiaCount: payload.mafiaCount,
        players: payload.players,
        password: payload.password,
        physicalMode: payload.physicalMode,
      });
      return NextResponse.json(room);
    }

    if (action === "join") {
      const room = getGameByCode(payload.roomCode);
      if (!room) {
        return NextResponse.json({ error: "Room code not found." }, { status: 404 });
      }
      if (room.password && room.password !== (payload.password ?? "")) {
        return NextResponse.json({ error: "Incorrect room password." }, { status: 401 });
      }
      if (!room.players.some((player) => player.name === payload.playerName)) {
        return NextResponse.json({ error: "That player name is not in this room." }, { status: 400 });
      }
      return NextResponse.json(room);
    }

    if (action === "mafia-kill" || action === "village-vote" || action === "restart" || action === "mafia-chat") {
      const room = applyAction(payload);
      return NextResponse.json(room);
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
