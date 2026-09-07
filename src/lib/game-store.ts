import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { AVATAR_POOL, buildRoles, generateRoomCode, getLivingPlayers, getMafiaAlive, getVillagerAlive, randomRoomName, type GameState } from "@/lib/game";

const configuredDbPath = process.env.SQLITE_DB_PATH?.trim();
const isBuild = process.env.NEXT_PHASE === "phase-production-build";
if (process.env.NODE_ENV === "production" && !isBuild && !configuredDbPath) {
  throw new Error("SQLITE_DB_PATH must be set to an absolute persistent path in production.");
}
const dbPath = isBuild ? ":memory:" : configuredDbPath || path.join(process.cwd(), "data", "mafia.db");
const resolvedDbPath = path.resolve(dbPath);
if (!isBuild && (!path.isAbsolute(dbPath) || resolvedDbPath === path.parse(dbPath).root || resolvedDbPath === "/tmp" || resolvedDbPath.startsWith("/tmp/"))) {
  throw new Error("SQLITE_DB_PATH must be an absolute path outside /tmp and must point to a file.");
}
const dbDir = path.dirname(dbPath);
if (!isBuild) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");
db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    room_code TEXT NOT NULL,
    player_name TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_expires_at ON sessions (expires_at);
`);

export interface StoredGameState extends GameState {
  passwordHash: string;
}

export interface PlayerSession {
  roomCode: string;
  playerName: string;
  expiresAt: number;
}

export interface PublicRoomSummary {
  id: string;
  code: string;
  roomName: string;
  mode: GameState["mode"];
  phase: GameState["phase"];
  winner: GameState["winner"];
  playerCount: number;
  hasPassword: boolean;
  physicalMode: boolean;
  updatedAt: string;
}

function cloneRoom(room: StoredGameState): StoredGameState {
  return structuredClone(room);
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("base64url");
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString("base64url")}`;
}

export function verifyRoomPassword(password: string, passwordHash: string): boolean {
  const [, salt, encodedHash] = passwordHash.split("$");
  if (!salt || !encodedHash) return false;
  try {
    const expected = Buffer.from(encodedHash, "base64url");
    const actual = scryptSync(password, salt, expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function normalizeStoredRoom(raw: GameState & { password?: string | null; passwordHash?: string }): StoredGameState {
  const legacyPassword = raw.password;
  const passwordHash = raw.passwordHash || (legacyPassword ? hashPassword(legacyPassword) : "");
  const room = {
    ...raw,
    passwordHash,
    mafiaAliveCount: raw.mafiaAliveCount ?? raw.players.filter((player) => player.role === "mafia" && player.isAlive).length,
    villagerAliveCount: raw.villagerAliveCount ?? raw.players.filter((player) => player.role === "villager" && player.isAlive).length,
    votesCast: raw.votesCast ?? Object.keys(raw.votesByPlayer ?? {}).length,
    revealedMafiaNames: raw.revealedMafiaNames ?? [],
  } as StoredGameState;
  delete (room as GameState & { password?: string }).password;
  if (legacyPassword) {
    db.prepare("UPDATE rooms SET payload = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(room), room.updatedAt, room.id);
  }
  return room;
}

function parseRoom(payload: string): StoredGameState {
  return normalizeStoredRoom(JSON.parse(payload) as GameState & { password?: string | null; passwordHash?: string });
}

if (process.env.NEXT_PHASE !== "phase-production-build") {
  for (const row of db.prepare("SELECT payload FROM rooms").all() as { payload: string }[]) {
    parseRoom(row.payload);
  }
}

export function projectGame(room: StoredGameState, viewerName: string): GameState {
  const revealRoles = room.phase === "game-over" || (room.mode === "with-god" && viewerName === room.godName);
  const { passwordHash, ...publicRoom } = cloneRoom(room);
  void passwordHash;
  return {
    ...publicRoom,
    players: room.players.map((player) => ({
      ...player,
      role: revealRoles || player.name === viewerName ? player.role : null,
    })),
    votesByPlayer: {},
    votedPlayers: room.votedPlayers.includes(viewerName) ? [viewerName] : [],
    pendingKillTarget: null,
    mafiaChat: [],
    revealedMafiaNames: revealRoles ? room.players.filter((player) => player.role === "mafia").map((player) => player.name) : [],
  };
}

export function toPublicRoomSummary(room: StoredGameState): PublicRoomSummary {
  return {
    id: room.id,
    code: room.code,
    roomName: room.roomName,
    mode: room.mode,
    phase: room.phase,
    winner: room.winner,
    playerCount: room.players.length,
    hasPassword: Boolean(room.passwordHash),
    physicalMode: room.physicalMode,
    updatedAt: room.updatedAt,
  };
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

export function upsertRoom(room: StoredGameState): StoredGameState {
  updateCounts(room);
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

export function listGames(): StoredGameState[] {
  const rows = db.prepare("SELECT payload FROM rooms ORDER BY updated_at DESC LIMIT 100").all() as { payload: string }[];
  return rows.map(({ payload }) => parseRoom(payload));
}

export function getGameById(roomId: string): StoredGameState | undefined {
  const row = db.prepare("SELECT payload FROM rooms WHERE id = ?").get(roomId) as { payload?: string } | undefined;
  return row?.payload ? parseRoom(row.payload) : undefined;
}

export function getGameByCode(roomCode: string): StoredGameState | undefined {
  const row = db.prepare("SELECT payload FROM rooms WHERE code = ?").get(roomCode.toUpperCase()) as { payload?: string } | undefined;
  return row?.payload ? parseRoom(row.payload) : undefined;
}

export function deleteRoom(roomCode: string): void {
  db.prepare("DELETE FROM rooms WHERE code = ?").run(roomCode.toUpperCase());
}

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createPlayerSession(roomCode: string, playerName: string): string {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
  db.prepare(
    "INSERT INTO sessions (token_hash, room_code, player_name, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(hashSessionToken(token), roomCode, playerName, now + SESSION_TTL_MS, now);
  return token;
}

export function getPlayerSession(token: string | undefined): PlayerSession | undefined {
  if (!token) return undefined;
  const row = db.prepare("SELECT room_code, player_name, expires_at FROM sessions WHERE token_hash = ?").get(hashSessionToken(token)) as
    | { room_code: string; player_name: string; expires_at: number }
    | undefined;
  if (!row) return undefined;
  if (row.expires_at <= Date.now()) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashSessionToken(token));
    return undefined;
  }
  return { roomCode: row.room_code, playerName: row.player_name, expiresAt: row.expires_at };
}

export function deletePlayerSession(token: string | undefined): void {
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashSessionToken(token));
}

function updateCounts(room: StoredGameState): void {
  room.mafiaAliveCount = getMafiaAlive(room).length;
  room.villagerAliveCount = getVillagerAlive(room).length;
  room.votesCast = Object.keys(room.votesByPlayer).length;
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
  moderatorName,
  players,
  password,
}: {
  roomName?: string;
  mode: "with-god" | "without-god";
  moderatorName?: string;
  players?: string[];
  password?: string;
}): StoredGameState {
  const creatorName = (moderatorName ?? players?.[0] ?? "").trim();
  if (!creatorName) {
    throw new Error("A moderator name is required to create a room.");
  }
  const normalizedPassword = password?.trim() ?? "";
  if (!normalizedPassword) {
    throw new Error("A room password is required.");
  }

  const allNames = toUniqueNames([creatorName, ...(players ?? [])]);
  const id = `room-${randomUUID()}`;
  const now = new Date().toISOString();
  const generatedRoomName = (roomName ?? "").trim() || randomRoomName();
  const playerList: GameState["players"] = allNames.map((name) => ({
    name,
    role: "villager",
    isAlive: true,
    avatar: AVATAR_POOL[Math.abs(name.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0)) % AVATAR_POOL.length],
  }));

  const room: StoredGameState = {
    id,
    code: generateUniqueRoomCode(),
    roomName: generatedRoomName,
    mode,
    players: playerList,
    phase: "lobby",
    round: 0,
    winner: null,
    godName: mode === "with-god" ? creatorName : null,
    temporaryModerator: creatorName,
    votesByPlayer: {},
    votedPlayers: [],
    pendingKillTarget: null,
    log: [
      `${generatedRoomName} is waiting for players.`,
      mode === "with-god" ? `${creatorName} is the God moderator.` : `${creatorName} is the temporary moderator for this room.`,
    ],
    mafiaChat: [],
    passwordHash: hashPassword(normalizedPassword),
    physicalMode: true,
    createdAt: now,
    updatedAt: now,
    mafiaAliveCount: 0,
    villagerAliveCount: playerList.length,
    votesCast: 0,
    revealedMafiaNames: [],
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

function updateWinnerState(room: GameState): boolean {
  const aliveMafia = getMafiaAlive(room);
  const aliveVillagers = getVillagerAlive(room);

  if (aliveMafia.length === 0) {
    room.winner = "villager";
    room.phase = "game-over";
    room.log.unshift("The mafia has been eliminated. Villagers win.");
    return true;
  }

  if (aliveMafia.length >= aliveVillagers.length) {
    room.winner = "mafia";
    room.phase = "game-over";
    room.log.unshift("The mafia has overrun the town. Mafia wins.");
    return true;
  }

  return false;
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

export function joinPlayerToRoom(roomCode: string, playerName: string): StoredGameState {
  return db.transaction(() => {
  const room = getGameByCode(roomCode);
  if (!room) {
    throw new Error("Room not found.");
  }

  if (room.phase !== "lobby") {
    throw new Error("This room has already started.");
  }
  if (room.players.some((player) => player.name.toLowerCase() === playerName.toLowerCase())) {
    return room;
  }

  const nextRoom: StoredGameState = {
    ...room,
    players: [
      ...room.players,
      {
        name: playerName,
        role: "villager",
        isAlive: true,
        avatar: AVATAR_POOL[(room.players.length + room.players.length * 3) % AVATAR_POOL.length],
      },
    ],
    log: [...room.log, `${playerName} joined the lobby.`],
    updatedAt: new Date().toISOString(),
  };

  return upsertRoom(nextRoom);
  })();
}

export function leavePlayerFromRoom(roomCode: string, playerName: string): StoredGameState | null {
  return db.transaction(() => {
  const room = getGameByCode(roomCode);
  if (!room) {
    throw new Error("Room not found.");
  }
  const player = room.players.find((entry) => entry.name.toLowerCase() === playerName.toLowerCase());
  if (!player) {
    throw new Error("Player is not in this room.");
  }
  if (player.role === "mafia" || player.name === room.temporaryModerator) {
    deleteRoom(room.code);
    return null;
  }

  const remainingPlayers = room.players.filter((entry) => entry.name !== player.name);
  if (remainingPlayers.length === 0) {
    deleteRoom(room.code);
    return null;
  }

  const nextRoom: StoredGameState = {
    ...room,
    players: remainingPlayers,
    temporaryModerator: room.temporaryModerator === player.name ? remainingPlayers[0]?.name ?? null : room.temporaryModerator,
    log: [...room.log, `${player.name} left the room.`],
    updatedAt: new Date().toISOString(),
  };

  if (nextRoom.phase !== "lobby" && player.role === "villager") {
    updateWinnerState(nextRoom);
  }

  return upsertRoom(nextRoom);
  })();
}

export function applyAction({
  roomId,
  roomCode,
  action,
  actor,
  target,
}: {
  roomId?: string;
  roomCode?: string;
  action: "mafia-kill" | "village-vote" | "restart" | "start-game" | "transfer-moderator";
  actor?: string;
  target?: string;
}): StoredGameState {
  return db.transaction(() => {
  const room = roomId ? getGameById(roomId) : roomCode ? getGameByCode(roomCode) : undefined;
  if (!room) {
    throw new Error("Room not found.");
  }

  if (action === "transfer-moderator") {
    if (!actor || actor !== room.temporaryModerator || !target) {
      throw new Error("Only the current moderator can transfer moderator rights.");
    }
    const successor = room.players.find((player) => player.name === target);
    if (!successor || !successor.isAlive) {
      throw new Error("Choose an alive player as the new moderator.");
    }
    room.temporaryModerator = successor.name;
    room.log.unshift(`${actor} transferred moderator rights to ${successor.name}.`);
    room.updatedAt = new Date().toISOString();
    return upsertRoom(room);
  }

  if (action === "restart") {
    if (!actor || actor !== room.temporaryModerator) {
      throw new Error("Only the room moderator can restart the game.");
    }
    const names = room.players.map((player) => player.name);
    const restartedPlayers = buildRoles(names).map((player) => {
      const previous = room.players.find((entry) => entry.name === player.name);
      return { ...player, avatar: previous?.avatar ?? player.avatar, isAlive: true, wasEliminated: false };
    });

    const restartedRoom: StoredGameState = {
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
        room.mode === "with-god" ? `${room.godName ?? names[0]} remains the God moderator.` : `${room.temporaryModerator ?? names[0]} returns as a regular player.`,
      ],
      mafiaChat: [],
      updatedAt: new Date().toISOString(),
    };

    return upsertRoom(restartedRoom);
  }

  if (action === "start-game") {
    if (!actor || actor !== room.temporaryModerator) {
      throw new Error("Only the room moderator can start the game.");
    }
    if (room.phase !== "lobby") {
      throw new Error("The game has already started.");
    }

    const names = room.players.map((player) => player.name);
    if (names.length < 3) {
      throw new Error("At least 3 players are required to start the game.");
    }

    const assignedPlayers = buildRoles(names).map((player) => {
      const previous = room.players.find((entry) => entry.name === player.name);
      return { ...player, avatar: previous?.avatar ?? player.avatar, isAlive: true, wasEliminated: false };
    });

    room.players = assignedPlayers;
    room.phase = "mafia-turn";
    room.round = 1;
    room.winner = null;
    room.votesByPlayer = {};
    room.votedPlayers = [];
    room.pendingKillTarget = null;
    room.log = [
      `${room.roomName} has started. Roles are now in play.`,
      room.mode === "with-god" ? `${room.godName ?? room.players[0]?.name ?? "Moderator"} can observe every role.` : "No permanent moderator has special powers during the game.",
    ];
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

    if (!mafiaActor || !mafiaActor.isAlive || mafiaActor.role !== "mafia") {
      throw new Error("Only mafia members may perform a mafia kill.");
    }

    if (!targetPlayer || !targetPlayer.isAlive || targetPlayer.role === "mafia") {
      throw new Error("The target must be alive.");
    }

    if (targetPlayer.name === mafiaActor.name) {
      throw new Error("A mafia player cannot target themselves.");
    }

    targetPlayer.isAlive = false;
    targetPlayer.wasEliminated = true;
    room.pendingKillTarget = null;
    room.log.unshift(`${targetPlayer.name} was eliminated by the mafia.`);
    if (!updateWinnerState(room)) {
      room.phase = "village-vote";
    }
    room.updatedAt = new Date().toISOString();
    return upsertRoom(room);
  }

  if (action === "village-vote") {
    if (!actor || !target) {
      throw new Error("A voter and target are required.");
    }
    const physicalInnocentDeclaration = room.physicalMode && room.phase === "mafia-turn";
    if (room.phase !== "village-vote" && !physicalInnocentDeclaration) {
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

    if (actor === target && !physicalInnocentDeclaration) {
      throw new Error("A player cannot vote for themselves.");
    }

    if (!physicalInnocentDeclaration && room.votedPlayers.includes(actor)) {
      throw new Error("This player has already voted in this round.");
    }

    if (physicalInnocentDeclaration) {
      if (player.role !== "villager" || target !== actor) {
        throw new Error("Only villagers can declare themselves innocent.");
      }
      room.log.unshift(`${actor} declared themselves innocent.`);
      room.updatedAt = new Date().toISOString();
      return upsertRoom(room);
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
  })();
}
