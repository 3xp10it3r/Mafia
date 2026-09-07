import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { AVATAR_POOL, buildRoles, generateRoomCode, getLivingPlayers, getMafiaAlive, getVillagerAlive, randomRoomName, type GameState } from "@/lib/game";

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

export function upsertRoom(room: GameState): GameState {
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

export function deleteRoom(roomCode: string): void {
  db.prepare("DELETE FROM rooms WHERE code = ?").run(roomCode.toUpperCase());
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
  moderatorName,
  players,
  password,
}: {
  roomName?: string;
  mode: "with-god" | "without-god";
  mafiaCount: number;
  moderatorName?: string;
  players?: string[];
  password?: string;
}): GameState {
  const creatorName = (moderatorName ?? players?.[0] ?? "").trim();
  if (!creatorName) {
    throw new Error("A moderator name is required to create a room.");
  }
  const normalizedPassword = password?.trim() ?? "";
  if (!normalizedPassword) {
    throw new Error("A room password is required.");
  }

  const allNames = toUniqueNames([creatorName, ...(players ?? [])]);
  const safeMafiaCount = Math.max(1, Math.min(mafiaCount || 1, Math.max(1, allNames.length - 1)));
  const id = `room-${Math.random().toString(36).slice(2, 9)}`;
  const now = new Date().toISOString();
  const generatedRoomName = (roomName ?? "").trim() || randomRoomName();
  const playerList: GameState["players"] = allNames.map((name) => ({
    name,
    role: "villager",
    isAlive: true,
    avatar: AVATAR_POOL[Math.abs(name.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0)) % AVATAR_POOL.length],
  }));

  const room: GameState = {
    id,
    code: generateUniqueRoomCode(),
    roomName: generatedRoomName,
    mode,
    mafiaCount: safeMafiaCount,
    players: playerList,
    phase: "lobby",
    round: 0,
    winner: null,
    godName: mode === "with-god" ? creatorName : null,
    temporaryModerator: creatorName,
    votesByPlayer: {},
    votedPlayers: [],
    mafiaVotesByPlayer: {},
    pendingKillTarget: null,
    log: [
      `${generatedRoomName} is waiting for players.`,
      mode === "with-god" ? `${creatorName} is the God moderator.` : `${creatorName} is the temporary moderator for this room.`,
    ],
    mafiaChat: [],
    password: normalizedPassword,
    physicalMode: true,
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
  room.mafiaVotesByPlayer = {};
  room.pendingKillTarget = null;
}

function resolveMafiaVotes(room: GameState): void {
  const voteCounts = new Map<string, number>();
  Object.values(room.mafiaVotesByPlayer).forEach((target) => {
    voteCounts.set(target, (voteCounts.get(target) ?? 0) + 1);
  });

  const entries = [...voteCounts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const winner = entries[0];
  const isTie = winner && entries[1]?.[1] === winner[1];

  if (!winner || isTie) {
    room.log.unshift("The Mafia could not agree on a target. No one was eliminated.");
  } else {
    const target = room.players.find((player) => player.name === winner[0]);
    if (target?.isAlive) {
      target.isAlive = false;
      target.wasEliminated = true;
      room.pendingKillTarget = target.name;
      room.log.unshift(`${target.name} was eliminated by the mafia.`);
    }
  }

  room.mafiaVotesByPlayer = {};
  if (!updateWinnerState(room)) {
    room.phase = "village-vote";
  }
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

export function joinPlayerToRoom(roomCode: string, playerName: string): GameState {
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

  const nextRoom: GameState = {
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
}

export function leavePlayerFromRoom(roomCode: string, playerName: string): GameState | null {
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

  const nextRoom: GameState = {
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
}): GameState {
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
    const restartedPlayers = buildRoles(names, room.mafiaCount).map((player) => {
      const previous = room.players.find((entry) => entry.name === player.name);
      return { ...player, avatar: previous?.avatar ?? player.avatar, isAlive: true, wasEliminated: false };
    });

    const restartedRoom: GameState = {
      ...room,
      players: restartedPlayers,
      phase: "mafia-turn",
      round: 1,
      winner: null,
      votesByPlayer: {},
      votedPlayers: [],
      mafiaVotesByPlayer: {},
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

    const safeMafiaCount = Math.max(1, Math.min(room.mafiaCount || 1, names.length - 1));
    const assignedPlayers = buildRoles(names, safeMafiaCount).map((player) => {
      const previous = room.players.find((entry) => entry.name === player.name);
      return { ...player, avatar: previous?.avatar ?? player.avatar, isAlive: true, wasEliminated: false };
    });

    room.players = assignedPlayers;
    room.phase = "mafia-turn";
    room.round = 1;
    room.winner = null;
    room.votesByPlayer = {};
    room.votedPlayers = [];
    room.mafiaVotesByPlayer = {};
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

    room.mafiaVotesByPlayer ??= {};
    if (room.mafiaVotesByPlayer[mafiaActor.name]) {
      throw new Error("You have already chosen the Mafia target for this round.");
    }

    room.mafiaVotesByPlayer[mafiaActor.name] = targetPlayer.name;
    room.pendingKillTarget = targetPlayer.name;
    const livingMafia = getMafiaAlive(room);
    const mafiaVotesCast = livingMafia.filter((player) => room.mafiaVotesByPlayer[player.name]).length;
    if (mafiaVotesCast >= livingMafia.length) {
      resolveMafiaVotes(room);
    } else {
      room.log.unshift(`${mafiaActor.name} selected a Mafia target.`);
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
}
