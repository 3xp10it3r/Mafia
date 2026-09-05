import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { buildRoles, generateRoomCode, getLivingPlayers, getMafiaAlive, getVillagerAlive, type GameState } from "@/lib/game";

const dbPath =
  process.env.SQLITE_DB_PATH ||
  (process.env.NODE_ENV === "production"
    ? path.join("/tmp", "mafia.db")
    : path.join(process.cwd(), "data", "mafia.db"));
const dbDir = path.dirname(dbPath);
fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(dbPath);
db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

function cloneRoom(room: GameState): GameState {
  return structuredClone(room);
}

function toUniqueNames(names: string[]): string[] {
  return Array.from(
    new Set(
      names
        .map((name) => name.trim())
        .filter(Boolean)
        .filter((name, index, array) => array.indexOf(name) === index),
    ),
  );
}

function upsertRoom(room: GameState): GameState {
  const payload = JSON.stringify(room);
  const statement = db.prepare(`
    INSERT INTO rooms (id, code, payload, created_at, updated_at)
    VALUES (@id, @code, @payload, @createdAt, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      code = excluded.code,
      payload = excluded.payload,
      updated_at = excluded.updated_at
  `);

  statement.run({
    id: room.id,
    code: room.code,
    payload,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
  });

  return cloneRoom(room);
}

export function listGames(): GameState[] {
  const rows = db.prepare("SELECT payload FROM rooms ORDER BY updated_at DESC").all() as { payload: string }[];
  return rows.map(({ payload }) => JSON.parse(payload) as GameState);
}

export function getGameById(roomId: string): GameState | undefined {
  const row = db.prepare("SELECT payload FROM rooms WHERE id = ?").get(roomId) as { payload?: string } | undefined;
  return row?.payload ? (JSON.parse(row.payload) as GameState) : undefined;
}

export function getGameByCode(roomCode: string): GameState | undefined {
  const row = db.prepare("SELECT payload FROM rooms WHERE code = ?").get(roomCode.toUpperCase()) as { payload?: string } | undefined;
  return row?.payload ? (JSON.parse(row.payload) as GameState) : undefined;
}

function generateUniqueRoomCode(): string {
  let code = generateRoomCode();
  while (getGameByCode(code)) {
    code = generateRoomCode();
  }
  return code;
}

export function createGame({
  roomName,
  mode,
  mafiaCount,
  players,
  password,
  physicalMode,
}: {
  roomName: string;
  mode: "with-god" | "without-god";
  mafiaCount: number;
  players: string[];
  password?: string;
  physicalMode?: boolean;
}): GameState {
  const names = toUniqueNames(players);
  if (names.length < 3) {
    throw new Error("At least 3 unique player names are required to start a Mafia game.");
  }

  const safeMafiaCount = Math.max(1, Math.min(mafiaCount || 1, names.length - 1));
  const id = `room-${Math.random().toString(36).slice(2, 9)}`;
  const now = new Date().toISOString();
  const builtPlayers = buildRoles(names, safeMafiaCount);
  const room: GameState = {
    id,
    code: generateUniqueRoomCode(),
    roomName: roomName.trim() || "Midnight Mafia Room",
    mode,
    mafiaCount: safeMafiaCount,
    players: builtPlayers,
    phase: "mafia-turn",
    round: 1,
    winner: null,
    godName: mode === "with-god" ? names[0] ?? null : null,
    temporaryModerator: names[0] ?? null,
    votesByPlayer: {},
    votedPlayers: [],
    pendingKillTarget: null,
    log: [
      `${roomName.trim() || "Midnight Mafia Room"} has opened.`,
      mode === "with-god" ? `${names[0]} is the God moderator.` : `${names[0]} is the temporary moderator for this room.`,
    ],
    mafiaChat: [],
    password: password?.trim() ? password.trim() : null,
    physicalMode: Boolean(physicalMode),
    createdAt: now,
    updatedAt: now,
  };

  return upsertRoom(room);
}

function finishRound(room: GameState): void {
  const aliveMafia = getMafiaAlive(room);
  const aliveVillagers = getVillagerAlive(room);

  if (aliveMafia.length === 0) {
    room.winner = "villager";
    room.phase = "game-over";
    room.log.unshift("The mafia has been eliminated. Villagers win.");
    return;
  }

  if (aliveMafia.length >= aliveVillagers.length) {
    room.winner = "mafia";
    room.phase = "game-over";
    room.log.unshift("The mafia has overrun the town. Mafia wins.");
    return;
  }

  room.phase = "mafia-turn";
  room.round += 1;
  room.votesByPlayer = {};
  room.votedPlayers = [];
  room.pendingKillTarget = null;
}

function resolveVotes(room: GameState): void {
  const livingPlayers = getLivingPlayers(room);
  const voteCounts: Record<string, number> = {};

  for (const voter of livingPlayers) {
    const target = room.votesByPlayer[voter.name];
    if (!target) {
      continue;
    }
    voteCounts[target] = (voteCounts[target] ?? 0) + 1;
  }

  const entries = Object.entries(voteCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const winner = entries[0];

  if (!winner || entries.length === 0) {
    room.phase = "mafia-turn";
    room.votesByPlayer = {};
    room.votedPlayers = [];
    room.pendingKillTarget = null;
    room.log.unshift("No clear elimination happened this round.");
    return;
  }

  const second = entries[1];

  if (second && second[1] === winner[1]) {
    room.phase = "mafia-turn";
    room.votesByPlayer = {};
    room.votedPlayers = [];
    room.pendingKillTarget = null;
    room.log.unshift("The vote ended in a tie, so no one was eliminated.");
    return;
  }

  const target = room.players.find((player) => player.name === winner[0]);
  if (!target) {
    room.phase = "mafia-turn";
    room.votesByPlayer = {};
    room.votedPlayers = [];
    room.pendingKillTarget = null;
    room.log.unshift("The town could not resolve the vote.");
    return;
  }

  target.isAlive = false;
  target.wasEliminated = true;
  room.log.unshift(`${target.name} was eliminated by the village with ${winner[1]} votes.`);
  room.phase = "mafia-turn";
  room.votesByPlayer = {};
  room.votedPlayers = [];
  room.pendingKillTarget = null;

  finishRound(room);
}

export function applyAction({
  roomId,
  roomCode,
  action,
  actor,
  target,
  message,
}: {
  roomId?: string;
  roomCode?: string;
  action: "mafia-kill" | "village-vote" | "restart" | "mafia-chat";
  actor?: string;
  target?: string;
  message?: string;
}): GameState {
  const room = roomId ? getGameById(roomId) : roomCode ? getGameByCode(roomCode) : undefined;
  if (!room) {
    throw new Error("Room not found.");
  }

  if (action === "restart") {
    const names = room.players.map((player) => player.name);
    const restartedPlayers = buildRoles(names, room.mafiaCount).map((player) => {
      const previous = room.players.find((entry) => entry.name === player.name);
      return { ...player, avatar: previous?.avatar ?? player.avatar };
    });

    const restartedRoom: GameState = {
      ...room,
      players: restartedPlayers,
      phase: "mafia-turn",
      round: 1,
      winner: null,
      votesByPlayer: {},
      votedPlayers: [],
      pendingKillTarget: null,
      log: [
        `${room.roomName} has been reset. A new game is ready.`,
        room.mode === "with-god" ? `${room.godName ?? names[0]} remains the God moderator.` : `${room.temporaryModerator ?? names[0]} starts as the temporary moderator.`,
      ],
      mafiaChat: [],
      updatedAt: new Date().toISOString(),
    };

    return upsertRoom(restartedRoom);
  }

  if (action === "mafia-chat") {
    if (!actor || !message) {
      throw new Error("A mafia player and message are required.");
    }

    const sender = room.players.find((player) => player.name === actor);
    if (!sender || sender.role !== "mafia") {
      throw new Error("Only mafia players can send mafia chat messages.");
    }

    room.mafiaChat = [...room.mafiaChat, { sender: actor, message: message.trim(), sentAt: new Date().toISOString() }].slice(-20);
    room.updatedAt = new Date().toISOString();
    return upsertRoom(room);
  }

  if (action === "mafia-kill") {
    if (!actor || !target) {
      throw new Error("A mafia player and target are required.");
    }
    if (room.phase !== "mafia-turn") {
      throw new Error("The mafia can act only during the mafia turn.");
    }

    const mafiaActor = room.players.find((player) => player.name === actor);
    const targetPlayer = room.players.find((player) => player.name === target);

    if (!mafiaActor || mafiaActor.role !== "mafia") {
      throw new Error("Only mafia members may perform a mafia kill.");
    }

    if (!targetPlayer || !targetPlayer.isAlive) {
      throw new Error("The target must be alive.");
    }

    room.pendingKillTarget = target;
    room.phase = "village-vote";
    room.updatedAt = new Date().toISOString();
    room.log.unshift(`${mafiaActor.name} marked ${targetPlayer.name} for the mafia hit.`);
    return upsertRoom(room);
  }

  if (action === "village-vote") {
    if (!actor || !target) {
      throw new Error("A voter and target are required.");
    }
    if (room.phase !== "village-vote") {
      throw new Error("Voting is only open during the village vote phase.");
    }

    const player = room.players.find((entry) => entry.name === actor);
    const targetPlayer = room.players.find((entry) => entry.name === target);

    if (!player || !player.isAlive) {
      throw new Error("Only alive players can vote.");
    }

    if (!targetPlayer || !targetPlayer.isAlive) {
      throw new Error("The vote target must be alive.");
    }

    if (actor === target) {
      throw new Error("A player cannot vote for themselves.");
    }

    if (room.votedPlayers.includes(actor)) {
      throw new Error("This player has already voted in this round.");
    }

    room.votesByPlayer[actor] = target;
    room.votedPlayers.push(actor);
    room.updatedAt = new Date().toISOString();
    room.log.unshift(`${actor} voted to eliminate ${target}.`);

    const totalAlivePlayers = getLivingPlayers(room).length;
    if (room.votedPlayers.length >= totalAlivePlayers) {
      resolveVotes(room);
    }

    return upsertRoom(room);
  }

  throw new Error("Unsupported action.");
}
