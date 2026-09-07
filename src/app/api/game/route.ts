import { NextResponse } from "next/server";
import {
  applyAction,
  createGame,
  createPlayerSession,
  deleteRoom,
  getGameByCode,
  getGameById,
  joinPlayerToRoom,
  leavePlayerFromRoom,
  listGames,
  projectGame,
  toPublicRoomSummary,
  verifyRoomPassword,
} from "@/lib/game-store";
import {
  allowRate,
  clientAddress,
  MAX_BODY_BYTES,
  requestHasValidOrigin,
  sessionFromRequest,
  validName,
  validPassword,
  validRoomCode,
  SESSION_COOKIE,
} from "@/lib/security";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStore = { "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate", Vary: "Cookie" };

function errorResponse(message: string, status = 400, field?: string) {
  return NextResponse.json({ error: message, ...(field ? { field } : {}) }, { status, headers: noStore });
}

function withSession(response: NextResponse, token: string): NextResponse {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}

function emitRoomUpdate(roomCode: string, event: "room:update" | "room:closed", room?: ReturnType<typeof getGameByCode>) {
  const socketServer = (globalThis as typeof globalThis & {
    __mafiaSocketServer?: { broadcastRoom?: (code: string, event: string, room?: unknown) => void; to: (code: string) => { emit: (event: string, data?: unknown) => void } };
  }).__mafiaSocketServer;
  if (socketServer?.broadcastRoom) socketServer.broadcastRoom(roomCode, event, room);
  else if (event === "room:closed") socketServer?.to(roomCode).emit(event);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const roomId = searchParams.get("roomId");
  const roomCode = searchParams.get("roomCode")?.trim().toUpperCase();

  if (roomCode || roomId) {
    const session = sessionFromRequest(request);
    if (!session || (roomCode && session.roomCode !== roomCode)) return errorResponse("Room session required.", 401);
    const room = roomCode ? getGameByCode(roomCode) : getGameById(roomId as string);
    if (!room || session.roomCode !== room.code || !room.players.some((player) => player.name === session.playerName)) {
      return errorResponse("Room not found.", 404, "joinCode");
    }
    return NextResponse.json(projectGame(room, session.playerName), { headers: noStore });
  }

  if (!allowRate(`rooms:${clientAddress(request)}`, 60, 60_000)) return errorResponse("Too many requests. Try again shortly.", 429);
  return NextResponse.json({ games: listGames().map(toPublicRoomSummary) }, { headers: noStore });
}

export async function POST(request: Request) {
  const address = clientAddress(request);
  if (!requestHasValidOrigin(request)) return errorResponse("Invalid request origin.", 403);
  if (!allowRate(`write:${address}`, 120, 60_000)) return errorResponse("Too many requests. Try again shortly.", 429);

  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) return errorResponse("Request is too large.", 413);
    const payload = JSON.parse(body);
    if (!payload || typeof payload !== "object" || typeof payload.action !== "string") return errorResponse("Invalid request.");
    const action = payload.action as string;

    if (action === "create") {
      if (!allowRate(`create:${address}`, 10, 10 * 60_000)) return errorResponse("Too many room attempts. Try again later.", 429);
      if (!validName(payload.moderatorName)) return errorResponse("Player name is invalid.", 400, "moderatorName");
      if (!validPassword(payload.password)) return errorResponse("Room password must be 8–128 characters.", 400, "roomPassword");
      const room = createGame({ mode: "without-god", moderatorName: payload.moderatorName, players: [], password: payload.password });
      const token = createPlayerSession(room.code, payload.moderatorName.trim());
      emitRoomUpdate(room.code, "room:update", room);
      return withSession(NextResponse.json(projectGame(room, payload.moderatorName.trim()), { headers: noStore }), token);
    }

    if (action === "join") {
      if (!allowRate(`join:${address}`, 20, 10 * 60_000)) return errorResponse("Too many join attempts. Try again later.", 429);
      if (!validRoomCode(payload.roomCode)) return errorResponse("Room code is invalid.", 400, "joinCode");
      if (!validName(payload.playerName)) return errorResponse("Player name is invalid.", 400, "joinName");
      if (!validPassword(payload.password)) return errorResponse("Room password must be 8–128 characters.", 400, "joinPassword");
      const room = getGameByCode(payload.roomCode.trim().toUpperCase());
      if (!room) return errorResponse("Room code not found.", 404, "joinCode");
      if (!verifyRoomPassword(payload.password, room.passwordHash)) return errorResponse("Incorrect room password.", 401, "joinPassword");
      const nextRoom = joinPlayerToRoom(room.code, payload.playerName.trim());
      const player = nextRoom.players.find((entry) => entry.name.toLowerCase() === payload.playerName.trim().toLowerCase());
      if (!player) return errorResponse("Player could not join this room.", 400, "joinName");
      const token = createPlayerSession(nextRoom.code, player.name);
      emitRoomUpdate(nextRoom.code, "room:update", nextRoom);
      return withSession(NextResponse.json(projectGame(nextRoom, player.name), { headers: noStore }), token);
    }

    const session = sessionFromRequest(request);
    if (!session || !validRoomCode(payload.roomCode) || session.roomCode !== payload.roomCode.trim().toUpperCase()) return errorResponse("Room session required.", 401);
    const room = getGameByCode(session.roomCode);
    if (!room || !room.players.some((player) => player.name === session.playerName)) return errorResponse("Room session is no longer valid.", 401);

    if (action === "leave-room") {
      const nextRoom = leavePlayerFromRoom(room.code, session.playerName);
      emitRoomUpdate(room.code, nextRoom ? "room:update" : "room:closed", nextRoom ?? undefined);
      return NextResponse.json(nextRoom ? projectGame(nextRoom, session.playerName) : { closed: true }, { headers: noStore });
    }

    if (action === "quit-room") {
      if (room.temporaryModerator !== session.playerName) return errorResponse("Only the moderator can close this game.", 403);
      deleteRoom(room.code);
      emitRoomUpdate(room.code, "room:closed");
      return NextResponse.json({ closed: true }, { headers: noStore });
    }

    if (["mafia-kill", "declare-innocent", "village-suspect", "village-vote", "restart", "start-game", "transfer-moderator"].includes(action)) {
      const nextRoom = applyAction({
        action: action as
          | "mafia-kill"
          | "declare-innocent"
          | "village-suspect"
          | "village-vote"
          | "restart"
          | "start-game"
          | "transfer-moderator",
        roomCode: room.code,
        actor: session.playerName,
        target: validName(payload.target) ? payload.target.trim() : undefined,
      });
      emitRoomUpdate(nextRoom.code, "room:update", nextRoom);
      return NextResponse.json(projectGame(nextRoom, session.playerName), { headers: noStore });
    }

    return errorResponse("Unsupported action.");
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Something went wrong.");
  }
}
