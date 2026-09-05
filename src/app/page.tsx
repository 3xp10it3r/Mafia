"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { GameMode, GameState } from "@/lib/game";

const normalizePlayers = (value: string) =>
  value
    .split(/\n|,/) 
    .map((entry) => entry.trim())
    .filter(Boolean);

const confettiPieces = [
  { emoji: "✨", left: "8%", delay: "0s" },
  { emoji: "🎉", left: "18%", delay: "0.3s" },
  { emoji: "⭐", left: "30%", delay: "0.8s" },
  { emoji: "🎊", left: "42%", delay: "0.1s" },
  { emoji: "✨", left: "55%", delay: "0.6s" },
  { emoji: "🎉", left: "68%", delay: "0.2s" },
  { emoji: "⭐", left: "80%", delay: "1s" },
  { emoji: "🎊", left: "92%", delay: "0.7s" },
];

const sceneBurst = [
  { left: "12%", delay: "0s", duration: "2.3s" },
  { left: "24%", delay: "0.2s", duration: "2.8s" },
  { left: "38%", delay: "0.5s", duration: "2.5s" },
  { left: "52%", delay: "0.7s", duration: "2.9s" },
  { left: "66%", delay: "0.3s", duration: "2.6s" },
  { left: "80%", delay: "0.8s", duration: "2.4s" },
  { left: "94%", delay: "0.1s", duration: "2.7s" },
];

const winnerBadgeLabel = {
  mafia: "Mafia Control",
  villager: "Town Victory",
};

export default function Home() {
  const [roomName, setRoomName] = useState("Midnight Mafia");
  const [roomPassword, setRoomPassword] = useState("");
  const [joinPassword, setJoinPassword] = useState("");
  const [mode, setMode] = useState<GameMode>("with-god");
  const [mafiaCount, setMafiaCount] = useState(2);
  const [physicalMode, setPhysicalMode] = useState(false);
  const [playersText, setPlayersText] = useState("");
  const [myName, setMyName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [joinName, setJoinName] = useState("");
  const [game, setGame] = useState<GameState | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState("");
  const [notice, setNotice] = useState("Create or join a room to begin.");
  const [targetChoice, setTargetChoice] = useState("");
  const [mafiaChatDraft, setMafiaChatDraft] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [lobbyRooms, setLobbyRooms] = useState<GameState[]>([]);
  const [roomSearch, setRoomSearch] = useState("");
  const [roomFilterMode, setRoomFilterMode] = useState<"all" | "with-god" | "without-god">("all");
  const [roomFilterStatus, setRoomFilterStatus] = useState<"all" | "open" | "locked" | "active" | "finished">("all");
  const socketRef = useRef<Socket | null>(null);

  async function fetchLobbyRooms() {
    try {
      const response = await fetch("/api/game");
      const payload = await response.json();
      setLobbyRooms(Array.isArray(payload.games) ? payload.games : []);
    } catch {
      setLobbyRooms([]);
    }
  }

  const currentPlayer = useMemo(() => {
    if (!game) {
      return null;
    }

    const activeName = selectedPlayer || myName || game.players[0]?.name || "";
    return game.players.find((player) => player.name === activeName) ?? game.players[0] ?? null;
  }, [game, myName, selectedPlayer]);

  const livingTargets = useMemo(() => {
    if (!game || !currentPlayer) {
      return [];
    }
    return game.players.filter((player) => player.isAlive && player.name !== currentPlayer.name);
  }, [game, currentPlayer]);

  const godIsViewing = Boolean(
    game && game.mode === "with-god" && currentPlayer && game.godName === currentPlayer.name,
  );

  const canMafiaAct = Boolean(
    game &&
      currentPlayer &&
      currentPlayer.isAlive &&
      currentPlayer.role === "mafia" &&
      game.phase === "mafia-turn" &&
      game.winner === null,
  );

  const canVote = Boolean(
    game &&
      currentPlayer &&
      currentPlayer.isAlive &&
      game.phase === "village-vote" &&
      !game.votedPlayers.includes(currentPlayer.name) &&
      game.winner === null,
  );

  useEffect(() => {
    const refreshLobby = () => {
      void fetchLobbyRooms();
    };

    refreshLobby();
    const timer = window.setInterval(refreshLobby, 15000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!game?.code) {
      return undefined;
    }

    const socket = io({ transports: ["websocket"] });
    socketRef.current = socket;

    socket.on("connect", () => {
      socket.emit("room:join", {
        roomCode: game.code,
        playerName: selectedPlayer || myName || currentPlayer?.name,
        password: joinPassword || roomPassword,
      });
    });

    socket.on("room:update", (updatedRoom: GameState) => {
      setGame(updatedRoom);
    });

    socket.on("room:error", ({ message }: { message: string }) => {
      setNotice(message);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [currentPlayer?.name, game?.code, joinPassword, myName, roomPassword, selectedPlayer]);

  async function createRoom(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsBusy(true);
    setNotice("Creating the room...");

    const parsedPlayers = normalizePlayers(playersText);
    const preferredPlayer = parsedPlayers.includes(myName) ? myName : parsedPlayers[0] ?? "";

    const response = await fetch("/api/game", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create",
        roomName,
        mode,
        mafiaCount,
        players: parsedPlayers,
        password: roomPassword.trim() || undefined,
        physicalMode,
      }),
    });

    const payload = await response.json();
    setIsBusy(false);

    if (payload.error) {
      setNotice(payload.error);
      return;
    }

    setGame(payload);
    setSelectedPlayer(preferredPlayer);
    setMyName(preferredPlayer);
    setTargetChoice(payload.players[1]?.name ?? "");
    setNotice(`${payload.roomName} is ready. Room code: ${payload.code}.`);
    setRoomPassword("");
  }

  async function joinRoom(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsBusy(true);
    setNotice("Joining room...");

    const response = await fetch("/api/game", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "join",
        roomCode: joinCode.trim(),
        playerName: joinName.trim(),
        password: joinPassword,
      }),
    });

    const payload = await response.json();
    setIsBusy(false);

    if (payload.error) {
      setNotice(payload.error);
      return;
    }

    setGame(payload);
    setSelectedPlayer(joinName.trim());
    setMyName(joinName.trim());
    setTargetChoice(payload.players[1]?.name ?? "");
    setNotice(`${payload.roomName} joined successfully. Your room code is ${payload.code}.`);
    setJoinPassword("");
  }

  async function runAction(action: "mafia-kill" | "village-vote" | "restart" | "mafia-chat", targetOverride?: string, messageOverride?: string) {
    if (!game || !currentPlayer) {
      return;
    }

    const actionTarget = targetOverride ?? targetChoice;
    if (action !== "restart" && action !== "mafia-chat" && !actionTarget) {
      setNotice("Select a valid target before taking action.");
      return;
    }

    setIsBusy(true);

    const body: Record<string, string | undefined> = {
      action,
      roomCode: game.code,
      actor: currentPlayer.name,
    };

    if (action === "mafia-kill" || action === "village-vote") {
      body.target = actionTarget;
    }

    if (action === "mafia-chat") {
      body.message = (messageOverride ?? mafiaChatDraft).trim();
    }

    const response = await fetch("/api/game", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const payload = await response.json();
    setIsBusy(false);

    if (payload.error) {
      setNotice(payload.error);
      return;
    }

    setGame(payload);
    setTargetChoice("");
    if (action === "mafia-chat") {
      setMafiaChatDraft("");
      setNotice(`${currentPlayer.name} sent a private mafia message.`);
      return;
    }

    setNotice(
      action === "restart"
        ? "A new game has started. Roles have been refreshed."
        : action === "mafia-kill"
          ? `${currentPlayer.name} targeted ${actionTarget}.`
          : `${currentPlayer.name} voted against ${actionTarget}.`,
    );
  }

  const generalSummary = useMemo(() => {
    if (!game) {
      return "No active room";
    }

    const living = game.players.filter((player) => player.isAlive);
    const mafiaAlive = living.filter((player) => player.role === "mafia").length;
    const villagersAlive = living.filter((player) => player.role === "villager").length;
    return `Round ${game.round} • ${mafiaAlive} mafia • ${villagersAlive} villagers • ${game.phase}`;
  }, [game]);

  const filteredLobbyRooms = useMemo(() => {
    const query = roomSearch.trim().toLowerCase();

    return lobbyRooms.filter((room) => {
      const matchesSearch =
        !query ||
        room.roomName.toLowerCase().includes(query) ||
        room.code.toLowerCase().includes(query) ||
        room.players.some((player) => player.name.toLowerCase().includes(query));

      const matchesMode = roomFilterMode === "all" || room.mode === roomFilterMode;
      const roomHasPassword = Boolean(room.password);
      const roomIsActive = room.winner === null;
      const matchesStatus =
        roomFilterStatus === "all" ||
        (roomFilterStatus === "open" && !roomHasPassword) ||
        (roomFilterStatus === "locked" && roomHasPassword) ||
        (roomFilterStatus === "active" && roomIsActive) ||
        (roomFilterStatus === "finished" && !roomIsActive);

      return matchesSearch && matchesMode && matchesStatus;
    });
  }, [lobbyRooms, roomFilterMode, roomFilterStatus, roomSearch]);

  const isNightPhase = game?.phase === "mafia-turn";
  const mafiaAliveCount = game ? game.players.filter((player) => player.isAlive && player.role === "mafia").length : 0;
  const villagerAliveCount = game ? game.players.filter((player) => player.isAlive && player.role === "villager").length : 0;
  const survivingPlayers = game ? game.players.filter((player) => player.isAlive).map((player) => player.name) : [];
  const winnerTone = game?.winner === "mafia" ? "mafia" : "villager";
  const lastElimination = game && game.log.length > 0 ? game.log[0] : "No elimination logged yet";
  const totalVotesCast = game ? Object.keys(game.votesByPlayer).length : 0;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#111827,_#020617_55%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6 animate-[fadeInScale_0.7s_ease-out]">
        <header className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-2xl shadow-slate-950/40 backdrop-blur-sm transition-all duration-500 hover:border-amber-400/40">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.32em] text-amber-300">Mafia game room</p>
              <h1 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">The Town of Shadows</h1>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              {game ? (
                <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-100 shadow-lg shadow-emerald-900/10">
                  {generalSummary}
                </div>
              ) : null}
              {game ? (
                <div className="rounded-2xl border border-sky-400/30 bg-sky-500/10 px-3 py-2 text-sm font-medium text-sky-100 shadow-lg shadow-sky-900/10">
                  Code: {game.code}
                </div>
              ) : null}
            </div>
          </div>
        </header>

        {!game ? (
          <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-3xl border border-amber-400/20 bg-slate-900/70 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.45)] backdrop-blur-sm transition-all duration-500 hover:border-amber-400/45 hover:shadow-[0_18px_60px_rgba(251,191,36,0.08)] sm:p-6">
              <h2 className="text-2xl font-bold text-white">Create a room</h2>
              <form onSubmit={createRoom} className="mt-6 space-y-5">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-200">Room name</label>
                  <input
                    value={roomName}
                    onChange={(event) => setRoomName(event.target.value)}
                    className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-white outline-none transition duration-200 focus:border-amber-400 focus:ring-2 focus:ring-amber-500/30"
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-200">Game mode</label>
                    <select
                      value={mode}
                      onChange={(event) => setMode(event.target.value as GameMode)}
                      className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-white outline-none transition duration-200 focus:border-amber-400 focus:ring-2 focus:ring-amber-500/30"
                    >
                      <option value="with-god">With God</option>
                      <option value="without-god">Without God</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-200">Number of mafia</label>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={mafiaCount}
                      onChange={(event) => setMafiaCount(Number(event.target.value) || 1)}
                      className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-white outline-none transition duration-200 focus:border-amber-400 focus:ring-2 focus:ring-amber-500/30"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-200">Your name</label>
                  <input
                    value={myName}
                    onChange={(event) => setMyName(event.target.value)}
                    className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-white outline-none transition duration-200 focus:border-amber-400 focus:ring-2 focus:ring-amber-500/30"
                    placeholder="Pick a player name"
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-200">Room password</label>
                    <input
                      type="password"
                      value={roomPassword}
                      onChange={(event) => setRoomPassword(event.target.value)}
                      className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-white outline-none transition duration-200 focus:border-amber-400 focus:ring-2 focus:ring-amber-500/30"
                      placeholder="Optional"
                    />
                  </div>

                  <div className="flex items-end">
                    <label className="flex w-full items-center justify-between rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-slate-200">
                      <span>Physical play</span>
                      <input
                        type="checkbox"
                        checked={physicalMode}
                        onChange={(event) => setPhysicalMode(event.target.checked)}
                        className="h-4 w-4 accent-amber-500"
                      />
                    </label>
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-200">Player list</label>
                  <textarea
                    rows={9}
                    value={playersText}
                    onChange={(event) => setPlayersText(event.target.value)}
                    className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-white outline-none transition duration-200 focus:border-amber-400 focus:ring-2 focus:ring-amber-500/30"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isBusy}
                  className="w-full rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 px-5 py-3 text-base font-bold text-slate-950 shadow-lg shadow-amber-950/30 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isBusy ? "Creating..." : "Create room"}
                </button>
              </form>
            </div>

            <div className="space-y-6">
              <div className="rounded-3xl border border-sky-400/20 bg-slate-900/70 p-5 shadow-[0_18px_50px_rgba(14,116,144,0.16)] backdrop-blur-sm transition-all duration-500 hover:border-sky-400/40 hover:shadow-[0_18px_60px_rgba(14,165,233,0.1)] sm:p-6">
                <h2 className="text-2xl font-bold text-white">Join a room</h2>
                <form onSubmit={joinRoom} className="mt-6 space-y-5">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-200">Room code</label>
                    <input
                      value={joinCode}
                      onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                      className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-white outline-none transition duration-200 focus:border-sky-400 focus:ring-2 focus:ring-sky-500/30"
                      placeholder="ABC123"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-200">Player name</label>
                    <input
                      value={joinName}
                      onChange={(event) => setJoinName(event.target.value)}
                      className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-white outline-none transition duration-200 focus:border-sky-400 focus:ring-2 focus:ring-sky-500/30"
                      placeholder="Enter the player name in this room"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-200">Room password</label>
                    <input
                      type="password"
                      value={joinPassword}
                      onChange={(event) => setJoinPassword(event.target.value)}
                      className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-white outline-none transition duration-200 focus:border-sky-400 focus:ring-2 focus:ring-sky-500/30"
                      placeholder="Optional for public rooms"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isBusy}
                    className="w-full rounded-2xl bg-gradient-to-r from-sky-400 to-cyan-500 px-5 py-3 text-base font-bold text-slate-950 shadow-lg shadow-sky-950/30 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isBusy ? "Joining..." : "Join room"}
                  </button>
                </form>
              </div>

              <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.34)] backdrop-blur-sm transition-all duration-500 hover:border-amber-400/30 sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-xl font-bold text-white">Lobby</h3>
                  <button
                    type="button"
                    onClick={() => void fetchLobbyRooms()}
                    className="rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-200 transition hover:border-amber-400/60 hover:text-amber-200"
                  >
                    Refresh
                  </button>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <input
                    value={roomSearch}
                    onChange={(event) => setRoomSearch(event.target.value)}
                    placeholder="Search rooms or players"
                    className="rounded-2xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white outline-none transition duration-200 focus:border-amber-400 focus:ring-2 focus:ring-amber-500/30"
                  />

                  <select
                    value={roomFilterMode}
                    onChange={(event) => setRoomFilterMode(event.target.value as "all" | "with-god" | "without-god")}
                    className="rounded-2xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white outline-none transition duration-200 focus:border-amber-400 focus:ring-2 focus:ring-amber-500/30"
                  >
                    <option value="all">All modes</option>
                    <option value="with-god">With God</option>
                    <option value="without-god">Without God</option>
                  </select>

                  <select
                    value={roomFilterStatus}
                    onChange={(event) => setRoomFilterStatus(event.target.value as "all" | "open" | "locked" | "active" | "finished")}
                    className="rounded-2xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white outline-none transition duration-200 focus:border-amber-400 focus:ring-2 focus:ring-amber-500/30"
                  >
                    <option value="all">All rooms</option>
                    <option value="open">Open</option>
                    <option value="locked">Locked</option>
                    <option value="active">In progress</option>
                    <option value="finished">Finished</option>
                  </select>

                  <button
                    type="button"
                    onClick={() => {
                      setRoomSearch("");
                      setRoomFilterMode("all");
                      setRoomFilterStatus("all");
                    }}
                    className="rounded-2xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:border-sky-400 hover:text-sky-200"
                  >
                    Reset filters
                  </button>
                </div>

                <div className="mt-4 space-y-3">
                  {filteredLobbyRooms.length === 0 ? (
                    <p className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/40 p-4 text-sm text-slate-400">
                      No rooms match the current filters. Try another search or create a fresh room.
                    </p>
                  ) : (
                    filteredLobbyRooms.map((room) => (
                      <button
                        type="button"
                        key={room.id}
                        onClick={() => {
                          setJoinCode(room.code);
                          setNotice(`${room.roomName} is ready for joining. Use code ${room.code}.`);
                        }}
                        className="w-full rounded-2xl border border-slate-700 bg-slate-950/60 p-4 text-left transition duration-200 hover:border-amber-400/60 hover:bg-slate-900 hover:shadow-[0_12px_28px_rgba(251,191,36,0.08)]"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-base font-bold text-white">{room.roomName}</p>
                            <p className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-400">{room.code}</p>
                          </div>
                          {room.password ? (
                            <span className="rounded-full border border-amber-400/40 bg-amber-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-amber-200">
                              Locked
                            </span>
                          ) : (
                            <span className="rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-200">
                              Open
                            </span>
                          )}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-300">
                          <span className="rounded-full bg-slate-800 px-2 py-1">{room.mode === "with-god" ? "With God" : "Without God"}</span>
                          <span className="rounded-full bg-slate-800 px-2 py-1">{room.players.length} players</span>
                          <span className="rounded-full bg-slate-800 px-2 py-1">{room.phase}</span>
                          <span className="rounded-full bg-slate-800 px-2 py-1">{room.winner ? "Finished" : "Live"}</span>
                          {room.physicalMode ? (
                            <span className="rounded-full bg-amber-500/15 px-2 py-1 text-amber-100">Physical play</span>
                          ) : null}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-xl shadow-slate-950/20 sm:p-6">
                <h3 className="text-xl font-bold text-white">Game flow</h3>
                <ul className="mt-4 space-y-3 text-sm leading-7 text-slate-300">
                  <li>• Randomly assign mafia and townsfolk roles.</li>
                  <li>• In God mode, the moderator sees every role at once.</li>
                  <li>• In no-God mode, there is no permanent moderator.</li>
                  <li>• Mafia silently chooses a target each night.</li>
                  <li>• The town votes to eliminate the most suspicious player.</li>
                  <li>• Highest vote count gets removed; mafia can win by outnumbering the village.</li>
                </ul>
                <div className="mt-6 rounded-2xl border border-sky-400/20 bg-sky-500/10 p-4 text-sm text-sky-100">
                  <span className="font-semibold">Status:</span> {notice}
                </div>
              </div>
            </div>
          </section>
        ) : (
          <section className="space-y-6">
            {game.winner ? (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-md">
                <div className={`relative w-full max-w-4xl overflow-hidden rounded-[2rem] border p-6 shadow-[0_30px_80px_rgba(15,23,42,0.8)] animate-[fadeInScale_0.7s_ease-out] ${winnerTone === "mafia" ? "border-red-500/40 bg-gradient-to-br from-red-600/30 via-red-500/10 to-slate-950" : "border-emerald-500/40 bg-gradient-to-br from-emerald-600/30 via-emerald-500/10 to-slate-950"}`}>
                  <div className="pointer-events-none absolute inset-0 overflow-hidden">
                    {sceneBurst.map((burst, index) => (
                      <span
                        key={`burst-${index}`}
                        className="absolute -top-12 text-3xl animate-[fall_2.5s_ease-in-out_infinite]"
                        style={{ left: burst.left, animationDelay: burst.delay, animationDuration: burst.duration }}
                      >
                        {index % 2 === 0 ? "🎉" : "✨"}
                      </span>
                    ))}
                    {confettiPieces.map((piece, index) => (
                      <span
                        key={`${piece.emoji}-${index}`}
                        className="absolute -top-10 text-2xl drop-shadow-[0_0_12px_rgba(255,255,255,0.4)] animate-bounce"
                        style={{ left: piece.left, animationDelay: piece.delay, animationDuration: `${3 + index * 0.35}s` }}
                      >
                        {piece.emoji}
                      </span>
                    ))}
                  </div>

                  <div className="relative flex flex-col gap-5">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-4">
                        <div className={`flex h-16 w-16 items-center justify-center rounded-full border text-xl font-black shadow-[0_0_30px_rgba(255,255,255,0.25)] ${winnerTone === "mafia" ? "border-red-300/60 bg-red-500/20 text-red-100" : "border-emerald-300/60 bg-emerald-500/20 text-emerald-100"}`}>
                          {winnerTone === "mafia" ? "☠️" : "🏆"}
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-[0.35em] text-slate-300">Winner reveal</p>
                          <h2 className="mt-2 text-3xl font-black text-white sm:text-5xl">
                            {game.winner === "mafia" ? "Mafia wins" : "Villagers win"}
                          </h2>
                        </div>
                      </div>

                      <div className={`rounded-full border px-3 py-2 text-[10px] font-bold uppercase tracking-[0.25em] ${winnerTone === "mafia" ? "border-red-300/80 bg-red-500/20 text-red-100" : "border-emerald-300/80 bg-emerald-500/20 text-emerald-100"}`}>
                        {winnerBadgeLabel[winnerTone]}
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-[1.3fr_0.7fr]">
                      <div className="rounded-3xl border border-white/10 bg-slate-950/55 p-5">
                        <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Match summary</p>
                        <p className="mt-4 text-base text-slate-200">
                          {game.winner === "mafia"
                            ? "The mafia outnumbered the town and took control of the night. The city is now in their hands."
                            : "The town hunted the mafia down and restored peace to the city. The night was defeated once and for all."}
                        </p>

                        <div className="mt-5 grid gap-3 sm:grid-cols-2">
                          <div className="rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3">
                            <p className="text-[10px] uppercase tracking-[0.25em] text-slate-400">Room</p>
                            <p className="mt-2 text-lg font-bold text-white">{game.roomName}</p>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3">
                            <p className="text-[10px] uppercase tracking-[0.25em] text-slate-400">Mode</p>
                            <p className="mt-2 text-lg font-bold text-white">{game.mode === "with-god" ? "With God" : "Without God"}</p>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3">
                            <p className="text-[10px] uppercase tracking-[0.25em] text-slate-400">Round</p>
                            <p className="mt-2 text-lg font-bold text-white">{game.round}</p>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3">
                            <p className="text-[10px] uppercase tracking-[0.25em] text-slate-400">Code</p>
                            <p className="mt-2 text-lg font-bold text-white">{game.code}</p>
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-3">
                        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3">
                          <p className="text-[10px] uppercase tracking-[0.25em] text-red-200">Mafia alive</p>
                          <p className="mt-2 text-3xl font-black text-red-100">{mafiaAliveCount}</p>
                        </div>
                        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3">
                          <p className="text-[10px] uppercase tracking-[0.25em] text-emerald-200">Villagers alive</p>
                          <p className="mt-2 text-3xl font-black text-emerald-100">{villagerAliveCount}</p>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3">
                          <p className="text-[10px] uppercase tracking-[0.25em] text-slate-400">Votes cast</p>
                          <p className="mt-2 text-3xl font-black text-white">{totalVotesCast}</p>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                        <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">Last elimination</p>
                        <p className="mt-3 text-sm text-slate-200">{lastElimination}</p>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                        <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">Replay summary</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {survivingPlayers.length === 0 ? (
                            <span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-medium text-slate-200">No players survived the final round</span>
                          ) : (
                            survivingPlayers.map((name) => (
                              <span key={name} className="rounded-full bg-slate-800 px-3 py-1 text-xs font-medium text-slate-100">
                                {name}
                              </span>
                            ))
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => void runAction("restart")}
                        className="rounded-2xl bg-gradient-to-r from-emerald-400 to-cyan-500 px-5 py-3 font-bold text-slate-950 shadow-lg shadow-emerald-900/30"
                      >
                        New game
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Room</p>
                <h2 className="mt-2 text-xl font-bold text-white sm:text-2xl">{game.roomName}</h2>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Mode</p>
                <h2 className="mt-2 text-lg font-bold text-white sm:text-xl">
                  {game.mode === "with-god" ? "With God" : "Without God"}
                </h2>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Phase</p>
                <h2 className="mt-2 text-lg font-bold text-white sm:text-xl">{game.phase}</h2>
              </div>
            </div>

            {game.physicalMode ? (
              <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm text-amber-100">
                Same-room physical play is enabled. Villagers choose the innocent suspect while mafia picks the kill target.
              </div>
            ) : null}

            <div className={`rounded-3xl border p-4 sm:p-6 ${isNightPhase ? "border-amber-500/30 bg-gradient-to-r from-amber-500/10 to-red-500/10" : "border-sky-400/30 bg-gradient-to-r from-sky-500/10 to-cyan-500/10"}`}>
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-300">Current player</p>
                  <select
                    value={selectedPlayer}
                    onChange={(event) => setSelectedPlayer(event.target.value)}
                    className="mt-2 min-w-[220px] rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-white focus:border-amber-400"
                  >
                    {game.players.map((player) => (
                      <option key={player.name} value={player.name}>
                        {player.avatar} {player.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-sm text-slate-200">
                  {isNightPhase ? "Night phase – mafia is choosing" : game.physicalMode ? "Day phase – villagers pick the innocent suspect" : "Day phase – village is voting"}
                </div>

                {game.winner ? (
                  <button
                    type="button"
                    onClick={() => void runAction("restart")}
                    className="rounded-2xl bg-gradient-to-r from-emerald-400 to-cyan-500 px-5 py-3 font-bold text-slate-950 shadow-lg shadow-emerald-900/30"
                  >
                    Start new game
                  </button>
                ) : null}
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
              <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 sm:p-6">
                <h3 className="text-xl font-bold text-white">Role overview</h3>

                {currentPlayer && (
                  <div className="mt-5 rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4">
                    <div className="flex items-center gap-3">
                      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-900 text-2xl shadow-inner shadow-slate-950/50">
                        {currentPlayer.avatar}
                      </span>
                      <div>
                        <p className="text-xs uppercase tracking-[0.3em] text-amber-200">Your identity</p>
                        <p className="mt-1 text-2xl font-black text-white">
                          {godIsViewing ? "God sees everyone" : currentPlayer.role === "mafia" ? "Mafia" : "Villager"}
                        </p>
                      </div>
                    </div>
                    {!godIsViewing && currentPlayer.role === "mafia" && game.phase === "mafia-turn" ? (
                      <p className="mt-2 text-sm text-amber-100">You may choose a target to eliminate.</p>
                    ) : null}
                  </div>
                )}

                {game.mode === "with-god" && godIsViewing ? (
                  <div className="mt-5 space-y-3">
                    {game.players.map((player) => (
                      <div
                        key={player.name}
                        className={`flex items-center justify-between rounded-2xl border px-4 py-3 ${
                          player.isAlive
                            ? "border-slate-700 bg-slate-950/60"
                            : "border-red-500/40 bg-red-500/10 text-red-100"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-xl">{player.avatar}</span>
                          <div>
                            <p className="font-semibold text-white">{player.name}</p>
                            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                              {player.isAlive ? "Alive" : "Eliminated"}
                            </p>
                          </div>
                        </div>
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] ${
                            player.role === "mafia"
                              ? "bg-red-500/20 text-red-200"
                              : "bg-emerald-500/20 text-emerald-200"
                          }`}
                        >
                          {player.role}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-5 rounded-2xl border border-slate-700 bg-slate-950/60 p-4 text-slate-300">
                    {currentPlayer && currentPlayer.role === "mafia"
                      ? "You are a mafia operative. Stay quiet and choose a target when the mafia turn opens."
                      : "You are a villager. Observe the town, vote wisely, and catch the mafia."}
                  </div>
                )}
              </div>

              <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 sm:p-6">
                <h3 className="text-xl font-bold text-white">Actions</h3>
                <div className="mt-5 space-y-4">
                  {game.winner ? (
                    <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-4 text-emerald-100">
                      {game.winner === "mafia" ? "Mafia wins the night." : "Villagers win the town."}
                    </div>
                  ) : null}

                  {canMafiaAct ? (
                    <div className="space-y-3">
                      <label className="block text-sm font-medium text-slate-200">Choose a target</label>
                      <select
                        value={targetChoice}
                        onChange={(event) => setTargetChoice(event.target.value)}
                        className="w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-white focus:border-red-400"
                      >
                        <option value="">Select target</option>
                        {livingTargets.map((player) => (
                          <option key={player.name} value={player.name}>
                            {player.avatar} {player.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => void runAction("mafia-kill")}
                        disabled={isBusy || !targetChoice}
                        className="w-full rounded-2xl bg-gradient-to-r from-red-500 to-rose-500 px-4 py-3 font-bold text-white shadow-lg shadow-red-950/30 disabled:opacity-60"
                      >
                        Confirm mafia kill
                      </button>
                    </div>
                  ) : null}

                  {canVote ? (
                    <div className="space-y-3">
                      <label className="block text-sm font-medium text-slate-200">
                        {game.physicalMode ? "Choose the innocent suspect" : "Vote to eliminate"}
                      </label>
                      <select
                        value={targetChoice}
                        onChange={(event) => setTargetChoice(event.target.value)}
                        className="w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-white focus:border-amber-400"
                      >
                        <option value="">Pick a suspect</option>
                        {livingTargets.map((player) => (
                          <option key={player.name} value={player.name}>
                            {player.avatar} {player.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => void runAction("village-vote")}
                        disabled={isBusy || !targetChoice}
                        className="w-full rounded-2xl bg-gradient-to-r from-amber-400 to-yellow-500 px-4 py-3 font-bold text-slate-950 shadow-lg shadow-amber-900/30 disabled:opacity-60"
                      >
                        {game.physicalMode ? "Confirm innocent pick" : "Cast village vote"}
                      </button>
                    </div>
                  ) : null}

                  {game.phase === "game-over" ? (
                    <button
                      type="button"
                      onClick={() => void runAction("restart")}
                      className="w-full rounded-2xl bg-gradient-to-r from-emerald-400 to-cyan-500 px-4 py-3 font-bold text-slate-950"
                    >
                      Reset game
                    </button>
                  ) : null}
                </div>

                <div className="mt-6 rounded-2xl border border-slate-700 bg-slate-950/60 p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Current vote</p>
                  <p className="mt-3 text-lg font-semibold text-white">
                    {game.pendingKillTarget ? `Pending mafia target: ${game.pendingKillTarget}` : "No pending mafia target."}
                  </p>
                </div>
              </div>
            </div>

            {currentPlayer?.role === "mafia" ? (
              <div className="rounded-3xl border border-red-500/30 bg-red-500/10 p-5 sm:p-6">
                <h3 className="text-xl font-bold text-white">Private mafia chat</h3>
                <div className="mt-4 space-y-3">
                  {game.mafiaChat.length === 0 ? (
                    <p className="rounded-2xl border border-dashed border-red-400/40 bg-slate-950/60 p-4 text-sm text-red-100">
                      No messages yet. Coordinate quietly with your crew.
                    </p>
                  ) : (
                    game.mafiaChat.map((message, index) => (
                      <div key={`${message.sender}-${message.sentAt}-${index}`} className="rounded-2xl border border-red-400/30 bg-slate-950/60 p-3 text-sm text-slate-200">
                        <p className="font-semibold text-red-200">{message.sender}</p>
                        <p className="mt-1">{message.message}</p>
                      </div>
                    ))
                  )}
                </div>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <input
                    value={mafiaChatDraft}
                    onChange={(event) => setMafiaChatDraft(event.target.value)}
                    placeholder="Send a secret mafia message..."
                    className="flex-1 rounded-2xl border border-red-400/30 bg-slate-950/80 px-4 py-3 text-white outline-none focus:border-red-400"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!mafiaChatDraft.trim()) {
                        setNotice("Write a mafia message before sending.");
                        return;
                      }
                      void runAction("mafia-chat", undefined, mafiaChatDraft);
                    }}
                    className="rounded-2xl bg-gradient-to-r from-red-500 to-rose-500 px-5 py-3 font-bold text-white"
                  >
                    Send
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-3xl border border-slate-700 bg-slate-900/70 p-5 sm:p-6">
                <h3 className="text-xl font-bold text-white">Private mafia chat</h3>
                <p className="mt-3 text-sm text-slate-300">This channel stays hidden from the village. Only mafia members can see its contents.</p>
              </div>
            )}

            <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 sm:p-6">
              <h3 className="text-xl font-bold text-white">Player board</h3>
              <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {game.players.map((player) => {
                  const revealRole = game.mode === "with-god" && godIsViewing;
                  return (
                    <div
                      key={player.name}
                      className={`rounded-2xl border p-4 ${
                        player.isAlive
                          ? selectedPlayer === player.name
                            ? "border-amber-400 bg-amber-500/10"
                            : "border-slate-700 bg-slate-950/60"
                          : "border-red-500/40 bg-red-500/10"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-900 text-2xl">{player.avatar}</span>
                          <p className="text-lg font-bold text-white">{player.name}</p>
                        </div>
                        <span
                          className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-[0.2em] ${
                            revealRole && player.role === "mafia"
                              ? "bg-red-500/20 text-red-200"
                              : revealRole
                                ? "bg-emerald-500/20 text-emerald-200"
                                : "bg-slate-700/80 text-slate-200"
                          }`}
                        >
                          {revealRole ? player.role : "Hidden"}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-slate-300">
                        {player.isAlive ? "Alive in the town" : "Eliminated from play"}
                      </p>
                      <p className="mt-3 text-xs uppercase tracking-[0.2em] text-slate-400">
                        {player.name === game.godName
                          ? "God"
                          : game.temporaryModerator === player.name
                            ? "Moderator"
                            : "Citizen"}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 sm:p-6">
              <h3 className="text-xl font-bold text-white">Game log</h3>
              <div className="mt-4 space-y-3">
                {game.log.map((entry, index) => (
                  <div
                    key={`${entry}-${index}`}
                    className="rounded-2xl border border-slate-700 bg-slate-950/60 px-4 py-3 text-sm text-slate-300"
                  >
                    {entry}
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
