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
