import assert from "node:assert/strict";
import test from "node:test";
import { deleteRoom, getGameByCode } from "@/lib/game-store";
import { POST } from "./route";

async function jsonResponse(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function sessionCookie(response: Response): string {
  const value = response.headers.get("set-cookie")?.match(/mafia_session=[^;]+/)?.[0];
  assert.ok(value);
  return value;
}

async function post(payload: Record<string, unknown>, cookie?: string): Promise<{ response: Response; body: Record<string, unknown> }> {
  const headers = new Headers({ "content-type": "application/json" });
  if (cookie) headers.set("cookie", cookie);
  const response = await POST(new Request("http://localhost:3000/api/game", { method: "POST", headers, body: JSON.stringify(payload) }));
  return { response, body: await jsonResponse(response) };
}

test("REST routes the canonical night and day actions using session identity", async () => {
  const created = await post({ action: "create", moderatorName: "REST Host", password: "test-password" });
  const roomCode = String(created.body.code);
  const hostCookie = sessionCookie(created.response);
  const cookies = new Map<string, string>([["REST Host", hostCookie]]);

  try {
    for (const name of ["REST One", "REST Two", "REST Three"]) {
      const joined = await post({ action: "join", roomCode, playerName: name, password: "test-password" });
      assert.equal(joined.response.status, 200);
      cookies.set(name, sessionCookie(joined.response));
    }

    const started = await post({ action: "start-game", roomCode }, hostCookie);
    assert.equal(started.response.status, 200);
    const room = getGameByCode(roomCode);
    assert.ok(room);
    const mafia = room.players.find((player) => player.role === "mafia");
    const villagers = room.players.filter((player) => player.role === "villager");
    assert.ok(mafia && villagers[0]);

    const target = villagers[0];
    const mafiaAction = await post({ action: "mafia-kill", roomCode, target: target.name }, cookies.get(mafia.name));
    assert.equal(mafiaAction.response.status, 200);
    assert.equal(getGameByCode(roomCode)?.pendingKillTarget, target.name);

    for (const villager of villagers) {
      const declaration = await post({ action: "declare-innocent", roomCode }, cookies.get(villager.name));
      assert.equal(declaration.response.status, 200);
    }

    const afterNight = getGameByCode(roomCode);
    assert.ok(afterNight);
    assert.equal(afterNight.phase, "village-vote");
    const suspect = afterNight.players.find((player) => player.isAlive && player.name !== mafia.name);
    assert.ok(suspect);
    const dayAction = await post({ action: "village-suspect", roomCode, target: suspect.name }, cookies.get(mafia.name));
    assert.equal(dayAction.response.status, 200);
    assert.equal(getGameByCode(roomCode)?.votedPlayers.includes(mafia.name), true);
  } finally {
    deleteRoom(roomCode);
  }
});

test("REST rejects unsupported actions without invoking the game engine", async () => {
  const created = await post({ action: "create", moderatorName: "REST Invalid", password: "test-password" });
  const roomCode = String(created.body.code);
  try {
    const result = await post({ action: "not-a-game-action", roomCode }, sessionCookie(created.response));
    assert.equal(result.response.status, 400);
    assert.match(String(result.body.error), /unsupported/i);
  } finally {
    deleteRoom(roomCode);
  }
});
