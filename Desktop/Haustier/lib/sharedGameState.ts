import type { PetStateId } from "@/lib/gameConfig";

export type Point = {
  x: number;
  y: number;
};

export type PetStats = {
  hunger: number;
  energy: number;
  mood: number;
};

export type PetLifecycle = {
  createdAt: number;
  lastFedAt: number;
  lastPlayedAt: number;
  lastSleptAt: number;
  lastDecayAt: number;
  deadAt: number;
};

export type SharedPet = {
  id: "pet1" | "pet2";
  updatedAt: number;
  assetKey: string;
  name: string;
  stats: PetStats;
  lifecycle: PetLifecycle;
  roomId: string;
  state: PetStateId;
  position: Point;
  facing: number;
  walkDurationMs: number;
  lastAutoAt: number;
  pendingRoomId: string;
  pendingRoomDirection: number;
  autoExitAt: number;
};

export type SharedNote = {
  id: string;
  roomId: string;
  position: Point;
  createdAt: number;
  template: "note1" | "note2";
  imageData: string;
  text: string;
};

export type SharedGameState = {
  version: number;
  updatedAt: number;
  updatedBy: string;
  petName: string;
  stats: PetStats;
  backgroundId: string;
  lifecycle: PetLifecycle;
  pet: {
    state: PetStateId;
    position: Point;
    facing: number;
    walkDurationMs: number;
  };
  pets: SharedPet[];
  ball: {
    visible: boolean;
    roomId: string;
    image: string;
    position: Point;
    rotation: number;
    transitionMs: number;
    lastPlayerTouchedAt: number;
  };
  food: {
    visible: boolean;
    roomId: string;
    image: string;
    position: Point;
  };
  bed: {
    visible: boolean;
    roomId: string;
    image: string;
    position: Point;
    sleepEndsAt: number;
    sleepOwnerId: string;
  };
  notes: SharedNote[];
};

export const DEFAULT_SHARED_GAME_STATE: SharedGameState = {
  version: 0,
  updatedAt: Date.now(),
  updatedBy: "server",
  petName: "Momo",
  stats: {
    hunger: 62,
    energy: 76,
    mood: 70
  },
  backgroundId: "Wiese",
  lifecycle: {
    createdAt: Date.now(),
    lastFedAt: Date.now(),
    lastPlayedAt: Date.now(),
    lastSleptAt: Date.now(),
    lastDecayAt: Date.now(),
    deadAt: 0
  },
  pet: {
    state: "sitzen",
    position: { x: 50, y: 78 },
    facing: 1,
    walkDurationMs: 0
  },
  pets: [
    {
      id: "pet1",
      updatedAt: Date.now(),
      assetKey: "pet",
      name: "Momo",
      stats: {
        hunger: 62,
        energy: 76,
        mood: 70
      },
      lifecycle: {
        createdAt: Date.now(),
        lastFedAt: Date.now(),
        lastPlayedAt: Date.now(),
        lastSleptAt: Date.now(),
        lastDecayAt: Date.now(),
        deadAt: 0
      },
      roomId: "Wiese",
      state: "sitzen",
      position: { x: 50, y: 78 },
      facing: 1,
      walkDurationMs: 0,
      lastAutoAt: Date.now(),
      pendingRoomId: "",
      pendingRoomDirection: 0,
      autoExitAt: 0
    }
  ],
  ball: {
    visible: false,
    roomId: "Wiese",
    image: "/assets/items/ball.png",
    position: { x: 50, y: 82 },
    rotation: 0,
    transitionMs: 0,
    lastPlayerTouchedAt: Date.now()
  },
  food: {
    visible: false,
    roomId: "Wiese",
    image: "/assets/items/food/steak.png",
    position: { x: 50, y: 82 }
  },
  bed: {
    visible: false,
    roomId: "Wiese",
    image: "/assets/items/bett.png",
    position: { x: 50, y: 82 },
    sleepEndsAt: 0,
    sleepOwnerId: "server"
  },
  notes: []
};
