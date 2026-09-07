import { randomInt } from "node:crypto";

export type GameMode = "with-god" | "without-god";
export type GamePhase = "lobby" | "mafia-turn" | "village-vote" | "game-over";
export type Role = "mafia" | "villager";
export type GameAction =
  | "mafia-kill"
  | "declare-innocent"
  | "village-suspect"
  | "village-vote"
  | "restart"
  | "start-game"
  | "transfer-moderator";

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 12;

export interface PlayerState {
  name: string;
  role: Role | null;
  isAlive: boolean;
  avatar: string;
  wasEliminated?: boolean;
}

export interface MafiaChatMessage {
  sender: string;
  message: string;
  sentAt: string;
}

export interface GameState {
  id: string;
  code: string;
  roomName: string;
  mode: GameMode;
  players: PlayerState[];
  phase: GamePhase;
  round: number;
  winner: "mafia" | "villager" | null;
  godName: string | null;
  temporaryModerator: string | null;
  votesByPlayer: Record<string, string>;
  votedPlayers: string[];
  pendingKillTarget: string | null;
  innocentDeclarations: string[];
  log: string[];
  mafiaChat: MafiaChatMessage[];
  physicalMode: boolean;
  createdAt: string;
  updatedAt: string;
  mafiaAliveCount: number;
  villagerAliveCount: number;
  innocentDeclarationsCount: number;
  livingVillagerCount: number;
  hasDeclaredInnocent: boolean;
  votesCast: number;
  revealedMafiaNames: string[];
}

export function shuffle<T>(items: T[]): T[] {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const randomIndex = randomInt(index + 1);
    [next[index], next[randomIndex]] = [next[randomIndex], next[index]];
  }
  return next;
}

export const AVATAR_POOL = ["🦊", "🐺", "🦁", "🐼", "🐯", "🐰", "🦄", "🐨", "🐸", "🐵", "🦅", "🐔", "🐮", "🐲", "🦉"];
export const ROOM_NAMES = [
  "The Velvet Dagger",
  "Moonlit Borough",
  "Whispering Pines",
  "Crimson Lantern",
  "The Silent District",
  "Midnight Assembly",
  "Shadow over Harbor",
  "The Crooked Crown",
  "Fogbound Town",
  "Ember Street",
];

export function randomRoomName(): string {
  return ROOM_NAMES[randomInt(ROOM_NAMES.length)] ?? "The Velvet Dagger";
}

export function buildRoles(names: string[]): PlayerState[] {
  const uniqueNames = Array.from(new Set(names.map((name) => name.trim()).filter(Boolean)));
  const mafiaIndex = uniqueNames.length > 1 ? shuffle(uniqueNames.map((_, index) => index))[0] : undefined;

  return uniqueNames.map((name, index) => ({
    name,
    role: index === mafiaIndex ? "mafia" : "villager",
    isAlive: true,
    avatar: AVATAR_POOL[index % AVATAR_POOL.length],
  }));
}

export function generateRoomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join("");
}

export function getLivingPlayers(game: GameState): PlayerState[] {
  return game.players.filter((player) => player.isAlive);
}

export function getMafiaAlive(game: GameState): PlayerState[] {
  return game.players.filter((player) => player.isAlive && player.role === "mafia");
}

export function getVillagerAlive(game: GameState): PlayerState[] {
  return game.players.filter((player) => player.isAlive && player.role === "villager");
}
