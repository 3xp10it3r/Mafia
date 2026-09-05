export type GameMode = "with-god" | "without-god";
export type GamePhase = "lobby" | "mafia-turn" | "village-vote" | "game-over";
export type Role = "mafia" | "villager";

export interface PlayerState {
  name: string;
  role: Role;
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
  mafiaCount: number;
  players: PlayerState[];
  phase: GamePhase;
  round: number;
  winner: "mafia" | "villager" | null;
  godName: string | null;
  temporaryModerator: string | null;
  votesByPlayer: Record<string, string>;
  votedPlayers: string[];
  pendingKillTarget: string | null;
  log: string[];
  mafiaChat: MafiaChatMessage[];
  password: string | null;
  physicalMode: boolean;
  createdAt: string;
  updatedAt: string;
}

export function shuffle<T>(items: T[]): T[] {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
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
  return ROOM_NAMES[Math.floor(Math.random() * ROOM_NAMES.length)] ?? "The Velvet Dagger";
}

export function buildRoles(names: string[], mafiaCount: number): PlayerState[] {
  const uniqueNames = Array.from(new Set(names.map((name) => name.trim()).filter(Boolean)));
  const mafiaSlots = new Set(
    shuffle(uniqueNames.map((_, index) => index)).slice(0, Math.max(1, Math.min(mafiaCount, uniqueNames.length - 1))),
  );

  return uniqueNames.map((name, index) => ({
    name,
    role: mafiaSlots.has(index) ? "mafia" : "villager",
    isAlive: true,
    avatar: AVATAR_POOL[index % AVATAR_POOL.length],
  }));
}

export function generateRoomCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
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
