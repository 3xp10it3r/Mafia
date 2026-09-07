"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { GameState } from "@/lib/game";

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
  const [roomPassword, setRoomPassword] = useState("");
  const [joinPassword, setJoinPassword] = useState("");
  const [myName, setMyName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [joinName, setJoinName] = useState("");
  const [game, setGame] = useState<GameState | null>(null);
  const [notice, setNotice] = useState("Create or join a room to begin.");
  const [targetChoice, setTargetChoice] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [lobbyRooms, setLobbyRooms] = useState<GameState[]>([]);
  const [roomSearch, setRoomSearch] = useState("");
  const [roomFilterStatus, setRoomFilterStatus] = useState<"all" | "locked" | "active" | "finished">("all");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [showRules, setShowRules] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  function clearLocalSession(message: string) {
    window.localStorage.removeItem("mafia-room-code");
    window.localStorage.removeItem("mafia-player-name");
    window.localStorage.removeItem("mafia-room-password");
    window.localStorage.removeItem("mafia-room-snapshot");
    socketRef.current?.disconnect();
    socketRef.current = null;
    setGame(null);
    setMyName("");
    setJoinCode("");
    setJoinName("");
    setJoinPassword("");
    setTargetChoice("");
    setIsBusy(false);
    setNotice(message);
  }

  async function fetchLobbyRooms() {
    try {
      const response = await fetch("/api/game");
      const payload = await response.json();
      setLobbyRooms(Array.isArray(payload.games) ? payload.games : []);
    } catch {
      setLobbyRooms([]);
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const rulesTimer =
      window.localStorage.getItem("mafia-rules-seen") !== "true"
        ? window.setTimeout(() => setShowRules(true), 0)
        : undefined;
    const savedCode = window.localStorage.getItem("mafia-room-code");
    const savedName = window.localStorage.getItem("mafia-player-name");
    const savedPassword = window.localStorage.getItem("mafia-room-password") ?? "";
    if (savedCode && savedName) {
      // Restore the browser session before reconnecting the live room.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setJoinCode(savedCode);
      setJoinName(savedName);
      setMyName(savedName);
      setJoinPassword(savedPassword);
      void fetch(`/api/game?roomCode=${encodeURIComponent(savedCode)}`)
        .then((response) => response.json())
        .then((payload) => {
          if (!payload.error && payload.code) {
            if (payload.closed) {
              clearLocalSession("The room was closed.");
              return;
            }

            setGame(payload);
            setNotice(`Welcome back to ${payload.roomName}.`);
          } else {
            const snapshot = window.localStorage.getItem("mafia-room-snapshot");
            if (snapshot) {
              try {
                const savedRoom = JSON.parse(snapshot) as GameState;
                if (savedRoom.code === savedCode) {
                  setGame(savedRoom);
                  setNotice("Restored your last room view. Reconnecting to the room server...");
                  return;
                }
              } catch {
                window.localStorage.removeItem("mafia-room-snapshot");
              }
            }
            setFieldErrors({ joinCode: payload.error ?? "This room is no longer available." });
          }
        })
        .catch(() => {
          const snapshot = window.localStorage.getItem("mafia-room-snapshot");
          if (snapshot) {
            try {
              const savedRoom = JSON.parse(snapshot) as GameState;
              if (savedRoom.code === savedCode) {
                setGame(savedRoom);
                setNotice("Restored your last room view. Reconnecting to the room server...");
                return;
              }
            } catch {
              window.localStorage.removeItem("mafia-room-snapshot");
            }
          }
          setFieldErrors({ joinCode: "Unable to restore this room right now." });
        });
    }
    return () => {
      if (rulesTimer !== undefined) {
        window.clearTimeout(rulesTimer);
      }
    };
  }, []);

  function dismissRules() {
    window.localStorage.setItem("mafia-rules-seen", "true");
    setShowRules(false);
  }

  useEffect(() => {
    if (!showRules) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [showRules]);

  useEffect(() => {
    if (typeof window !== "undefined" && game?.code) {
      window.localStorage.setItem("mafia-room-code", game.code);
      if (myName) {
        window.localStorage.setItem("mafia-player-name", myName);
      }
      window.localStorage.setItem("mafia-room-snapshot", JSON.stringify(game));
      if (joinPassword || roomPassword) {
        window.localStorage.setItem("mafia-room-password", joinPassword || roomPassword);
      }
    }
  }, [game, joinPassword, myName, roomPassword]);

  const currentPlayer = useMemo(() => {
    if (!game) {
      return null;
    }

    return game.players.find((player) => player.name === myName) ?? null;
  }, [game, myName]);

  const livingTargets = useMemo(() => {
    if (!game || !currentPlayer) {
      return [];
    }
    return game.players.filter((player) => player.isAlive && player.name !== currentPlayer.name);
  }, [game, currentPlayer]);

  const godIsViewing = Boolean(
    game &&
      game.phase !== "lobby" &&
      game.mode === "with-god" &&
      currentPlayer &&
      game.godName === currentPlayer.name,
  );

  const cannotActAsGod = Boolean(godIsViewing && game?.mode === "with-god");

  const canMafiaAct = Boolean(
    game &&
      currentPlayer &&
      !cannotActAsGod &&
      currentPlayer.isAlive &&
      currentPlayer.role === "mafia" &&
      game.phase === "mafia-turn" &&
      game.winner === null,
  );

  const canVote = Boolean(
    game &&
      currentPlayer &&
      !cannotActAsGod &&
      currentPlayer.isAlive &&
      game.phase === "village-vote" &&
      !game.votedPlayers.includes(currentPlayer.name) &&
      game.winner === null,
  );
  const canDeclareInnocent = Boolean(
    game &&
      currentPlayer &&
      game.physicalMode &&
      currentPlayer.isAlive &&
      currentPlayer.role === "villager" &&
      game.phase === "mafia-turn" &&
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

    const socket = io({ transports: ["websocket", "polling"], reconnection: true, reconnectionAttempts: Infinity });
    socketRef.current = socket;

    socket.on("connect", () => {
      socket.emit("room:join", {
        roomCode: game.code,
        playerName: myName || currentPlayer?.name,
        password: joinPassword || roomPassword || window.localStorage.getItem("mafia-room-password") || "",
      });
    });

    socket.on("room:update", (updatedRoom: GameState) => {
      setGame(updatedRoom);
    });

    socket.on("room:closed", () => {
      clearLocalSession("The moderator closed this room.");
    });

    socket.on("room:error", ({ message }: { message: string }) => {
      setNotice(message);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [currentPlayer?.name, game?.code, joinPassword, myName, roomPassword]);

  useEffect(() => {
    if (!game?.code) {
      return undefined;
    }

    let stopped = false;
    const refreshRoom = async () => {
      try {
        const response = await fetch(`/api/game?roomCode=${encodeURIComponent(game.code)}`, {
          cache: "no-store",
          headers: { "Cache-Control": "no-cache" },
        });
        const payload = await response.json();
        if (!stopped && payload.code === game.code) {
          setGame((current) => {
            if (!current || payload.updatedAt >= current.updatedAt) {
              return payload;
            }
            return current;
          });
        }
      } catch {
        // Socket.IO remains the primary transport; polling is a best-effort fallback.
      }
    };

    void refreshRoom();
    const timer = window.setInterval(() => void refreshRoom(), 2000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [game?.code]);

  function setFieldError(name: string, message: string) {
    setFieldErrors((current) => ({ ...current, [name]: message }));
  }

  async function createRoom(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextName = myName.trim();
    const nextErrors: Record<string, string> = {};

    if (!nextName) {
      nextErrors.moderatorName = "Please enter your name.";
    }
    if (!roomPassword.trim()) {
      nextErrors.roomPassword = "A room password is required.";
    }

    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setIsBusy(true);
    setNotice("Creating the room...");

    const response = await fetch("/api/game", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create",
        mode: "without-god",
        moderatorName: nextName,
        players: [],
        password: roomPassword.trim() || undefined,
        physicalMode: true,
      }),
    });

    const payload = await response.json();
    setIsBusy(false);

    if (payload.error) {
      setNotice(payload.error);
      setFieldError("moderatorName", payload.error);
      return;
    }

    setGame(payload);
    setMyName(nextName);
    setJoinCode(payload.code);
    setJoinName(nextName);
    if (roomPassword.trim()) {
      window.localStorage.setItem("mafia-room-password", roomPassword.trim());
    }
    setTargetChoice("");
    setNotice(`${payload.roomName} is ready. Share code ${payload.code} and wait for players to join.`);
    setJoinPassword(roomPassword);
    setRoomPassword("");
    setFieldErrors({});
  }

  async function joinRoom(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextName = joinName.trim();
    const nextCode = joinCode.trim();
    const nextErrors: Record<string, string> = {};

    if (!nextCode) {
      nextErrors.joinCode = "Enter the room code.";
    }
    if (!nextName) {
      nextErrors.joinName = "Enter your player name.";
    }
    if (!joinPassword.trim()) {
      nextErrors.joinPassword = "A room password is required.";
    }

    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setIsBusy(true);
    setNotice("Joining room...");

    const response = await fetch("/api/game", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "join",
        roomCode: nextCode,
        playerName: nextName,
        password: joinPassword,
      }),
    });

    const payload = await response.json();
    setIsBusy(false);

    if (payload.error) {
      setNotice(payload.error);
      setFieldError(payload.field ?? "joinCode", payload.error);
      return;
    }

    const joinedPlayer = payload.players.find(
      (player: { name: string }) => player.name.toLowerCase() === nextName.toLowerCase(),
    );
    const canonicalName = joinedPlayer?.name ?? nextName;
    setGame(payload);
    setMyName(canonicalName);
    setJoinCode(nextCode);
    setJoinName(canonicalName);
    if (joinPassword) {
      window.localStorage.setItem("mafia-room-password", joinPassword);
    }
    setTargetChoice("");
    setNotice(`${payload.roomName} joined successfully. Waiting for the host to start the game.`);
    setFieldErrors({});
  }

  async function runAction(action: "mafia-kill" | "village-vote" | "restart" | "start-game" | "transfer-moderator", targetOverride?: string) {
    if (!game || !currentPlayer) {
      return;
    }

    if (action !== "restart" && action !== "start-game" && action !== "transfer-moderator") {
      const actionTarget = targetOverride ?? targetChoice;
      if (!actionTarget) {
        setNotice("Select a valid target before taking action.");
        return;
      }
    }

    setIsBusy(true);

    const body: Record<string, string | undefined> = {
      action,
      roomCode: game.code,
      actor: currentPlayer.name,
    };

    if (action === "mafia-kill" || action === "village-vote" || action === "transfer-moderator") {
      body.target = targetOverride ?? targetChoice;
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

    if (payload.closed) {
      window.localStorage.removeItem("mafia-room-code");
      window.localStorage.removeItem("mafia-player-name");
      window.localStorage.removeItem("mafia-room-password");
      window.localStorage.removeItem("mafia-room-snapshot");
      setGame(null);
      setMyName("");
      setJoinCode("");
      setJoinName("");
      setNotice("The room was closed.");
      return;
    }

    setGame(payload);
    setTargetChoice("");

    setNotice(
      action === "start-game"
        ? "The game has started. Roles are now active."
        : action === "restart"
          ? "A new game has started. Roles have been refreshed."
          : action === "transfer-moderator"
            ? `Moderator rights transferred to ${targetOverride}.`
          : action === "mafia-kill"
            ? `${currentPlayer.name} targeted ${targetOverride ?? targetChoice}.`
            : action === "village-vote" && targetOverride === currentPlayer.name
              ? `${currentPlayer.name} declared they are innocent.`
            : `${currentPlayer.name} voted against ${targetOverride ?? targetChoice}.`,
    );
  }

  async function leaveRoom() {
    if (!game || isBusy) return;
    if (!window.confirm("Are you sure you want to quit the game?")) return;

    if (!currentPlayer) {
      clearLocalSession("You left the room.");
      return;
    }

    setIsBusy(true);
    try {
      const response = await fetch("/api/game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "leave-room", roomCode: game.code, actor: currentPlayer.name }),
        signal: AbortSignal.timeout(8000),
      });
      const payload = await response.json();
      clearLocalSession(payload.error ? "You left the room on this device." : payload.closed ? "The game ended because a player left." : "You left the room.");
    } catch {
      clearLocalSession("You left the room on this device. The server could not be reached.");
    }
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

      const roomHasPassword = Boolean(room.password);
      const roomIsActive = room.winner === null;
      const matchesStatus =
        roomFilterStatus === "all" ||
        (roomFilterStatus === "locked" && roomHasPassword) ||
        (roomFilterStatus === "active" && roomIsActive) ||
        (roomFilterStatus === "finished" && !roomIsActive);

      return matchesSearch && matchesStatus;
    });
  }, [lobbyRooms, roomFilterStatus, roomSearch]);

  const isNightPhase = game?.phase === "mafia-turn";
  const mafiaAliveCount = game ? game.players.filter((player) => player.isAlive && player.role === "mafia").length : 0;
  const villagerAliveCount = game ? game.players.filter((player) => player.isAlive && player.role === "villager").length : 0;
  const survivingPlayers = game ? game.players.filter((player) => player.isAlive).map((player) => player.name) : [];
  const winnerTone = game?.winner === "mafia" ? "mafia" : "villager";
  const lastElimination = game && game.log.length > 0 ? game.log[0] : "No elimination logged yet";
  const totalVotesCast = game ? Object.keys(game.votesByPlayer).length : 0;
  const mafiaNames = game ? game.players.filter((player) => player.role === "mafia").map((player) => player.name) : [];
  const isModerator = Boolean(game && currentPlayer && game.temporaryModerator === currentPlayer.name);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#111827,_#020617_55%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6 animate-[fadeInScale_0.7s_ease-out]">
        <header className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-2xl shadow-slate-950/40 backdrop-blur-sm transition-all duration-500 hover:border-amber-400/40">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.32em] text-amber-300">Mafia game room</p>
              <h1 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">Mafia Game</h1>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              {notice ? (
                <div className="rounded-2xl border border-sky-400/30 bg-sky-500/10 px-3 py-2 text-sm font-medium text-sky-100 shadow-lg shadow-sky-900/10" role="status">
                  {notice}
                </div>
              ) : null}
              {game && game.phase !== "lobby" ? (
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

        {showRules ? (
          <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/85 p-0 backdrop-blur-md sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="rules-title">
            <section className="flex max-h-[100dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-amber-400/30 bg-slate-900 shadow-2xl shadow-black/50 sm:max-h-[92vh] sm:rounded-3xl">
              <div className="flex items-start justify-between gap-4 border-b border-white/10 p-5 pt-[max(1.25rem,env(safe-area-inset-top))] sm:p-7">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-300">Welcome to Mafia Game</p>
                  <h2 id="rules-title" className="mt-2 text-2xl font-black text-white sm:text-4xl">How to play</h2>
                </div>
                <button type="button" onClick={dismissRules} aria-label="Close game rules" className="rounded-xl border border-slate-700 px-3 py-2 text-xl text-slate-300 hover:border-amber-400 hover:text-white">
                  ×
                </button>
              </div>
              <div className="min-h-0 overflow-y-auto p-5 sm:p-7">
                <div className="space-y-6 text-sm leading-7 text-slate-300 sm:text-base">
                  <div>
                    <h3 className="font-bold text-white">1. Create or join a private room</h3>
                    <p>Create a room with a password and share the room code and password with your friends. Each game has one hidden Mafia player, and everyone joins the lobby using their own name.</p>
                  </div>
                  <div>
                    <h3 className="font-bold text-white">2. Start the game</h3>
                    <p>The moderator waits until everyone is in the lobby, then starts the game. Roles are assigned secretly and randomly. The moderator has no special role knowledge after the game starts.</p>
                  </div>
                  <div>
                    <h3 className="font-bold text-white">3. Mafia turn</h3>
                    <p>The Mafia player quietly touches the player they want to eliminate, then selects that player in the app. The selected player is removed and the village vote begins.</p>
                  </div>
                  <div>
                    <h3 className="font-bold text-white">4. Innocent check</h3>
                    <p>During the Mafia turn, villagers tap only <strong className="text-emerald-200">I&apos;m innocent</strong> on their own device view. This prevents villagers from seeing or guessing the Mafia when playing physically in the same room.</p>
                  </div>
                  <div>
                    <h3 className="font-bold text-white">5. Village vote</h3>
                    <p>After the Mafia action, discuss in person. Every living player votes for one suspect. The player with the most votes is eliminated; ties do not eliminate anyone.</p>
                  </div>
                  <div>
                    <h3 className="font-bold text-white">6. Winning and leaving</h3>
                    <p>Villagers win when the Mafia player is eliminated. Mafia wins when the Mafia player equals or outnumbers the living villagers. If the Mafia player or the moderator quits, the game ends immediately. Any player can quit after confirming.</p>
                  </div>
                </div>
              </div>
              <div className="border-t border-white/10 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-7">
                <button type="button" onClick={dismissRules} className="w-full rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 px-5 py-3 font-bold text-slate-950 shadow-lg shadow-amber-950/30">
                  I understand — start playing
                </button>
              </div>
            </section>
          </div>
        ) : null}

        {!game ? (
          <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-3xl border border-amber-400/20 bg-slate-900/70 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.45)] backdrop-blur-sm transition-all duration-500 hover:border-amber-400/45 hover:shadow-[0_18px_60px_rgba(251,191,36,0.08)] sm:p-6">
              <h2 className="text-2xl font-bold text-white">Create a room</h2>
              <form onSubmit={createRoom} className="mt-6 space-y-5">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-200">Your name</label>
                  <input
                    value={myName}
                    onChange={(event) => {
                      setMyName(event.target.value);
                      if (fieldErrors.moderatorName) {
                        setFieldErrors((current) => ({ ...current, moderatorName: "" }));
                      }
                    }}
                    className={`w-full rounded-2xl border bg-slate-950/70 px-4 py-3 text-white outline-none transition duration-200 focus:ring-2 ${fieldErrors.moderatorName ? "border-red-400 focus:border-red-400 focus:ring-red-500/30" : "border-slate-700 focus:border-amber-400 focus:ring-amber-500/30"}`}
                    placeholder="Pick a player name"
                  />
                  {fieldErrors.moderatorName ? <p className="mt-2 text-sm text-red-300">{fieldErrors.moderatorName}</p> : null}
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-200">Room password</label>
                  <input
                    type="password"
                    value={roomPassword}
                    onChange={(event) => {
                      setRoomPassword(event.target.value);
                      if (fieldErrors.roomPassword) setFieldErrors((current) => ({ ...current, roomPassword: "" }));
                    }}
                    className={`w-full rounded-2xl border bg-slate-950/70 px-4 py-3 text-white outline-none transition duration-200 focus:ring-2 ${fieldErrors.roomPassword ? "border-red-400 focus:border-red-400 focus:ring-red-500/30" : "border-slate-700 focus:border-amber-400 focus:ring-amber-500/30"}`}
                    placeholder="Enter a room password"
                  />
                  {fieldErrors.roomPassword ? <p className="mt-2 text-sm text-red-300">{fieldErrors.roomPassword}</p> : null}
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
                      onChange={(event) => {
                        setJoinCode(event.target.value.toUpperCase());
                        if (fieldErrors.joinCode) {
                          setFieldErrors((current) => ({ ...current, joinCode: "" }));
                        }
                      }}
                      className={`w-full rounded-2xl border bg-slate-950/70 px-4 py-3 text-white outline-none transition duration-200 focus:ring-2 ${fieldErrors.joinCode ? "border-red-400 focus:border-red-400 focus:ring-red-500/30" : "border-slate-700 focus:border-sky-400 focus:ring-sky-500/30"}`}
                      placeholder="ABC123"
                    />
                    {fieldErrors.joinCode ? <p className="mt-2 text-sm text-red-300">{fieldErrors.joinCode}</p> : null}
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-200">Player name</label>
                    <input
                      value={joinName}
                      onChange={(event) => {
                        setJoinName(event.target.value);
                        if (fieldErrors.joinName) {
                          setFieldErrors((current) => ({ ...current, joinName: "" }));
                        }
                      }}
                      className={`w-full rounded-2xl border bg-slate-950/70 px-4 py-3 text-white outline-none transition duration-200 focus:ring-2 ${fieldErrors.joinName ? "border-red-400 focus:border-red-400 focus:ring-red-500/30" : "border-slate-700 focus:border-sky-400 focus:ring-sky-500/30"}`}
                      placeholder="Enter the player name in this room"
                    />
                    {fieldErrors.joinName ? <p className="mt-2 text-sm text-red-300">{fieldErrors.joinName}</p> : null}
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-200">Room password</label>
                    <input
                      type="password"
                      value={joinPassword}
                      onChange={(event) => {
                        setJoinPassword(event.target.value);
                        if (fieldErrors.joinPassword) setFieldErrors((current) => ({ ...current, joinPassword: "" }));
                      }}
                      className={`w-full rounded-2xl border bg-slate-950/70 px-4 py-3 text-white outline-none transition duration-200 focus:ring-2 ${fieldErrors.joinPassword ? "border-red-400 focus:border-red-400 focus:ring-red-500/30" : "border-slate-700 focus:border-sky-400 focus:ring-sky-500/30"}`}
                      placeholder="Enter the room password"
                    />
                    {fieldErrors.joinPassword ? <p className="mt-2 text-sm text-red-300">{fieldErrors.joinPassword}</p> : null}
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
                    value={roomFilterStatus}
                    onChange={(event) => setRoomFilterStatus(event.target.value as "all" | "locked" | "active" | "finished")}
                    className="rounded-2xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white outline-none transition duration-200 focus:border-amber-400 focus:ring-2 focus:ring-amber-500/30"
                  >
                    <option value="all">All rooms</option>
                    <option value="locked">Locked</option>
                    <option value="active">In progress</option>
                    <option value="finished">Finished</option>
                  </select>

                  <button
                    type="button"
                    onClick={() => {
                      setRoomSearch("");
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
                <h3 className="text-xl font-bold text-white">How Mafia Game works</h3>
                <ul className="mt-4 space-y-3 text-sm leading-7 text-slate-300">
                  <li>• Create a password-protected room and share its code with your friends.</li>
                  <li>• Everyone joins the lobby; the moderator starts once all players are ready.</li>
                  <li>• Roles are randomly assigned when the game starts and stay hidden.</li>
                  <li>• Mafia secretly touches one player and records the target in the app.</li>
                  <li>• During the Mafia turn, villagers tap only <strong className="text-emerald-200">I&apos;m innocent</strong> on their own device view. This prevents villagers from seeing or guessing the Mafia when playing physically in the same room.</li>
                  <li>• The living players discuss and vote. The highest vote eliminates a player; ties mean nobody is eliminated.</li>
                  <li>• Villagers win by eliminating all Mafia. Mafia wins when they equal or outnumber the villagers.</li>
                  <li>• Any player can quit after confirmation. If Mafia or the moderator quits, the game ends.</li>
                </ul>
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
                      <div className="rounded-2xl border border-red-400/20 bg-red-500/10 p-4">
                        <p className="text-[10px] uppercase tracking-[0.3em] text-red-200">Mafia reveal</p>
                        <p className="mt-3 text-sm font-semibold text-red-100">{mafiaNames.join(", ") || "No mafia assigned"}</p>
                      </div>
                    </div>

                    {game && currentPlayer ? (
                      <div className="flex flex-col justify-end gap-3 sm:flex-row">
                        {isModerator ? (
                        <button type="button" onClick={() => void runAction("restart")} className="rounded-2xl bg-gradient-to-r from-emerald-400 to-cyan-500 px-5 py-3 font-bold text-slate-950 shadow-lg shadow-emerald-900/30">
                          New game
                        </button>
                        ) : null}
                        <button type="button" onClick={() => void leaveRoom()} className="rounded-2xl border border-red-400/40 bg-red-500/15 px-5 py-3 font-bold text-red-100">
                          Quit game
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}

            {game.phase !== "lobby" ? (
              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Room</p>
                  <h2 className="mt-2 text-xl font-bold text-white sm:text-2xl">{game.roomName}</h2>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Players</p>
                  <h2 className="mt-2 text-lg font-bold text-white sm:text-xl">{game.players.length}</h2>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Phase</p>
                  <h2 className="mt-2 text-lg font-bold text-white sm:text-xl">{game.phase}</h2>
                </div>
              </div>
            ) : null}

            <div className={`rounded-3xl border p-4 sm:p-6 ${isNightPhase ? "border-amber-500/30 bg-gradient-to-r from-amber-500/10 to-red-500/10" : "border-sky-400/30 bg-gradient-to-r from-sky-500/10 to-cyan-500/10"}`}>
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-300">Current player</p>
                  <div className="mt-2 flex items-center gap-3 rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-white">
                    <span className="text-xl">{currentPlayer?.avatar ?? "🎭"}</span>
                    <span className="font-semibold">{currentPlayer?.name ?? "Unknown"}</span>
                  </div>
                </div>

                {game.phase === "lobby" ? (
                  <div className="rounded-3xl border border-amber-400/30 bg-slate-900/70 p-5 shadow-xl shadow-slate-950/20 sm:p-6">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.3em] text-amber-300">Lobby</p>
                        <h2 className="mt-2 text-2xl font-black text-white">Players in this room</h2>
                      </div>
                      <span className="rounded-full bg-amber-500/15 px-3 py-1 text-sm font-semibold text-amber-100">
                        {game.players.length} joined
                      </span>
                    </div>
                    <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {game.players.map((player) => (
                        <div key={player.name} className="flex items-center gap-3 rounded-2xl border border-slate-700 bg-slate-950/60 p-4">
                          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-900 text-2xl">{player.avatar}</span>
                          <div>
                            <p className="font-bold text-white">{player.name}</p>
                            {player.name === game.temporaryModerator ? (
                              <p className="text-xs uppercase tracking-[0.2em] text-amber-300">Moderator</p>
                            ) : (
                              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Player</p>
                            )}
                          </div>
                          {isModerator && player.name !== currentPlayer?.name ? (
                            <button type="button" onClick={() => void runAction("transfer-moderator", player.name)} className="ml-auto rounded-xl border border-amber-400/30 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-200">
                              Transfer
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                    <p className="mt-4 text-sm text-slate-300">
                      Share room code <span className="font-bold text-white">{game.code}</span>. Players can join until you start the game.
                    </p>
                    {notice ? (
                      <p className="mt-4 rounded-2xl border border-slate-700 bg-slate-950/60 p-3 text-sm text-slate-200" role="status">
                        {notice}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <div className="rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-sm text-slate-200">
                  {game.phase === "lobby"
                    ? "Lobby phase – waiting for all players to join"
                    : isNightPhase
                      ? "Night phase – mafia is choosing"
                      : game.physicalMode
                        ? "Day phase – villagers pick the innocent suspect"
                        : "Day phase – village is voting"}
                </div>

                {game.phase === "lobby" && currentPlayer && currentPlayer.name === game.temporaryModerator ? (
                  <button
                    type="button"
                    onClick={() => void runAction("start-game")}
                    className="rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 px-5 py-3 font-bold text-slate-950 shadow-lg shadow-amber-900/30"
                  >
                    Start game
                  </button>
                ) : game.winner && isModerator ? (
                  <button
                    type="button"
                    onClick={() => void runAction("restart")}
                    className="rounded-2xl bg-gradient-to-r from-emerald-400 to-cyan-500 px-5 py-3 font-bold text-slate-950 shadow-lg shadow-emerald-900/30"
                  >
                    Start new game
                  </button>
                ) : null}
                {game ? (
                  <button type="button" onClick={() => void leaveRoom()} disabled={isBusy} className="rounded-2xl border border-red-400/30 bg-red-500/10 px-5 py-3 font-bold text-red-100 disabled:cursor-not-allowed disabled:opacity-60">
                    Quit game
                  </button>
                ) : null}
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
              <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 sm:p-6">
                <h3 className="text-xl font-bold text-white">Role overview</h3>

                {game.phase === "lobby" ? (
                  <div className="mt-5 rounded-2xl border border-slate-700 bg-slate-950/60 p-4 text-slate-300">
                    The room is waiting for players. Once everyone has joined, the moderator can start the match.
                  </div>
                ) : (
                  <>
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
                  </>
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

                  {canDeclareInnocent ? (
                    <button
                      type="button"
                      onClick={() => void runAction("village-vote", currentPlayer?.name)}
                      disabled={isBusy}
                      className="w-full rounded-2xl border border-emerald-400/40 bg-emerald-500/15 px-4 py-3 font-bold text-emerald-100 shadow-lg shadow-emerald-950/20 disabled:opacity-60"
                    >
                      I&apos;m innocent
                    </button>
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

                  {isModerator && game.phase !== "lobby" && game.winner === null ? (
                    <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 p-4">
                      <p className="text-xs uppercase tracking-[0.25em] text-amber-200">Moderator rights</p>
                      <div className="mt-3 space-y-2">
                        {game.players
                          .filter((player) => player.isAlive && player.name !== currentPlayer?.name)
                          .map((player) => (
                            <button
                              key={player.name}
                              type="button"
                              onClick={() => void runAction("transfer-moderator", player.name)}
                              disabled={isBusy}
                              className="mr-2 rounded-xl border border-amber-300/30 px-3 py-2 text-sm font-semibold text-amber-100 disabled:opacity-60"
                            >
                              Transfer to {player.name}
                            </button>
                          ))}
                      </div>
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

            <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 sm:p-6">
              <h3 className="text-xl font-bold text-white">Player board</h3>
              <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {game.players.map((player) => {
                  const revealRole = game.mode === "with-god" && godIsViewing;
                  return (
                    <div
                      key={player.name}
                      className={`rounded-2xl border p-4 ${
                        player.isAlive ? "border-slate-700 bg-slate-950/60" : "border-red-500/40 bg-red-500/10"
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
                {game.log
  .filter((entry) => !entry.toLowerCase().includes("innocent"))
  .map((entry, index) => (
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
