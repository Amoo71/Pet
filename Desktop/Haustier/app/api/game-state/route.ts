import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { BACKGROUNDS } from "@/lib/gameConfig";
import { DEFAULT_SHARED_GAME_STATE, type SharedGameState, type SharedPet } from "@/lib/sharedGameState";

export const runtime = "nodejs";

const stateFile = path.join(process.cwd(), ".data", "game-state.json");
const stateKey = "haustier:game-state";
let memoryState: SharedGameState = DEFAULT_SHARED_GAME_STATE;
const DAY_MS = 24 * 60 * 60 * 1000;
const DECAY_STEP_MS = 4 * 60 * 60 * 1000;
const DECAY_PER_STEP = 1;
const AUTO_STEP_MS = 22_000;
const AUTO_ROOM_CHANGE_CHANCE = 0.18;
const ROOM_EXIT_LEFT_X = 7;
const ROOM_EXIT_RIGHT_X = 93;
const ROOM_EDGE_TARGET_Y = 82;
const roomIds = BACKGROUNDS.map((background) => background.id);

export async function GET() {
  const state = await readState();
  return NextResponse.json(state);
}

export async function PUT(request: Request) {
  const incoming = (await request.json()) as Partial<SharedGameState>;
  const current = await readState();
  const mergedState: SharedGameState = {
    ...current,
    ...incoming,
    stats: { ...current.stats, ...incoming.stats },
    lifecycle: { ...current.lifecycle, ...incoming.lifecycle },
    pet: { ...current.pet, ...incoming.pet },
    pets: mergePets(current.pets, incoming.pets),
    ball: { ...current.ball, ...incoming.ball },
    food: { ...current.food, ...incoming.food },
    bed: { ...current.bed, ...incoming.bed },
    notes: incoming.notes ?? current.notes,
    version: current.version + 1,
    updatedAt: Date.now(),
    updatedBy: incoming.updatedBy ?? "unknown"
  };
  const nextState = applyLifecycle(mergedState, Date.now());

  await writeState(nextState);
  return NextResponse.json(nextState);
}

export async function POST(request: Request) {
  const incoming = (await request.json().catch(() => ({}))) as Partial<SharedGameState>;
  const current = await readState();
  const now = Date.now();
  const roomId = incoming.backgroundId ?? DEFAULT_SHARED_GAME_STATE.backgroundId;
  const restartState: SharedGameState = {
    ...DEFAULT_SHARED_GAME_STATE,
    version: current.version + 1,
    updatedAt: now,
    updatedBy: incoming.updatedBy ?? "unknown",
    petName: "Momo",
    backgroundId: roomId,
    stats: { ...DEFAULT_SHARED_GAME_STATE.stats },
    lifecycle: getDefaultLifecycle(now),
    pet: {
      ...DEFAULT_SHARED_GAME_STATE.pet,
      position: { ...DEFAULT_SHARED_GAME_STATE.pet.position }
    },
    pets: [getDefaultPet("pet1", "pet", "Momo", now)],
    ball: {
      ...DEFAULT_SHARED_GAME_STATE.ball,
      roomId,
      position: { ...DEFAULT_SHARED_GAME_STATE.ball.position },
      lastPlayerTouchedAt: now
    },
    food: {
      ...DEFAULT_SHARED_GAME_STATE.food,
      roomId,
      position: { ...DEFAULT_SHARED_GAME_STATE.food.position }
    },
    bed: {
      ...DEFAULT_SHARED_GAME_STATE.bed,
      roomId,
      position: { ...DEFAULT_SHARED_GAME_STATE.bed.position }
    },
    notes: []
  };

  await writeState(restartState);
  return NextResponse.json(restartState);
}

async function readState() {
  try {
    const parsed = await readRemoteState() ?? await readFileState();
    memoryState = applyLifecycle({
      ...DEFAULT_SHARED_GAME_STATE,
      ...parsed,
      stats: { ...DEFAULT_SHARED_GAME_STATE.stats, ...parsed.stats },
      lifecycle: { ...getDefaultLifecycle(Date.now()), ...parsed.lifecycle },
      pet: { ...DEFAULT_SHARED_GAME_STATE.pet, ...parsed.pet },
      pets: normalizePets(parsed, Date.now()),
      ball: { ...DEFAULT_SHARED_GAME_STATE.ball, ...parsed.ball },
      food: { ...DEFAULT_SHARED_GAME_STATE.food, ...parsed.food },
      bed: { ...DEFAULT_SHARED_GAME_STATE.bed, ...parsed.bed },
      notes: parsed.notes ?? DEFAULT_SHARED_GAME_STATE.notes
    } as SharedGameState, Date.now());
  } catch {
    await writeState(memoryState);
  }

  const appliedState = applyLifecycle(memoryState, Date.now());
  if (appliedState !== memoryState) await writeState(appliedState);

  return memoryState;
}

async function writeState(state: SharedGameState) {
  memoryState = state;
  if (await writeRemoteState(state)) return;
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  await fs.writeFile(stateFile, JSON.stringify(state, null, 2));
}

async function readFileState() {
  const file = await fs.readFile(stateFile, "utf8");
  return JSON.parse(file) as Partial<SharedGameState>;
}

async function readRemoteState() {
  const config = getRemoteStateConfig();
  if (!config) return null;

  try {
    const response = await fetch(`${config.url}/get/${encodeURIComponent(stateKey)}`, {
      headers: { Authorization: `Bearer ${config.token}` },
      cache: "no-store"
    });
    if (!response.ok) return null;

    const payload = await response.json() as { result?: unknown };
    if (!payload.result) return null;
    return typeof payload.result === "string" ? JSON.parse(payload.result) as Partial<SharedGameState> : payload.result as Partial<SharedGameState>;
  } catch {
    return null;
  }
}

async function writeRemoteState(state: SharedGameState) {
  const config = getRemoteStateConfig();
  if (!config) return false;

  try {
    const response = await fetch(`${config.url}/set/${encodeURIComponent(stateKey)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(state)
    });
    return response.ok;
  } catch {
    return false;
  }
}

function getRemoteStateConfig() {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

function getDefaultLifecycle(now: number) {
  return {
    createdAt: now,
    lastFedAt: now,
    lastPlayedAt: now,
    lastSleptAt: now,
    lastDecayAt: now,
    deadAt: 0
  };
}

function getDefaultPet(id: SharedPet["id"], assetKey: string, name: string, now: number): SharedPet {
  return {
    id,
    updatedAt: now,
    assetKey,
    name,
    stats: { ...DEFAULT_SHARED_GAME_STATE.stats },
    lifecycle: getDefaultLifecycle(now),
    roomId: DEFAULT_SHARED_GAME_STATE.backgroundId,
    state: "sitzen",
    position: { x: id === "pet1" ? 50 : 58, y: 78 },
    facing: 1,
    walkDurationMs: 0,
    lastAutoAt: now,
    pendingRoomId: "",
    pendingRoomDirection: 0,
    autoExitAt: 0
  };
}

function normalizePets(state: Partial<SharedGameState>, now: number) {
  const pets = Array.isArray(state.pets) ? state.pets : [];
  if (pets.length > 0) {
    return pets.slice(0, 2).map((pet, index) => ({
      ...getDefaultPet(index === 0 ? "pet1" : "pet2", index === 0 ? "pet" : "pet2", index === 0 ? "Momo" : "Pet 2", now),
      ...pet,
      stats: { ...DEFAULT_SHARED_GAME_STATE.stats, ...pet.stats },
      lifecycle: { ...getDefaultLifecycle(now), ...pet.lifecycle },
      roomId: pet.roomId ?? state.backgroundId ?? DEFAULT_SHARED_GAME_STATE.backgroundId,
      position: { x: pet.position?.x ?? (index === 0 ? 50 : 58), y: pet.position?.y ?? 78 },
      lastAutoAt: pet.lastAutoAt ?? now,
      pendingRoomId: pet.pendingRoomId ?? "",
      pendingRoomDirection: pet.pendingRoomDirection ?? 0,
      autoExitAt: pet.autoExitAt ?? 0
    }));
  }

  return [{
    ...getDefaultPet("pet1", "pet", state.petName ?? "Momo", now),
    name: state.petName ?? "Momo",
    stats: { ...DEFAULT_SHARED_GAME_STATE.stats, ...state.stats },
    lifecycle: { ...getDefaultLifecycle(now), ...state.lifecycle },
    roomId: state.backgroundId ?? DEFAULT_SHARED_GAME_STATE.backgroundId,
    state: state.pet?.state ?? DEFAULT_SHARED_GAME_STATE.pet.state,
    position: { ...DEFAULT_SHARED_GAME_STATE.pet.position, ...state.pet?.position },
    facing: state.pet?.facing ?? DEFAULT_SHARED_GAME_STATE.pet.facing,
    walkDurationMs: state.pet?.walkDurationMs ?? DEFAULT_SHARED_GAME_STATE.pet.walkDurationMs,
    lastAutoAt: now,
    pendingRoomId: "",
    pendingRoomDirection: 0,
    autoExitAt: 0
  }];
}

function mergePets(currentPets: SharedPet[], incomingPets?: SharedPet[]) {
  if (!incomingPets) return currentPets;
  const nextPets = [...currentPets];

  incomingPets.slice(0, 2).forEach((incomingPet) => {
    const index = nextPets.findIndex((pet) => pet.id === incomingPet.id);
    if (index < 0) {
      nextPets.push(incomingPet);
      return;
    }

    if ((incomingPet.updatedAt ?? 0) >= (nextPets[index].updatedAt ?? 0)) {
      nextPets[index] = incomingPet;
    }
  });

  return nextPets.slice(0, 2).sort((a, b) => a.id.localeCompare(b.id));
}

function applyLifecycle(state: SharedGameState, now: number): SharedGameState {
  const nextPets = state.pets.map((pet) => applyPetLifecycle(applyPetAutonomy(pet, now), now));
  const petsChanged = nextPets.some((pet, index) => pet !== state.pets[index]);
  const primaryPet = nextPets[0];
  const baseState = petsChanged && primaryPet ? {
    ...state,
    pets: nextPets,
    petName: primaryPet.name,
    stats: primaryPet.stats,
    lifecycle: primaryPet.lifecycle,
    pet: {
      state: primaryPet.state,
      position: primaryPet.position,
      facing: primaryPet.facing,
      walkDurationMs: primaryPet.walkDurationMs
    }
  } : state;

  if (baseState.lifecycle.deadAt > 0) return baseState;

  const missedCare =
    now - baseState.lifecycle.lastFedAt >= DAY_MS ||
    now - baseState.lifecycle.lastPlayedAt >= DAY_MS ||
    now - baseState.lifecycle.lastSleptAt >= DAY_MS;
  const decaySteps = Math.floor(Math.max(0, now - baseState.lifecycle.lastDecayAt) / DECAY_STEP_MS);
  const decayedStats = decaySteps > 0 ? {
    hunger: clampStat(baseState.stats.hunger - decaySteps * DECAY_PER_STEP),
    energy: clampStat(baseState.stats.energy - decaySteps * DECAY_PER_STEP),
    mood: clampStat(baseState.stats.mood - decaySteps * DECAY_PER_STEP)
  } : baseState.stats;
  const statDeath = decayedStats.hunger <= 0 || decayedStats.energy <= 0 || decayedStats.mood <= 0;

  if (!missedCare && !statDeath && decaySteps <= 0) {
    return petsChanged ? {
      ...baseState,
      version: baseState.version + 1,
      updatedAt: now,
      updatedBy: "server"
    } : baseState;
  }

  return {
    ...baseState,
    version: baseState.version + 1,
    updatedAt: now,
    updatedBy: "server",
    stats: statDeath || missedCare ? { hunger: 0, energy: 0, mood: 0 } : decayedStats,
    lifecycle: {
      ...baseState.lifecycle,
      lastDecayAt: decaySteps > 0 ? baseState.lifecycle.lastDecayAt + decaySteps * DECAY_STEP_MS : baseState.lifecycle.lastDecayAt,
      deadAt: statDeath || missedCare ? now : 0
    },
    pet: statDeath || missedCare ? { ...baseState.pet, state: "sitzen" as const, walkDurationMs: 0 } : baseState.pet,
    ball: statDeath || missedCare ? { ...baseState.ball, visible: false } : baseState.ball,
    food: statDeath || missedCare ? { ...baseState.food, visible: false } : baseState.food,
    bed: statDeath || missedCare ? { ...baseState.bed, visible: false, sleepEndsAt: 0, sleepOwnerId: "server" } : baseState.bed
  };
}

function applyPetAutonomy(pet: SharedPet, now: number): SharedPet {
  if (pet.lifecycle.deadAt > 0 || pet.state === "sleep") return pet;
  if (pet.pendingRoomId && pet.autoExitAt > 0) {
    if (now < pet.autoExitAt) return pet;
    return {
      ...pet,
      updatedAt: now,
      roomId: pet.pendingRoomId,
      state: "laufen",
      position: { x: pet.pendingRoomDirection > 0 ? 24 : 76, y: ROOM_EDGE_TARGET_Y },
      facing: pet.pendingRoomDirection || 1,
      walkDurationMs: 2600,
      lastAutoAt: now,
      pendingRoomId: "",
      pendingRoomDirection: 0,
      autoExitAt: 0
    };
  }
  if (now - pet.lastAutoAt < AUTO_STEP_MS) return pet;

  const seed = hashString(`${pet.id}:${pet.lastAutoAt}:${now}:${pet.position.x}:${pet.roomId}`);
  const roll = (seed % 1000) / 1000;
  const nextAutoAt = now;

  if (roll < 0.2) {
    return { ...pet, updatedAt: now, state: "sitzen", walkDurationMs: 0, lastAutoAt: nextAutoAt };
  }

  if (roll < 0.36) {
    return { ...pet, updatedAt: now, state: "stehen", walkDurationMs: 0, lastAutoAt: nextAutoAt };
  }

  const direction = seed % 2 === 0 ? -1 : 1;
  const currentRoomIndex = Math.max(0, roomIds.indexOf(pet.roomId));
  const canSwitchRoom = roomIds.length > 1 && roll < 0.36 + AUTO_ROOM_CHANGE_CHANCE;

  if (canSwitchRoom) {
    const nextRoomId = roomIds[(currentRoomIndex + direction + roomIds.length) % roomIds.length] ?? pet.roomId;
    const exitTarget = { x: direction > 0 ? ROOM_EXIT_RIGHT_X : ROOM_EXIT_LEFT_X, y: ROOM_EDGE_TARGET_Y };
    const walkDurationMs = getWalkDuration(pet.position, exitTarget);
    return {
      ...pet,
      updatedAt: now,
      state: "laufen",
      position: exitTarget,
      facing: direction,
      walkDurationMs,
      lastAutoAt: nextAutoAt,
      pendingRoomId: nextRoomId,
      pendingRoomDirection: direction,
      autoExitAt: now + walkDurationMs
    };
  }

  const nextX = 12 + ((seed >> 3) % 77);
  const nextY = 72 + ((seed >> 7) % 15);
  return {
    ...pet,
    updatedAt: now,
    state: "laufen",
    position: { x: nextX, y: nextY },
    facing: nextX < pet.position.x ? -1 : 1,
    walkDurationMs: getWalkDuration(pet.position, { x: nextX, y: nextY }),
    lastAutoAt: nextAutoAt,
    pendingRoomId: "",
    pendingRoomDirection: 0,
    autoExitAt: 0
  };
}

function applyPetLifecycle(pet: SharedPet, now: number): SharedPet {
  if (pet.lifecycle.deadAt > 0) return pet;

  const missedCare =
    now - pet.lifecycle.lastFedAt >= DAY_MS ||
    now - pet.lifecycle.lastPlayedAt >= DAY_MS ||
    now - pet.lifecycle.lastSleptAt >= DAY_MS;
  const decaySteps = Math.floor(Math.max(0, now - pet.lifecycle.lastDecayAt) / DECAY_STEP_MS);
  const stats = decaySteps > 0 ? {
    hunger: clampStat(pet.stats.hunger - decaySteps * DECAY_PER_STEP),
    energy: clampStat(pet.stats.energy - decaySteps * DECAY_PER_STEP),
    mood: clampStat(pet.stats.mood - decaySteps * DECAY_PER_STEP)
  } : pet.stats;
  const dead = missedCare || stats.hunger <= 0 || stats.energy <= 0 || stats.mood <= 0;

  if (!dead && decaySteps <= 0) return pet;
  return {
    ...pet,
    updatedAt: now,
    stats: dead ? { hunger: 0, energy: 0, mood: 0 } : stats,
    lifecycle: {
      ...pet.lifecycle,
      lastDecayAt: decaySteps > 0 ? pet.lifecycle.lastDecayAt + decaySteps * DECAY_STEP_MS : pet.lifecycle.lastDecayAt,
      deadAt: dead ? now : 0
    },
    state: dead ? "sitzen" : pet.state,
    walkDurationMs: dead ? 0 : pet.walkDurationMs
  };
}

function clampStat(value: number) {
  return Math.max(0, Math.min(100, value));
}

function getWalkDuration(from: { x: number; y: number }, to: { x: number; y: number }) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  return Math.max(650, Math.round((distance / 8) * 1000));
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
