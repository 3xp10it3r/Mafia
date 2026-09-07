import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAction,
  createGame,
  deleteRoom,
  leavePlayerFromRoom,
  projectGame,
  type StoredGameState,
} from "./game-store";

function startedRoom(names: string[]): StoredGameState {
  const room = createGame({
    mode: "without-god",
    moderatorName: names[0],
    players: names.slice(1),
    password: "test-password",
  });
  return applyAction({ roomCode: room.code, action: "start-game", actor: names[0] });
}

test("mafia target stays pending until every living villager declares innocent", () => {
  const room = startedRoom(["Mafia host", "Villager one", "Villager two", "Villager three"]);
  try {
    const mafia = room.players.find((player) => player.role === "mafia");
    const villagers = room.players.filter((player) => player.role === "villager");
    assert.ok(mafia);
    assert.equal(villagers.length, 3);

    const target = villagers[0];
    assert.ok(target);
    let next = applyAction({ roomCode: room.code, action: "mafia-kill", actor: mafia.name, target: target.name });
    assert.equal(next.phase, "mafia-turn");
    assert.equal(next.pendingKillTarget, target.name);
    assert.equal(target.isAlive, true);
    assert.equal(next.innocentDeclarationsCount, 0);

    for (const [index, villager] of villagers.entries()) {
      next = applyAction({ roomCode: room.code, action: "declare-innocent", actor: villager.name });
      if (index < villagers.length - 1) {
        assert.equal(next.phase, "mafia-turn");
        assert.equal(next.pendingKillTarget, target.name);
        assert.equal(next.players.find((player) => player.name === target.name)?.isAlive, true);
      }
    }

    assert.equal(next.phase, "village-vote");
    assert.equal(next.pendingKillTarget, null);
    assert.equal(next.players.find((player) => player.name === target.name)?.isAlive, false);
  } finally {
    deleteRoom(room.code);
  }
});

test("villager departure recalculates the innocent declaration requirement", () => {
  const room = startedRoom(["Host", "One", "Two", "Three", "Four"]);
  try {
    const mafia = room.players.find((player) => player.role === "mafia");
    const villagers = room.players.filter((player) => player.role === "villager");
    assert.ok(mafia);
    const target = villagers[0];
    const declared = villagers[1];
    const leaving = villagers[2];
    const alsoDeclared = villagers[3];
    assert.ok(target && declared && leaving && alsoDeclared);

    applyAction({ roomCode: room.code, action: "mafia-kill", actor: mafia.name, target: target.name });
    applyAction({ roomCode: room.code, action: "declare-innocent", actor: declared.name });
    applyAction({ roomCode: room.code, action: "declare-innocent", actor: target.name });
    applyAction({ roomCode: room.code, action: "declare-innocent", actor: alsoDeclared.name });
    const afterLeave = leavePlayerFromRoom(room.code, leaving.name);
    assert.ok(afterLeave);
    assert.equal(afterLeave.phase, "village-vote");
    assert.equal(afterLeave.pendingKillTarget, null);
    assert.equal(afterLeave.players.find((player) => player.name === target.name)?.isAlive, false);
  } finally {
    deleteRoom(room.code);
  }
});

test("projections expose aggregate progress but not private target, declarations, or logs", () => {
  const room = startedRoom(["Host A", "Player B", "Player C"]);
  try {
    const mafia = room.players.find((player) => player.role === "mafia");
    const target = room.players.find((player) => player.role === "villager");
    assert.ok(mafia && target);
    const next = applyAction({ roomCode: room.code, action: "mafia-kill", actor: mafia.name, target: target.name });
    const viewer = next.players.find((player) => player.role === "villager");
    assert.ok(viewer);
    const projected = projectGame(next, viewer.name);
    assert.equal(projected.pendingKillTarget, null);
    assert.deepEqual(projected.innocentDeclarations, []);
    assert.deepEqual(projected.log, []);
    assert.equal(projected.innocentDeclarationsCount, 0);
    assert.equal(projected.livingVillagerCount, 2);
  } finally {
    deleteRoom(room.code);
  }
});

test("night actions cover pending, replacement, idempotent declarations, and validation", () => {
  const room = startedRoom(["Host", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"]);
  try {
    const mafia = room.players.find((player) => player.role === "mafia");
    const villagers = room.players.filter((player) => player.role === "villager");
    assert.ok(mafia);
    const firstTarget = villagers[0];
    const secondTarget = villagers[1];
    assert.ok(firstTarget && secondTarget);

    let next = applyAction({ roomCode: room.code, action: "mafia-kill", actor: mafia.name, target: firstTarget.name });
    assert.equal(next.phase, "mafia-turn");
    assert.equal(next.players.find((player) => player.name === firstTarget.name)?.isAlive, true);
    assert.equal(next.innocentDeclarationsCount, 0);

    for (const villager of villagers.slice(0, -1)) {
      next = applyAction({ roomCode: room.code, action: "declare-innocent", actor: villager.name });
    }
    assert.equal(next.innocentDeclarationsCount, villagers.length - 1);
    assert.equal(next.phase, "mafia-turn");
    assert.equal(next.players.find((player) => player.name === firstTarget.name)?.isAlive, true);

    next = applyAction({ roomCode: room.code, action: "mafia-kill", actor: mafia.name, target: secondTarget.name });
    assert.equal(next.pendingKillTarget, secondTarget.name);
    assert.equal(next.players.find((player) => player.name === firstTarget.name)?.isAlive, true);

    const duplicate = applyAction({ roomCode: room.code, action: "declare-innocent", actor: villagers[0].name });
    assert.equal(duplicate.innocentDeclarationsCount, villagers.length - 1);
    assert.equal(duplicate.phase, "mafia-turn");

    assert.throws(
      () => applyAction({ roomCode: room.code, action: "village-suspect", actor: villagers[0].name, target: mafia.name }),
      /day/i,
    );

    next = applyAction({ roomCode: room.code, action: "declare-innocent", actor: villagers[villagers.length - 1].name });
    assert.equal(next.phase, "village-vote");
    assert.equal(next.pendingKillTarget, null);
    assert.equal(next.players.find((player) => player.name === secondTarget.name)?.isAlive, false);

    assert.throws(
      () => applyAction({ roomCode: room.code, action: "declare-innocent", actor: mafia.name }),
      /night|villager/i,
    );
    assert.throws(
      () => applyAction({ roomCode: room.code, action: "mafia-kill", actor: villagers[0].name, target: firstTarget.name }),
      /mafia/i,
    );
  } finally {
    deleteRoom(room.code);
  }
});

test("moderator departure transfers to the first remaining living player", () => {
  const room = createGame({ mode: "without-god", moderatorName: "Host", players: ["One", "Two"], password: "test-password" });
  try {
    const next = leavePlayerFromRoom(room.code, "Host");
    assert.ok(next);
    assert.equal(next.temporaryModerator, "One");
    assert.deepEqual(next.players.map((player) => player.name), ["One", "Two"]);
  } finally {
    deleteRoom(room.code);
  }
});

test("mafia departure closes the room, including when Mafia is moderator", () => {
  const room = startedRoom(["Host", "One", "Two"]);
  const mafia = room.players.find((player) => player.role === "mafia");
  assert.ok(mafia);
  try {
    const next = leavePlayerFromRoom(room.code, mafia.name);
    assert.equal(next, null);
  } finally {
    deleteRoom(room.code);
  }
});

test("pending target leaving cancels only the pending selection and keeps night open", () => {
  const room = startedRoom(["Host", "One", "Two", "Three"]);
  try {
    const mafia = room.players.find((player) => player.role === "mafia");
    const target = room.players.find((player) => player.role === "villager");
    assert.ok(mafia && target);
    applyAction({ roomCode: room.code, action: "mafia-kill", actor: mafia.name, target: target.name });
    const next = leavePlayerFromRoom(room.code, target.name);
    assert.ok(next);
    assert.equal(next.phase, "mafia-turn");
    assert.equal(next.pendingKillTarget, null);
    assert.equal(next.players.some((player) => player.name === target.name), false);
  } finally {
    deleteRoom(room.code);
  }
});
