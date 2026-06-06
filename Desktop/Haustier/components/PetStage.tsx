"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent, PointerEvent, WheelEvent } from "react";
import NextImage from "next/image";
import { AnimatedSprite } from "@/components/AnimatedSprite";
import { BACKGROUNDS, PET_STATES, PET_VARIANTS, type PetStateId } from "@/lib/gameConfig";
import type { SharedGameState, SharedNote, SharedPet, SharedPoop } from "@/lib/sharedGameState";

type PetStats = {
  hunger: number;
  energy: number;
  mood: number;
};

type Point = {
  x: number;
  y: number;
};

type NoteTemplate = "note1" | "note2";
type InventoryCategory = "play" | "feed" | "sleep" | "notes";
type TrayItem = "ball" | "ball2" | "steak" | "bone" | "napf" | "snacks" | "bed" | "bed2" | "bed3" | NoteTemplate;

const initialStats: PetStats = {
  hunger: 62,
  energy: 76,
  mood: 70
};

const initialLifecycle = {
  createdAt: Date.now(),
  lastFedAt: Date.now(),
  lastPlayedAt: Date.now(),
  lastSleptAt: Date.now(),
  lastDecayAt: Date.now(),
  deadAt: 0
};

const MOVEMENT_AREA = { minY: 72, maxY: 88 };
const SKY_BACKGROUNDS = new Set(["wiese", "Wiese"]);
const PET_HEAD_OFFSET = 20;
const PET_HEAD_CLICK_RANGE = 8;
const PET_JUMP_X_RANGE = 13;
const ROOM_ENTRY_START: Point = { x: -12, y: 82 };
const ROOM_ENTRY_TARGET: Point = { x: 24, y: 82 };
const ROOM_EXIT_LEFT_X = 7;
const ROOM_EXIT_RIGHT_X = 93;
const ROOM_EDGE_TARGET_Y = 82;
const BALL_IMAGE = "/assets/items/ball.png";
const BALL2_IMAGE = "/assets/items/ball2.png";
const FOOD_IMAGE = "/assets/items/food/steak.png";
const FOOD_IMAGES = {
  steak: "/assets/items/food/steak.png",
  bone: "/assets/items/food/bone.png",
  napf: "/assets/items/food/napf.png",
  snacks: "/assets/items/food/snacks.png"
} satisfies Record<"steak" | "bone" | "napf" | "snacks", string>;
const BED_IMAGE = "/assets/items/bett.png";
const BED2_IMAGE = "/assets/items/bett2.png";
const BED3_IMAGE = "/assets/items/bett3.png";
const NOTE_IMAGES: Record<NoteTemplate, string> = {
  note1: "/assets/items/notiz1.png",
  note2: "/assets/items/notiz2.png"
};
const CATEGORY_ICONS: Record<InventoryCategory, string> = {
  play: "/assets/backgrounds/UI/play.png",
  feed: "/assets/backgrounds/UI/feed.png",
  sleep: "/assets/backgrounds/UI/sleep.png",
  notes: "/assets/backgrounds/UI/notes.png"
};
const HUNGER_ICON = "/assets/backgrounds/UI/hunger.png";
const ENERGY_ICON = "/assets/backgrounds/UI/energy.png";
const MOOD_ICON = "/assets/backgrounds/UI/mood.png";
const CAM_ICON = "/assets/backgrounds/UI/cam.png";
const SETTINGS_ICON = "/assets/backgrounds/UI/settings.png";
const POSITION_IMAGE = "/assets/backgrounds/UI/position.png";
const HEART_IMAGE = "/assets/backgrounds/UI/heart.png";
const POOP_IMAGE = "/assets/backgrounds/UI/poop.png";
const INSPECT_IMAGE = "/assets/backgrounds/UI/inspect.png";
const BALL_CENTER: Point = { x: 50, y: 82 };
const BALL_BOUNDS = { minX: 7, maxX: 93, minY: MOVEMENT_AREA.minY, maxY: MOVEMENT_AREA.maxY };
const BALL_AIR_BOUNDS = { minY: 8, floorY: BALL_CENTER.y };
const NOTE_BOUNDS = { minX: 9, maxX: 91, minY: 8, maxY: 70 };
const BALL_GRAVITY = 95;
const ITEM_GRAVITY = 110;
const SYNC_INTERVAL_MS = 250;
const SYNC_DEBOUNCE_MS = 60;
const LOCAL_INTERACTION_PROTECT_MS = 900;
const NAME_SAVE_DEBOUNCE_MS = 2000;
const SETTINGS_CLICK_COUNT = 5;
const SETTINGS_CLICK_WINDOW_MS = 1_500;
const FETCH_JUMP_CHANCE = 0.25;
const BALL_DESPAWN_MS = 30_000;
const SLEEP_DURATION_MS = 10_000;
const MIN_ZOOM = 0.82;
const WHEEL_ZOOM_STEP = 0.025;
const BED_WALK_INTO_OFFSET_Y = 10;
const BED_SLEEP_OFFSET_Y = 3;
const FOCUS_ZOOM = 1.45;
const CAMERA_FOLLOW_ZOOM = 1.4;
const CLOSE_ZOOM = 2.6;
const DOUBLE_CLICK_MS = 350;
const STROKE_HEART_DISTANCE = 70;
const STROKE_MOOD_COOLDOWN_MS = 700;
// 0-based index of the sitzen frame to freeze on while stroking, per variant
const STROKE_FRAME_INDEX: Record<string, number> = { pet: 6, pet2: 4, pet3: 3 };
const BACKGROUND_WIDTH = 1672;
const BACKGROUND_HEIGHT = 941;
const BACKGROUND_ASPECT_RATIO = BACKGROUND_WIDTH / BACKGROUND_HEIGHT;
const DEFAULT_PET_VARIANT = PET_VARIANTS[0]?.id ?? "pet";
const SECOND_PET_VARIANT = PET_VARIANTS[1]?.id ?? DEFAULT_PET_VARIANT;
const MOBILE_MEDIA_QUERY = "(max-width: 760px)";

export function PetStage() {
  const [backgroundId, setBackgroundId] = useState(BACKGROUNDS[0]?.id ?? "wiese");
  const [zoom, setZoom] = useState(1);
  const [scenePan, setScenePan] = useState<Point>({ x: 0, y: 0 });
  const [focusedPet, setFocusedPet] = useState(false);
  const [cameraFollowsPet, setCameraFollowsPet] = useState(false);
  const [walkTargetMarker, setWalkTargetMarker] = useState<Point | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeInventoryCategory, setActiveInventoryCategory] = useState<InventoryCategory | null>(null);
  const [selectedPetId, setSelectedPetId] = useState<SharedPet["id"]>("pet1");
  const [pets, setPets] = useState<SharedPet[]>([createDefaultPet("pet1", DEFAULT_PET_VARIANT, "Momo")]);
  const [petNameDraft, setPetNameDraft] = useState("Momo");
  const [ballVisible, setBallVisible] = useState(false);
  const [ballRoomId, setBallRoomId] = useState(BACKGROUNDS[0]?.id ?? "wiese");
  const [ballImageSrc, setBallImageSrc] = useState(BALL_IMAGE);
  const [ballDragging, setBallDragging] = useState(false);
  const [ballImageReady, setBallImageReady] = useState(false);
  const [ballPosition, setBallPosition] = useState<Point>(BALL_CENTER);
  const [ballRotation, setBallRotation] = useState(0);
  const [ballTransitionMs, setBallTransitionMs] = useState(0);
  const [ballLastPlayerTouchedAt, setBallLastPlayerTouchedAt] = useState(0);
  const [foodVisible, setFoodVisible] = useState(false);
  const [foodRoomId, setFoodRoomId] = useState(BACKGROUNDS[0]?.id ?? "wiese");
  const [foodImageSrc, setFoodImageSrc] = useState(FOOD_IMAGE);
  const [foodPosition, setFoodPosition] = useState<Point>(BALL_CENTER);
  const [foodDragging, setFoodDragging] = useState(false);
  const [foodSettling, setFoodSettling] = useState(false);
  const [foodImageReady, setFoodImageReady] = useState(false);
  const [bedVisible, setBedVisible] = useState(false);
  const [bedRoomId, setBedRoomId] = useState(BACKGROUNDS[0]?.id ?? "wiese");
  const [bedImageSrc, setBedImageSrc] = useState(BED_IMAGE);
  const [bedPosition, setBedPosition] = useState<Point>(BALL_CENTER);
  const [bedDragging, setBedDragging] = useState(false);
  const [bedSettling, setBedSettling] = useState(false);
  const [bedImageReady, setBedImageReady] = useState(false);
  const [noteImagesReady, setNoteImagesReady] = useState<Record<NoteTemplate, boolean>>({ note1: false, note2: false });
  const [noteDraftVisible, setNoteDraftVisible] = useState(false);
  const [noteDragging, setNoteDragging] = useState(false);
  const [noteDraftTemplate, setNoteDraftTemplate] = useState<NoteTemplate>("note1");
  const [noteDraftPosition, setNoteDraftPosition] = useState<Point>({ x: 50, y: 34 });
  const [notes, setNotes] = useState<SharedNote[]>([]);
  const [noteEditorOpen, setNoteEditorOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteColor, setNoteColor] = useState("#2b1b0d");
  const [noteBrushSize, setNoteBrushSize] = useState(8);
  const [viewingNoteId, setViewingNoteId] = useState<string | null>(null);
  const [sleepEndsAt, setSleepEndsAt] = useState(0);
  const [sleepOwnerId, setSleepOwnerId] = useState("server");
  const [petZoomMode, setPetZoomMode] = useState<"normal" | "close">("normal");
  const petZoomModeRef = useRef<"normal" | "close">("normal");
  const [isStroking, setIsStroking] = useState(false);
  const [hearts, setHearts] = useState<Array<{ id: string; x: number; y: number; dx: number; rot: number }>>([]);
  const [poops, setPoops] = useState<SharedPoop[]>([]);
  const selectedPet = pets.find((pet) => pet.id === selectedPetId) ?? pets[0] ?? createDefaultPet("pet1", DEFAULT_PET_VARIANT, "Momo");
  const petName = selectedPet.name;
  const petState = selectedPet.state;
  const petPosition = selectedPet.position;
  const facing = selectedPet.facing;
  const walkDurationMs = selectedPet.walkDurationMs;
  const stats = selectedPet.stats;
  const lifecycle = selectedPet.lifecycle;
  const stageRef = useRef<HTMLDivElement | null>(null);
  const sitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actionTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const ballVelocity = useRef<Point>({ x: 0, y: 0 });
  const ballPositionRef = useRef<Point>(BALL_CENTER);
  const foodPositionRef = useRef<Point>(BALL_CENTER);
  const bedPositionRef = useRef<Point>(BALL_CENTER);
  const noteDraftPositionRef = useRef<Point>({ x: 50, y: 34 });
  const noteCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const noteDrawing = useRef(false);
  const foodVelocity = useRef<Point>({ x: 0, y: 0 });
  const bedVelocity = useRef<Point>({ x: 0, y: 0 });
  const ballThrownByPlayer = useRef(false);
  const ballDespawnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchJumpEnabled = useRef(false);
  const lastBallDrag = useRef<{ point: Point; time: number } | null>(null);
  const stageDrag = useRef<{ startX: number; startY: number; startPan: Point } | null>(null);
  const stagePointers = useRef(new Map<number, Point>());
  const pinchGesture = useRef<{ distance: number; zoom: number; center: Point; pan: Point } | null>(null);
  const viewBeforeFocus = useRef<{ zoom: number; pan: Point }>({ zoom: 1, pan: { x: 0, y: 0 } });
  const clientId = useRef("client-pending");
  const latestVersion = useRef(0);
  const applyingRemote = useRef(false);
  const syncReady = useRef(false);
  const localInteractionActive = useRef(false);
  const localInteractionProtectUntil = useRef(0);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nameSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cameraClickCount = useRef(0);
  const firstCameraClickAt = useRef(0);
  const suppressNextClick = useRef(false);
  const walkOriginRef = useRef<Point>({ x: 50, y: 78 });
  const walkStartTimeRef = useRef<number>(0);
  const walkDurationAtStartRef = useRef<number>(0);
  const suppressCameraFollowRef = useRef(false);
  const lastPetClickRef = useRef<{ time: number; petId: string } | null>(null);
  const strokeRef = useRef<{ lastX: number; lastY: number } | null>(null);
  const strokeDistanceRef = useRef(0);
  const strokeMoodCooldownRef = useRef(0);
  const petInteractionRef = useRef<number>(0);
  const schedulePoopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateSelectedPet = (updater: (pet: SharedPet) => SharedPet) => {
    setPets((currentPets) => currentPets.map((pet) => pet.id === selectedPetId ? { ...updater(pet), updatedAt: Date.now() } : pet));
  };

  const getVisualPetPosition = (): Point => {
    const duration = walkDurationAtStartRef.current;
    if (petState !== "laufen" || duration <= 0) return petPosition;
    const elapsed = Date.now() - walkStartTimeRef.current;
    const t = Math.min(1, elapsed / duration);
    const origin = walkOriginRef.current;
    return {
      x: origin.x + (petPosition.x - origin.x) * t,
      y: origin.y + (petPosition.y - origin.y) * t
    };
  };

  const setPetName = (name: string) => updateSelectedPet((pet) => ({ ...pet, name }));
  const setPetState = (state: PetStateId) => updateSelectedPet((pet) => ({ ...pet, state }));
  const setPetRoomId = (roomId: string) => updateSelectedPet((pet) => ({ ...pet, roomId }));
  const setPetPosition = (position: Point) => updateSelectedPet((pet) => ({
    ...pet,
    position: {
      x: Math.max(2, Math.min(98, position.x)),
      y: Math.max(MOVEMENT_AREA.minY, Math.min(MOVEMENT_AREA.maxY, position.y))
    }
  }));
  const setFacing = (nextFacing: number) => updateSelectedPet((pet) => ({ ...pet, facing: nextFacing }));
  const setWalkDurationMs = (nextWalkDurationMs: number) => updateSelectedPet((pet) => ({ ...pet, walkDurationMs: nextWalkDurationMs }));
  const setStats = (updater: PetStats | ((current: PetStats) => PetStats)) => {
    updateSelectedPet((pet) => ({
      ...pet,
      stats: typeof updater === "function" ? updater(pet.stats) : updater
    }));
  };
  const changePetNameDraft = (name: string) => {
    setPetNameDraft(name);
    if (nameSaveTimer.current) clearTimeout(nameSaveTimer.current);
    nameSaveTimer.current = setTimeout(() => {
      setPetName(name.trim() || "Pet");
      nameSaveTimer.current = null;
    }, NAME_SAVE_DEBOUNCE_MS);
  };

  const flushPetNameDraft = () => {
    if (nameSaveTimer.current) clearTimeout(nameSaveTimer.current);
    nameSaveTimer.current = null;
    setPetName(petNameDraft.trim() || "Pet");
  };

  const activeBackground = useMemo(
    () => BACKGROUNDS.find((background) => background.id === backgroundId) ?? BACKGROUNDS[0],
    [backgroundId]
  );

  const backgroundFrame = activeBackground?.frames[0];
  const backgroundStyle = {
    backgroundImage: backgroundFrame ? `url("${encodeURI(backgroundFrame)}")` : undefined
  } as CSSProperties;
  const selectedPetVariant = PET_VARIANTS.find((variant) => variant.id === selectedPet.assetKey) ?? PET_VARIANTS[0];
  const activePetState = selectedPetVariant?.states[petState] ?? PET_STATES[petState];
  const activePetFrames = activePetState.frames.length > 0 ? activePetState.frames : PET_STATES.stehen.frames;
  const stageStyle = {
    "--scene-zoom": zoom,
    "--scene-pan-x": `${scenePan.x}px`,
    "--scene-pan-y": `${scenePan.y}px`,
    "--camera-transition-duration": cameraFollowsPet && walkDurationMs > 0 ? `${walkDurationMs}ms` : "260ms",
    "--camera-transition-easing": cameraFollowsPet && walkDurationMs > 0 ? "linear" : "cubic-bezier(0.22, 1, 0.36, 1)",
    "--world-aspect": BACKGROUND_ASPECT_RATIO,
    "--world-natural-width": `${BACKGROUND_WIDTH}px`,
    "--world-natural-height": `${BACKGROUND_HEIGHT}px`,
    "--scene-origin-x": "50%",
    "--scene-origin-y": "50%"
  } as CSSProperties;
  const ballStyle = {
    "--ball-x": `${ballPosition.x}%`,
    "--ball-y": `${ballPosition.y}%`,
    "--ball-rotation": `${ballRotation}deg`,
    "--ball-move-duration": `${ballTransitionMs}ms`,
    "--ball-image": `url("${encodeURI(ballImageSrc)}")`
  } as CSSProperties;
  const foodStyle = {
    "--item-x": `${foodPosition.x}%`,
    "--item-y": `${foodPosition.y}%`,
    "--item-image": `url("${encodeURI(foodImageSrc)}")`
  } as CSSProperties;
  const bedStyle = {
    "--item-x": `${bedPosition.x}%`,
    "--item-y": `${bedPosition.y}%`,
    "--item-image": `url("${encodeURI(bedImageSrc)}")`
  } as CSSProperties;
  const noteDraftStyle = {
    "--item-x": `${noteDraftPosition.x}%`,
    "--item-y": `${noteDraftPosition.y}%`,
    "--item-image": `url("${encodeURI(NOTE_IMAGES[noteDraftTemplate])}")`
  } as CSSProperties;
  const isKitchen = isKitchenRoom(backgroundId);
  const inventoryCategories: InventoryCategory[] = ["play", "feed", "sleep", ...(isKitchen ? ["notes" as const] : [])];
  const trayItems = activeInventoryCategory ? getInventoryItems(activeInventoryCategory) : [];
  const viewingNote = viewingNoteId ? notes.find((note) => note.id === viewingNoteId) : undefined;
  const isDead = lifecycle.deadAt > 0;
  const isDeadRef = useRef(isDead);
  const selectedPetRoomRef = useRef(selectedPet.roomId);
  const petsInRoom = pets.filter((pet) => pet.roomId === backgroundId);
  const canSwitchPet = pets.length > 1;

  const clearTimers = () => {
    if (sitTimer.current) clearTimeout(sitTimer.current);
    actionTimers.current.forEach(clearTimeout);
    actionTimers.current = [];
  };

  function changeStats(delta: Partial<PetStats>) {
    setStats((current) => ({
      hunger: clampStat(current.hunger + (delta.hunger ?? 0)),
      energy: clampStat(current.energy + (delta.energy ?? 0)),
      mood: clampStat(current.mood + (delta.mood ?? 0))
    }));
  }

  function markCare(kind: "fed" | "played" | "slept") {
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    protectLocalInteraction(now);
    updateSelectedPet((pet) => ({
      ...pet,
      lastInteractionAt: now,
      lifecycle: {
        ...pet.lifecycle,
        lastFedAt: kind === "fed" ? now : pet.lifecycle.lastFedAt,
        lastPlayedAt: kind === "played" ? now : pet.lifecycle.lastPlayedAt,
        lastSleptAt: kind === "slept" ? now : pet.lifecycle.lastSleptAt,
        lastDecayAt: now
      }
    }));
  }

  function markInteraction() {
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    protectLocalInteraction(now);
    updateSelectedPet((pet) => ({ ...pet, lastInteractionAt: now }));
  }

  function protectLocalInteraction(now: number) {
    localInteractionProtectUntil.current = now + LOCAL_INTERACTION_PROTECT_MS;
  }

  function isLocalInteractionProtected() {
    return Date.now() < localInteractionProtectUntil.current || localInteractionActive.current;
  }

  function buildSharedState(): SharedGameState {
    return {
      version: latestVersion.current,
      updatedAt: Date.now(),
      updatedBy: clientId.current,
      petName,
      stats,
      backgroundId: pets[0]?.roomId ?? backgroundId,
      lifecycle,
      pet: {
        state: petState,
        position: petPosition,
        facing,
        walkDurationMs
      },
      pets,
      ball: {
        visible: ballVisible,
        roomId: ballRoomId,
        image: ballImageSrc,
        position: ballPosition,
        rotation: ballRotation,
        transitionMs: ballTransitionMs,
        lastPlayerTouchedAt: ballLastPlayerTouchedAt
      },
      food: {
        visible: foodVisible,
        roomId: foodRoomId,
        image: foodImageSrc,
        position: foodPosition
      },
      bed: {
        visible: bedVisible,
        roomId: bedRoomId,
        image: bedImageSrc,
        position: bedPosition,
        sleepEndsAt,
        sleepOwnerId
      },
      notes,
      poops
    };
  }

  function applyRemoteState(remoteState: SharedGameState, syncView = false) {
    applyingRemote.current = true;
    latestVersion.current = remoteState.version;
    const remotePets = normalizeRemotePets(remoteState);
    setPets(remotePets);
    setSelectedPetId((current) => remotePets.some((pet) => pet.id === current) ? current : remotePets[0]?.id ?? "pet1");
    if (syncView) setBackgroundId(remotePets[0]?.roomId ?? remoteState.backgroundId);
    setBallVisible(remoteState.ball.visible);
    setBallRoomId(remoteState.ball.roomId);
    setBallImageSrc(remoteState.ball.image ?? BALL_IMAGE);
    setBallPosition(remoteState.ball.position);
    setBallRotation(remoteState.ball.rotation);
    setBallTransitionMs(remoteState.ball.transitionMs);
    setBallLastPlayerTouchedAt(remoteState.ball.lastPlayerTouchedAt);
    ballPositionRef.current = remoteState.ball.position;
    setFoodVisible(remoteState.food.visible);
    setFoodRoomId(remoteState.food.roomId);
    setFoodImageSrc(remoteState.food.image ?? FOOD_IMAGE);
    setFoodPosition(remoteState.food.position);
    foodPositionRef.current = remoteState.food.position;
    setBedVisible(remoteState.bed.visible);
    setBedRoomId(remoteState.bed.roomId);
    setBedImageSrc(remoteState.bed.image ?? BED_IMAGE);
    setBedPosition(remoteState.bed.position);
    setSleepEndsAt(remoteState.bed.sleepEndsAt);
    setSleepOwnerId(remoteState.bed.sleepOwnerId);
    bedPositionRef.current = remoteState.bed.position;
    setNotes(remoteState.notes ?? []);
    setPoops(remoteState.poops ?? []);
  }

  async function pushState() {
    try {
      const response = await fetch("/api/game-state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildSharedState())
      });
      if (!response.ok) return;

      const savedState = (await response.json()) as SharedGameState;
      if (isLocalInteractionProtected()) {
        latestVersion.current = Math.max(latestVersion.current, savedState.version);
        return;
      }
      applyRemoteState(savedState);
    } catch {
      // Offline/local server refresh: keep playing locally, next sync will catch up.
    }
  }

  async function pushFullState(nextState: SharedGameState) {
    try {
      const response = await fetch("/api/game-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextState)
      });
      if (!response.ok) return;

      const savedState = (await response.json()) as SharedGameState;
      applyRemoteState(savedState, true);
    } catch {
      // Keep local restart visible if the server is temporarily unavailable.
    }
  }

  useEffect(() => {
    clientId.current = `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

    PET_VARIANTS.forEach((variant) => {
      Object.values(variant.states).forEach((state) => {
        state.frames.forEach(preloadImage);
      });
    });

    BACKGROUNDS.forEach((background) => background.frames.forEach(preloadImage));
    [
      BALL_IMAGE,
      BALL2_IMAGE,
      FOOD_IMAGES.steak,
      FOOD_IMAGES.bone,
      FOOD_IMAGES.napf,
      FOOD_IMAGES.snacks,
      BED_IMAGE,
      BED2_IMAGE,
      BED3_IMAGE,
      NOTE_IMAGES.note1,
      NOTE_IMAGES.note2,
      HUNGER_ICON,
      ENERGY_ICON,
      MOOD_ICON,
      CAM_ICON,
      SETTINGS_ICON,
      POSITION_IMAGE,
      ...Object.values(CATEGORY_ICONS)
    ].forEach(preloadImage);

    const ballImage = new Image();
    ballImage.onload = () => setBallImageReady(true);
    ballImage.onerror = () => setBallImageReady(false);
    ballImage.src = BALL_IMAGE;

    const foodImage = new Image();
    foodImage.onload = () => setFoodImageReady(true);
    foodImage.onerror = () => setFoodImageReady(false);
    foodImage.src = FOOD_IMAGE;

    const bedImage = new Image();
    bedImage.onload = () => setBedImageReady(true);
    bedImage.onerror = () => setBedImageReady(false);
    bedImage.src = BED_IMAGE;

    Object.entries(NOTE_IMAGES).forEach(([template, src]) => {
      const noteImage = new Image();
      noteImage.onload = () => setNoteImagesReady((current) => ({ ...current, [template]: true }));
      noteImage.onerror = () => setNoteImagesReady((current) => ({ ...current, [template]: false }));
      noteImage.src = src;
    });

    if (window.matchMedia(MOBILE_MEDIA_QUERY).matches) {
      requestAnimationFrame(() => {
        setZoom(MIN_ZOOM);
        setScenePan({ x: 0, y: 0 });
      });
    }

    return () => {
      clearTimers();
      if (ballDespawnTimer.current) clearTimeout(ballDespawnTimer.current);
      if (syncTimer.current) clearTimeout(syncTimer.current);
      if (nameSaveTimer.current) clearTimeout(nameSaveTimer.current);
    };
  }, []);

  useEffect(() => {
    if (nameSaveTimer.current) return;
    setPetNameDraft(petName);
  }, [petName, selectedPetId]);

  useEffect(() => {
    localInteractionActive.current = ballDragging || foodDragging || bedDragging || noteDragging || foodSettling || bedSettling || noteEditorOpen;
  }, [ballDragging, foodDragging, bedDragging, noteDragging, foodSettling, bedSettling, noteEditorOpen]);

  useEffect(() => {
    let cancelled = false;

    const pullState = async () => {
      try {
        const response = await fetch("/api/game-state", { cache: "no-store" });
        if (!response.ok) return;

        const remoteState = (await response.json()) as SharedGameState;
        if (cancelled) return;
        if (isLocalInteractionProtected()) return;
        if (remoteState.updatedBy !== clientId.current && remoteState.version > latestVersion.current) applyRemoteState(remoteState);
      } catch {
        // Local dev can briefly lose the server during refreshes.
      } finally {
        syncReady.current = true;
      }
    };

    void pullState();
    const interval = setInterval(pullState, SYNC_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setScenePan((currentPan) => cameraFollowsPet ? getFocusPan(petPosition, zoom) : clampScenePan(currentPan, zoom));
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [cameraFollowsPet, petPosition, zoom]);

  // useLayoutEffect fires synchronously before browser paint so pan and pet walk
  // transitions start in the exact same frame — no drift or 1-frame lag.
  useLayoutEffect(() => {
    if (!cameraFollowsPet) return;
    if (suppressCameraFollowRef.current) return;
    if (selectedPet.roomId !== backgroundId) return;
    setScenePan(getFocusPan(petPosition, zoom));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backgroundId, cameraFollowsPet, petPosition, zoom]);

  useEffect(() => {
    if (!noteEditorOpen) return;
    const animationFrame = requestAnimationFrame(() => {
      const canvas = noteCanvasRef.current;
      const context = canvas?.getContext("2d");
      if (!canvas || !context) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
    });
    return () => cancelAnimationFrame(animationFrame);
  }, [noteEditorOpen]);

  useEffect(() => {
    if (applyingRemote.current) {
      applyingRemote.current = false;
      return;
    }
    if (!syncReady.current) return;

    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      void pushState();
    }, SYNC_DEBOUNCE_MS);

    return () => {
      if (syncTimer.current) clearTimeout(syncTimer.current);
    };
    // ballRotation and ballTransitionMs are visual-only and change every physics frame — excluded to prevent sync spam
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pets, ballVisible, ballRoomId, ballImageSrc, ballPosition, ballLastPlayerTouchedAt, foodVisible, foodRoomId, foodImageSrc, foodPosition, bedVisible, bedRoomId, bedImageSrc, bedPosition, sleepEndsAt, sleepOwnerId, notes, poops]);

  useEffect(() => {
    if (ballDespawnTimer.current) clearTimeout(ballDespawnTimer.current);
    if (!ballVisible) return;

    const remainingMs = Math.max(0, BALL_DESPAWN_MS - (Date.now() - ballLastPlayerTouchedAt));
    ballDespawnTimer.current = setTimeout(() => {
      ballThrownByPlayer.current = false;
      ballVelocity.current = { x: 0, y: 0 };
      setBallVisible(false);
      setBallDragging(false);
      setBallTransitionMs(0);
    }, remainingMs);

    return () => {
      if (ballDespawnTimer.current) clearTimeout(ballDespawnTimer.current);
    };
  }, [ballLastPlayerTouchedAt, ballVisible]);

  useEffect(() => {
    if (sitTimer.current) clearTimeout(sitTimer.current);

    if (petState === "stehen") {
      sitTimer.current = setTimeout(() => setPetState("sitzen"), 3000);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [petState]);

  useEffect(() => {
    ballPositionRef.current = ballPosition;
  }, [ballPosition]);

  useEffect(() => {
    foodPositionRef.current = foodPosition;
  }, [foodPosition]);

  useEffect(() => {
    bedPositionRef.current = bedPosition;
  }, [bedPosition]);

  useEffect(() => { isDeadRef.current = isDead; }, [isDead]);
  useEffect(() => { selectedPetRoomRef.current = selectedPet.roomId; }, [selectedPet.roomId]);
  useEffect(() => { petZoomModeRef.current = petZoomMode; }, [petZoomMode]);

  useEffect(() => {
    if (!isDead) return;
    clearTimers();
    const animationFrame = requestAnimationFrame(() => {
      setFocusedPet(false);
      setActiveInventoryCategory(null);
      setSleepEndsAt(0);
      setSleepOwnerId("server");
      setPetState("sitzen");
    });
    return () => cancelAnimationFrame(animationFrame);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDead]);

  // Autonomous wander: when sitting idle, randomly walk or jump
  useEffect(() => {
    if (isDead || petState !== "sitzen") return;
    const delay = 10_000 + Math.random() * 18_000;
    const timer = setTimeout(() => {
      if (petZoomModeRef.current === "close") return;
      if (Date.now() < localInteractionProtectUntil.current) return;
      const r = Math.random();
      if (r < 0.55) {
        movePetTo({
          x: clampPosition(12 + Math.random() * 70, 12, 88),
          y: clampPosition(74 + Math.random() * 12, 73, 88)
        });
      } else if (r < 0.72) {
        setPetState("stehen");
        actionTimers.current.push(setTimeout(() => {
          setPetState("springen");
          actionTimers.current.push(setTimeout(() => setPetState("stehen"), 800));
        }, 60));
      }
    }, delay);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDead, petState]);

  // 2-pet proximity interaction: face each other and greet
  useEffect(() => {
    if (pets.length < 2 || isDead) return;
    const other = pets.find((p) => p.id !== selectedPetId);
    if (!other || other.roomId !== backgroundId || selectedPet.roomId !== backgroundId) return;
    const dist = Math.abs(other.position.x - petPosition.x);
    if (dist > 18) return;
    const now = Date.now();
    if (now - petInteractionRef.current < 28_000) return;
    if (now < localInteractionProtectUntil.current) return;
    petInteractionRef.current = now;
    protectLocalInteraction(now);
    setFacing(other.position.x > petPosition.x ? 1 : -1);
    if (Math.random() < 0.6) {
      clearTimers();
      actionTimers.current.push(setTimeout(() => {
        setPetState("springen");
        actionTimers.current.push(setTimeout(() => setPetState("stehen"), 800));
      }, 350));
    } else {
      setPetState("sitzen");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pets, backgroundId, selectedPetId, isDead]);

  // Autonomous poop spawning once per session, recurring
  useEffect(() => {
    const schedule = () => {
      const delay = 180_000 + Math.random() * 240_000; // 3–7 min
      schedulePoopRef.current = setTimeout(() => {
        if (!isDeadRef.current) {
          // eslint-disable-next-line react-hooks/purity
          const id = `poop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
          const x = clampPosition(18 + Math.random() * 62, 12, 88);
          setPoops((current) => [
            ...current,
            { id, roomId: selectedPetRoomRef.current, position: { x, y: 88 }, createdAt: Date.now() }
          ]);
        }
        schedule();
      }, delay);
    };
    schedule();
    return () => { if (schedulePoopRef.current) clearTimeout(schedulePoopRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (cameraFollowsPet) {
      setCameraFollowsPet(false);
      if (window.matchMedia(MOBILE_MEDIA_QUERY).matches) {
        setZoom(MIN_ZOOM);
        setScenePan((currentPan) => clampScenePan(currentPan, MIN_ZOOM));
        return;
      }
    }
    const panLimits = getScenePanLimits(zoom);

    if (!cameraFollowsPet && !event.ctrlKey && zoom === 1 && (panLimits.maxX > 0 || panLimits.maxY > 0)) {
      const horizontalDelta = Math.abs(event.deltaX) > 0 ? event.deltaX : event.deltaY;
      setScenePan((currentPan) => clampScenePan({
        x: currentPan.x - horizontalDelta,
        y: currentPan.y - event.deltaY * 0.35
      }, zoom));
      return;
    }

    const direction = event.deltaY < 0 ? WHEEL_ZOOM_STEP : -WHEEL_ZOOM_STEP;
    setZoom((current) => {
      const nextZoom = clampZoom(current + direction);
      setScenePan((currentPan) => {
        if (focusedPet) return getFocusPan(petPosition, nextZoom, true);
        return clampScenePan(currentPan, nextZoom);
      });
      return nextZoom;
    });
  };

  const exitFocus = () => {
    setPetZoomMode("normal");
    setFocusedPet(false);
    setActiveInventoryCategory(null);
    setZoom(viewBeforeFocus.current.zoom);
    setScenePan(clampScenePan(viewBeforeFocus.current.pan, viewBeforeFocus.current.zoom));
  };

  const exitCloseZoom = () => {
    setIsStroking(false);
    setPetZoomMode("normal");
    setZoom(viewBeforeFocus.current.zoom);
    setScenePan(clampScenePan(viewBeforeFocus.current.pan, viewBeforeFocus.current.zoom));
  };

  const zoomCloseToPet = (targetPet = selectedPet) => {
    clearTimers();
    setActiveInventoryCategory(null);
    setFocusedPet(false);
    viewBeforeFocus.current = { zoom, pan: scenePan };

    const visualPos = targetPet.id === selectedPetId ? getVisualPetPosition() : targetPet.position;
    // Sprite is bottom-anchored (translate: -50% -100%). Center on pet's body/head.
    // Use window dimensions to match getFocusPan's coordinate system.
    const vw = typeof window !== "undefined" ? window.innerWidth : 400;
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;
    const world = getSceneWorldMetrics(vw, vh);
    const spriteH = Math.min(340, Math.max(180, 0.26 * vw));
    const spriteHPct = (spriteH / world.height) * 100;
    // 0.65 → bias toward head (65% up from the feet anchor)
    const focusPos = { x: visualPos.x, y: visualPos.y - spriteHPct * 0.65 };

    // Snap the pet to its visual position so it doesn't jump after we clear timers
    setPetPosition(visualPos);
    setPetState("sitzen");
    setWalkDurationMs(0);
    setPetZoomMode("close");
    setZoom(CLOSE_ZOOM);
    setScenePan(getFocusPan(focusPos, CLOSE_ZOOM, true));
  };

  const spawnHeart = (baseX: number, baseY: number) => {
    // eslint-disable-next-line react-hooks/purity
    const id = `h-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
    const dx = (Math.random() - 0.5) * 64;
    const rot = (Math.random() - 0.5) * 50;
    setHearts((current) => [...current.slice(-8), { id, x: baseX, y: baseY, dx, rot }]);
    setTimeout(() => setHearts((current) => current.filter((h) => h.id !== id)), 900);
  };

  const startPetStroke = (event: React.PointerEvent<HTMLDivElement>) => {
    if (petZoomMode !== "close") return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    strokeRef.current = { lastX: event.clientX, lastY: event.clientY };
    strokeDistanceRef.current = 0;
    setIsStroking(true);
  };

  const movePetStroke = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!strokeRef.current || petZoomMode !== "close") return;
    event.stopPropagation();
    const dx = event.clientX - strokeRef.current.lastX;
    const dy = event.clientY - strokeRef.current.lastY;
    strokeRef.current.lastX = event.clientX;
    strokeRef.current.lastY = event.clientY;
    strokeDistanceRef.current += Math.hypot(dx, dy);
    if (strokeDistanceRef.current >= STROKE_HEART_DISTANCE) {
      strokeDistanceRef.current = 0;

      // Spawn heart above pet's head (not at pointer)
      const rect = stageRef.current?.getBoundingClientRect();
      if (rect) {
        const world = getSceneWorldMetrics(rect.width, rect.height);
        const spriteHeight = Math.min(340, Math.max(180, 0.26 * rect.width));
        const headY_pct = petPosition.y - (spriteHeight / world.height) * 100;
        const wx = (petPosition.x / 100) * world.width;
        const wy = (headY_pct / 100) * world.height;
        const hx = rect.left + rect.width / 2 + (wx - world.width / 2) * zoom + scenePan.x;
        const hy = rect.top + rect.height / 2 + (wy - world.height / 2) * zoom + scenePan.y - 12;
        spawnHeart(hx, hy);
      }

      // eslint-disable-next-line react-hooks/purity
      const now = Date.now();
      if (now > strokeMoodCooldownRef.current) {
        strokeMoodCooldownRef.current = now + STROKE_MOOD_COOLDOWN_MS;
        changeStats({ mood: 2 });
        markCare("played");
      }
    }
  };

  const endPetStroke = () => {
    strokeRef.current = null;
  };

  const handleFocusBack = () => {
    if (activeInventoryCategory) {
      setActiveInventoryCategory(null);
      return;
    }
    exitFocus();
  };

  const handleStageClick = (event: MouseEvent<HTMLDivElement>) => {
    if (isDead) return;

    if (suppressNextClick.current) {
      suppressNextClick.current = false;
      return;
    }

    if ((event.target as HTMLElement).closest(".statusPanel, .focusPanel, .itemTray, .noteEditorOverlay, .noteViewerOverlay, .ball, .worldItem, .worldNote")) return;
    if (petZoomMode === "close") return;
    if (focusedPet) {
      exitFocus();
      return;
    }

    const { x: worldX, y: worldY } = getScenePoint(event.clientX, event.clientY);

    if (selectedPet.roomId === backgroundId) {
      const clickedSky = SKY_BACKGROUNDS.has(activeBackground.id) && worldY < MOVEMENT_AREA.minY;
      const clickedAboveHead =
        Math.abs(worldX - petPosition.x) <= PET_JUMP_X_RANGE &&
        worldY >= petPosition.y - PET_HEAD_OFFSET - PET_HEAD_CLICK_RANGE &&
        worldY <= petPosition.y - PET_HEAD_OFFSET + PET_HEAD_CLICK_RANGE;

      if (clickedSky || clickedAboveHead) {
        jump();
        return;
      }
    }

    const target = {
      x: clampPosition(worldX, 9, 91),
      y: clampPosition(worldY, MOVEMENT_AREA.minY, MOVEMENT_AREA.maxY)
    };

    setWalkTargetMarker(target);
    walkTo(target);
  };

  const walkTo = (target: Point) => {
    if (selectedPet.roomId !== backgroundId) {
      // Pet is in a different room — teleport it here and walk to target
      markInteraction();
      clearTimers();
      setFocusedPet(false);
      const entryX = target.x < 50 ? 15 : 85;
      const entry: Point = { x: entryX, y: target.y };
      setPetRoomId(backgroundId);
      setPetPosition(entry);
      setFacing(target.x < entryX ? -1 : 1);
      walkOriginRef.current = entry;
      setPetState("stehen");
      setWalkDurationMs(0);
      const duration = getWalkDuration(entry, target);
      const timer = setTimeout(() => {
        walkOriginRef.current = entry;
        walkStartTimeRef.current = Date.now();
        walkDurationAtStartRef.current = duration;
        setWalkDurationMs(duration);
        setPetState("laufen");
        setPetPosition(target);
        const standTimer = setTimeout(() => {
          setWalkTargetMarker(null);
          setWalkDurationMs(0);
          setPetState("stehen");
        }, duration);
        actionTimers.current.push(standTimer);
      }, 80);
      actionTimers.current.push(timer);
      return;
    }
    markInteraction();
    const currentPos = getVisualPetPosition();
    clearTimers();
    setFocusedPet(false);
    setFacing(target.x < currentPos.x ? -1 : 1);
    walkOriginRef.current = currentPos;
    setPetPosition(currentPos);
    setWalkDurationMs(0);

    const duration = getWalkDuration(currentPos, target);
    // Skip the "stehen" pause when already walking — redirect immediately.
    // Only pause briefly from sitzen so the stand-up looks intentional.
    const delay = petState === "sitzen" ? 120 : 0;
    const timer = setTimeout(() => {
      walkOriginRef.current = currentPos;
      walkStartTimeRef.current = Date.now();
      walkDurationAtStartRef.current = duration;
      setWalkDurationMs(duration);
      setPetState("laufen");
      setPetPosition(target);

      const standTimer = setTimeout(() => {
        setWalkTargetMarker(null);
        setWalkDurationMs(0);
        setPetState("stehen");
        changeStats({ energy: -1 });
      }, duration);
      actionTimers.current.push(standTimer);
    }, delay);
    actionTimers.current.push(timer);
  };

  const enterAdjacentRoom = (direction: -1 | 1) => {
    const currentIndex = Math.max(0, BACKGROUNDS.findIndex((background) => background.id === backgroundId));
    const nextIndex = (currentIndex + direction + BACKGROUNDS.length) % BACKGROUNDS.length;
    const nextBackground = BACKGROUNDS[nextIndex];
    if (!nextBackground || nextBackground.id === backgroundId) return;

    localInteractionProtectUntil.current = Date.now() + 3500;
    clearTimers();
    setWalkTargetMarker(null);
    setFocusedPet(false);
    setActiveInventoryCategory(null);
    setScenePan({ x: 0, y: 0 });
    setBackgroundId(nextBackground.id);
    setPetRoomId(nextBackground.id);
    setFacing(direction);
    setWalkDurationMs(0);
    setPetState("stehen");

    const start = { x: direction > 0 ? 2 : 98, y: ROOM_EDGE_TARGET_Y };
    const target = { x: direction > 0 ? 28 : 72, y: ROOM_EDGE_TARGET_Y };
    setPetPosition(start);

    const enterTimer = setTimeout(() => {
      const duration = 2600;
      setWalkDurationMs(duration);
      setPetState("laufen");
      setPetPosition(target);

      const standTimer = setTimeout(() => {
        setWalkTargetMarker(null);
        setWalkDurationMs(0);
        setPetState("stehen");
      }, duration);
      actionTimers.current.push(standTimer);
    }, 120);
    actionTimers.current.push(enterTimer);
  };

  const movePetTo = (target: Point, onDone?: () => void, speed = 8) => {
    if (selectedPet.roomId !== backgroundId) return;
    setFacing(target.x < petPosition.x ? -1 : 1);
    setPetState("stehen");
    setWalkDurationMs(0);

    const duration = getWalkDuration(petPosition, target, speed);
    const timer = setTimeout(() => {
      setWalkDurationMs(duration);
      setPetState("laufen");
      setPetPosition(target);

      const standTimer = setTimeout(() => {
        setWalkDurationMs(0);
        setPetState("stehen");
        onDone?.();
      }, duration);
      actionTimers.current.push(standTimer);
    }, 80);
    actionTimers.current.push(timer);
  };

  const jump = () => {
    if (selectedPet.roomId !== backgroundId) return;
    markInteraction();
    clearTimers();
    setFocusedPet(false);

    setPetState("stehen");
    const jumpTimer = setTimeout(() => setPetState("springen"), petState === "sitzen" ? 120 : 30);
    const standTimer = setTimeout(() => setPetState("stehen"), petState === "sitzen" ? 980 : 780);
    actionTimers.current.push(jumpTimer, standTimer);
  };

  const changeBackground = (nextBackgroundId: string) => {
    if (isDead) return;
    if (nextBackgroundId === backgroundId) return;

    setFocusedPet(false);
    setActiveInventoryCategory(null);
    setSettingsOpen(false);

    if (cameraFollowsPet) {
      // Pet walks in from the left side of the new room
      clearTimers();
      setWalkTargetMarker(null);
      localInteractionProtectUntil.current = Date.now() + 3200;
      const entryStart: Point = { x: 2, y: 82 };
      const entryTarget: Point = { x: 36, y: 82 };
      suppressCameraFollowRef.current = false;
      setPetRoomId(nextBackgroundId);
      setPetPosition(entryStart);
      setFacing(1);
      setPetState("stehen");
      setWalkDurationMs(0);
      setScenePan({ x: 0, y: 0 });
      setBackgroundId(nextBackgroundId);
      const enterTimer = setTimeout(() => {
        const duration = 1600;
        walkOriginRef.current = entryStart;
        walkStartTimeRef.current = Date.now();
        walkDurationAtStartRef.current = duration;
        setWalkDurationMs(duration);
        setPetState("laufen");
        setPetPosition(entryTarget); // triggers useLayoutEffect → camera pans to entryTarget
        const standTimer = setTimeout(() => {
          setWalkDurationMs(0);
          setPetState("stehen");
        }, duration);
        actionTimers.current.push(standTimer);
      }, 80);
      actionTimers.current.push(enterTimer);
    } else {
      suppressCameraFollowRef.current = true;
      requestAnimationFrame(() => { suppressCameraFollowRef.current = false; });
      setCameraFollowsPet(false);
      setScenePan({ x: 0, y: 0 });
      setBackgroundId(nextBackgroundId);
    }
  };

  const startStageDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (isDead) return;
    if (petZoomMode === "close") return;
    if ((event.target as HTMLElement).closest(".statusPanel, .focusPanel, .itemTray, .noteEditorOverlay, .noteViewerOverlay, .ball, .worldItem, .worldNote, .petSprite")) return;
    if (cameraFollowsPet) {
      setCameraFollowsPet(false);
      if (window.matchMedia(MOBILE_MEDIA_QUERY).matches) {
        setZoom(MIN_ZOOM);
        setScenePan((currentPan) => clampScenePan(currentPan, MIN_ZOOM));
      }
    }
    event.preventDefault();
    stagePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (stagePointers.current.size >= 2) {
      const points = Array.from(stagePointers.current.values()).slice(0, 2);
      pinchGesture.current = {
        distance: getPointDistance(points[0], points[1]),
        zoom,
        center: getPointCenter(points[0], points[1]),
        pan: scenePan
      };
      stageDrag.current = null;
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    const panLimits = getScenePanLimits(zoom);
    if (panLimits.maxX <= 0 && panLimits.maxY <= 0) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    stageDrag.current = { startX: event.clientX, startY: event.clientY, startPan: scenePan };
  };

  const dragStage = (event: PointerEvent<HTMLDivElement>) => {
    if (stagePointers.current.has(event.pointerId)) {
      stagePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }

    if (stagePointers.current.size >= 2 && pinchGesture.current) {
      event.preventDefault();
      const points = Array.from(stagePointers.current.values()).slice(0, 2);
      const distance = getPointDistance(points[0], points[1]);
      const center = getPointCenter(points[0], points[1]);
      const nextZoom = clampZoom(pinchGesture.current.zoom * (distance / Math.max(1, pinchGesture.current.distance)));
      const centerDelta = { x: center.x - pinchGesture.current.center.x, y: center.y - pinchGesture.current.center.y };
      setZoom(nextZoom);
      setScenePan(clampScenePan({
        x: pinchGesture.current.pan.x + centerDelta.x,
        y: pinchGesture.current.pan.y + centerDelta.y
      }, nextZoom));
      return;
    }

    const drag = stageDrag.current;
    if (!drag) return;

    const nextPan = {
      x: drag.startPan.x + event.clientX - drag.startX,
      y: drag.startPan.y + event.clientY - drag.startY
    };

    setScenePan(clampScenePan(nextPan, zoom));
  };

  const finishStageDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = stageDrag.current;
    stageDrag.current = null;
    stagePointers.current.delete(event.pointerId);
    if (stagePointers.current.size < 2) pinchGesture.current = null;
    if (!drag) return;

    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;

    if (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10) suppressNextClick.current = true;
  };

  const focusPet = (targetPet = selectedPet) => {
    clearTimers();
    setActiveInventoryCategory(null);
    viewBeforeFocus.current = { zoom, pan: scenePan };
    setFocusedPet(true);
    setZoom(FOCUS_ZOOM);
    setScenePan(getFocusPan(targetPet.position, FOCUS_ZOOM, true));
  };

  const handlePetClick = (pet: SharedPet, event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (pet.id !== selectedPetId) {
      setSelectedPetId(pet.id);
      setFocusedPet(false);
      setActiveInventoryCategory(null);
      setPetZoomMode("normal");
      return;
    }

    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    const last = lastPetClickRef.current;
    if (last && last.petId === pet.id && now - last.time < DOUBLE_CLICK_MS) {
      lastPetClickRef.current = null;
      if (petZoomMode === "close") {
        exitCloseZoom();
      } else {
        zoomCloseToPet(pet);
      }
      return;
    }
    lastPetClickRef.current = { time: now, petId: pet.id };

    if (petZoomMode === "close") return;
    focusPet(pet);
  };

  const switchSelectedPet = () => {
    const currentIndex = Math.max(0, pets.findIndex((pet) => pet.id === selectedPetId));
    const nextPet = pets[(currentIndex + 1) % pets.length];
    if (!nextPet) return;

    clearTimers();
    setWalkTargetMarker(null);
    setSelectedPetId(nextPet.id);
    setBackgroundId(nextPet.roomId);
    setFocusedPet(false);
    setActiveInventoryCategory(null);
    setPetZoomMode("normal");
    setSettingsOpen(false);
    setCameraFollowsPet(true);
    setZoom(CAMERA_FOLLOW_ZOOM);
    requestAnimationFrame(() => setScenePan(getFocusPan(nextPet.position, CAMERA_FOLLOW_ZOOM)));
  };

  const toggleCameraFollow = () => {
    if (settingsOpen) {
      setSettingsOpen(false);
      return;
    }

    setFocusedPet(false);
    setActiveInventoryCategory(null);
    setSettingsOpen(false);
    setCameraFollowsPet((current) => {
      const next = !current;
      if (next) {
        setZoom(CAMERA_FOLLOW_ZOOM);
        setScenePan(getFocusPan(petPosition, CAMERA_FOLLOW_ZOOM));
      } else {
        const nextZoom = window.matchMedia(MOBILE_MEDIA_QUERY).matches ? MIN_ZOOM : zoom;
        setZoom(nextZoom);
        setScenePan(clampScenePan(scenePan, nextZoom));
      }
      return next;
    });
  };

  const toggleSettingsFromCameraButton = () => {
    setFocusedPet(false);
    setActiveInventoryCategory(null);
    setCameraFollowsPet(false);
    setSettingsOpen((current) => !current);
  };

  const handleCameraButtonClick = () => {
    if (petZoomMode === "close") return;
    const now = Date.now();
    if (now - firstCameraClickAt.current > SETTINGS_CLICK_WINDOW_MS) {
      firstCameraClickAt.current = now;
      cameraClickCount.current = 0;
    }

    cameraClickCount.current += 1;

    if (cameraClickCount.current >= SETTINGS_CLICK_COUNT) {
      cameraClickCount.current = 0;
      firstCameraClickAt.current = 0;
      toggleSettingsFromCameraButton();
      return;
    }

    toggleCameraFollow();
  };

  const togglePetSlot = (slotId: SharedPet["id"], assetKey: string) => {
    setPets((currentPets) => {
      const existing = currentPets.find((pet) => pet.id === slotId);
      if (existing) {
        return currentPets.map((pet) => pet.id === slotId ? { ...pet, assetKey, updatedAt: Date.now() } : pet);
      }

      return [...currentPets, { ...createDefaultPet(slotId, assetKey, slotId === "pet1" ? "Momo" : "Pet 2"), roomId: backgroundId, updatedAt: Date.now() }].sort((a, b) => a.id.localeCompare(b.id));
    });
    setSelectedPetId(slotId);
    setFocusedPet(false);
    setActiveInventoryCategory(null);
  };

  const removePetSlot = (slotId: SharedPet["id"]) => {
    if (slotId === "pet1") return;
    setPets((currentPets) => currentPets.filter((pet) => pet.id !== slotId));
    if (selectedPetId === slotId) setSelectedPetId("pet1");
    setFocusedPet(false);
    setActiveInventoryCategory(null);
  };

  const restartGame = (event?: MouseEvent<HTMLButtonElement>) => {
    event?.preventDefault();
    event?.stopPropagation();
    const now = Date.now();
    const roomId = BACKGROUNDS[0]?.id ?? "Wiese";
    const nextState: SharedGameState = {
      version: latestVersion.current,
      updatedAt: now,
      updatedBy: clientId.current,
      petName: "Momo",
      stats: initialStats,
      backgroundId: roomId,
      lifecycle: {
        createdAt: now,
        lastFedAt: now,
        lastPlayedAt: now,
        lastSleptAt: now,
        lastDecayAt: now,
        deadAt: 0
      },
      pet: {
        state: "sitzen",
        position: { x: 50, y: 78 },
        facing: 1,
        walkDurationMs: 0
      },
      pets: [createDefaultPet("pet1", DEFAULT_PET_VARIANT, "Momo", now)],
      ball: {
        visible: false,
        roomId,
        image: BALL_IMAGE,
        position: BALL_CENTER,
        rotation: 0,
        transitionMs: 0,
        lastPlayerTouchedAt: now
      },
      food: {
        visible: false,
        roomId,
        image: FOOD_IMAGES.steak,
        position: BALL_CENTER
      },
      bed: {
        visible: false,
        roomId,
        image: BED_IMAGE,
        position: BALL_CENTER,
        sleepEndsAt: 0,
        sleepOwnerId: "server"
      },
      notes: [],
      poops: []
    };

    clearTimers();
    setFocusedPet(false);
    setActiveInventoryCategory(null);
    setZoom(1);
    setScenePan({ x: 0, y: 0 });
    setSleepEndsAt(0);
    setSleepOwnerId("server");
    setPetState("sitzen");
    setSelectedPetId("pet1");
    applyRemoteState(nextState, true);
    void pushFullState(nextState);
  };

  const getScenePoint = (clientX: number, clientY: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return BALL_CENTER;
    const world = getSceneWorldMetrics(rect.width, rect.height);

    const originX = ((focusedPet ? petPosition.x : 50) / 100) * world.width;
    const originY = ((focusedPet ? petPosition.y : 50) / 100) * world.height;
    const localX = clientX - rect.left - world.left - scenePan.x;
    const localY = clientY - rect.top - world.top - scenePan.y;
    const worldPixelX = originX + (localX - originX) / zoom;
    const worldPixelY = originY + (localY - originY) / zoom;

    return {
      x: (worldPixelX / world.width) * 100,
      y: (worldPixelY / world.height) * 100
    };
  };

  const getBallPoint = (clientX: number, clientY: number) => {
    const point = getScenePoint(clientX, clientY);
    return {
      x: clampPosition(point.x, BALL_BOUNDS.minX, BALL_BOUNDS.maxX),
      y: clampPosition(point.y, BALL_AIR_BOUNDS.minY, BALL_AIR_BOUNDS.floorY)
    };
  };

  const getGroundItemPoint = (clientX: number, clientY: number) => {
    const point = getScenePoint(clientX, clientY);
    return {
      x: clampPosition(point.x, BALL_BOUNDS.minX, BALL_BOUNDS.maxX),
      y: clampPosition(point.y, BALL_AIR_BOUNDS.minY, BALL_AIR_BOUNDS.floorY)
    };
  };

  const getNotePoint = (clientX: number, clientY: number) => {
    const point = getScenePoint(clientX, clientY);
    return {
      x: clampPosition(point.x, NOTE_BOUNDS.minX, NOTE_BOUNDS.maxX),
      y: clampPosition(point.y, NOTE_BOUNDS.minY, NOTE_BOUNDS.maxY)
    };
  };

  const exitItemTrayForDrag = () => {
    setActiveInventoryCategory(null);
    setFocusedPet(false);
    setZoom(1);
    setScenePan(cameraFollowsPet ? getFocusPan(petPosition, 1) : { x: 0, y: 0 });
  };

  const updateFoodDrag = (clientX: number, clientY: number) => {
    const point = getGroundItemPoint(clientX, clientY);
    foodVelocity.current = {
      x: (point.x - foodPositionRef.current.x) * 40,
      y: (point.y - foodPositionRef.current.y) * 40
    };
    foodPositionRef.current = point;
    setFoodPosition(point);
  };

  const updateBedDrag = (clientX: number, clientY: number) => {
    const point = getGroundItemPoint(clientX, clientY);
    bedVelocity.current = {
      x: (point.x - bedPositionRef.current.x) * 35,
      y: (point.y - bedPositionRef.current.y) * 35
    };
    bedPositionRef.current = point;
    setBedPosition(point);
  };

  const updateNoteDrag = (clientX: number, clientY: number) => {
    const point = getNotePoint(clientX, clientY);
    noteDraftPositionRef.current = point;
    setNoteDraftPosition(point);
  };

  const updateBallDrag = (clientX: number, clientY: number) => {
    const point = getBallPoint(clientX, clientY);
    // eslint-disable-next-line react-hooks/purity
    const now = performance.now();
    const lastDrag = lastBallDrag.current;

    if (lastDrag) {
      const deltaSeconds = Math.max(0.016, (now - lastDrag.time) / 1000);
      ballVelocity.current = {
        x: (point.x - lastDrag.point.x) / deltaSeconds,
        y: (point.y - lastDrag.point.y) / deltaSeconds
      };
      setBallRotation((current) => current + (point.x - lastDrag.point.x) * 16);
    }

    lastBallDrag.current = { point, time: now };
    ballPositionRef.current = point;
    // eslint-disable-next-line react-hooks/purity
    setBallLastPlayerTouchedAt(Date.now());
    setBallPosition(point);
  };

  const finishBallThrow = () => {
    setBallDragging(false);
    ballThrownByPlayer.current = Math.hypot(ballVelocity.current.x, ballVelocity.current.y) > 8;
    // eslint-disable-next-line react-hooks/purity
    setBallLastPlayerTouchedAt(Date.now());
    lastBallDrag.current = null;
  };

  const finishFoodDrop = () => {
    setFoodDragging(false);
    setFoodSettling(true);
  };

  const finishBedDrop = () => {
    setBedDragging(false);
    setBedSettling(true);
  };

  const finishNoteDrop = () => {
    setNoteDragging(false);
    setNoteEditorOpen(true);
    setNoteText("");
  };

  const saveNote = () => {
    const canvas = noteCanvasRef.current;
    const imageData = canvas ? canvas.toDataURL("image/png") : "";
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    const note: SharedNote = {
      // eslint-disable-next-line react-hooks/purity
      id: `note-${now.toString(36)}-${Math.random().toString(36).slice(2)}`,
      roomId: backgroundId,
      position: noteDraftPositionRef.current,
      createdAt: now,
      template: noteDraftTemplate,
      imageData,
      text: noteText.trim()
    };

    setNotes((current) => [...current, note]);
    setNoteDraftVisible(false);
    setNoteEditorOpen(false);
    setNoteText("");
  };

  const cancelNote = () => {
    setNoteDraftVisible(false);
    setNoteDragging(false);
    setNoteEditorOpen(false);
    setNoteText("");
  };

  const removeViewedNote = () => {
    if (!viewingNoteId) return;
    setNotes((current) => current.filter((note) => note.id !== viewingNoteId));
    setViewingNoteId(null);
  };

  const removePoopById = (id: string) => {
    setPoops((current) => current.filter((p) => p.id !== id));
    changeStats({ mood: 1 });
  };

  const goToFirstPoop = () => {
    const first = poops[0];
    if (!first) return;
    setBackgroundId(first.roomId);
    setFocusedPet(false);
    setActiveInventoryCategory(null);
    const pan = getFocusPan({ x: first.position.x, y: first.position.y }, zoom);
    setScenePan(clampScenePan(pan, zoom));
  };

  const startNoteDrawing = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = noteCanvasRef.current;
    if (!canvas) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    noteDrawing.current = true;
    const context = canvas.getContext("2d");
    if (!context) return;
    const { x, y } = getCanvasPoint(canvas, event.clientX, event.clientY);
    context.beginPath();
    context.moveTo(x, y);
  };

  const drawOnNote = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!noteDrawing.current) return;
    const canvas = noteCanvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const { x, y } = getCanvasPoint(canvas, event.clientX, event.clientY);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = noteColor;
    context.lineWidth = noteBrushSize;
    context.lineTo(x, y);
    context.stroke();
  };

  const stopNoteDrawing = () => {
    noteDrawing.current = false;
  };

  const startTrayItemDrag = (item: TrayItem, event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    clearTimers();
    if (selectedPet.roomId !== backgroundId && item !== "note1" && item !== "note2") return;
    exitItemTrayForDrag();

    if (item === "ball" || item === "ball2") {
      markInteraction();
      const point = getBallPoint(event.clientX, event.clientY);
      // eslint-disable-next-line react-hooks/purity
      const now = Date.now();
      setBallVisible(true);
      setBallRoomId(backgroundId);
      setBallImageSrc(getTrayImage(item));
      setBallDragging(true);
      setBallTransitionMs(0);
      setBallLastPlayerTouchedAt(now);
      ballThrownByPlayer.current = false;
      ballVelocity.current = { x: 0, y: 0 };
      // eslint-disable-next-line react-hooks/purity
      lastBallDrag.current = { point, time: performance.now() };
      ballPositionRef.current = point;
      setBallRotation(0);
      setBallPosition(point);
      return;
    }

    if (item === "steak" || item === "bone" || item === "napf" || item === "snacks") {
      markInteraction();
      const point = getGroundItemPoint(event.clientX, event.clientY);
      setFoodVisible(true);
      setFoodRoomId(backgroundId);
      setFoodImageSrc(getTrayImage(item));
      setFoodDragging(true);
      setFoodSettling(false);
      foodVelocity.current = { x: 0, y: 0 };
      foodPositionRef.current = point;
      setFoodPosition(point);
      return;
    }

    if (item === "note1" || item === "note2") {
      const point = getNotePoint(event.clientX, event.clientY);
      setNoteDraftVisible(true);
      setNoteDragging(true);
      setNoteDraftTemplate(item);
      setNoteEditorOpen(false);
      noteDraftPositionRef.current = point;
      setNoteDraftPosition(point);
      return;
    }

    markInteraction();
    const point = getGroundItemPoint(event.clientX, event.clientY);
    setBedVisible(true);
    setBedRoomId(backgroundId);
    setBedImageSrc(getTrayImage(item));
    setBedDragging(true);
    setBedSettling(false);
    bedVelocity.current = { x: 0, y: 0 };
    setSleepEndsAt(0);
    setSleepOwnerId("server");
    bedPositionRef.current = point;
    setBedPosition(point);
  };

  const finishFoodPlacement = (foodTarget: Point) => {
    setFoodSettling(false);
    movePetTo(foodTarget, () => {
      setFoodVisible(false);
      setPetState("sitzen");
      setStats((current) => ({ ...current, hunger: 100 }));
      markCare("fed");
    }, 16);
  };

  const finishBedPlacement = (bedTarget: Point) => {
    setBedSettling(false);
    const sleepTarget = {
      x: bedTarget.x,
      y: clampPosition(bedTarget.y - BED_SLEEP_OFFSET_Y, MOVEMENT_AREA.minY, MOVEMENT_AREA.maxY)
    };
    const walkOntoBedTarget = {
      x: bedTarget.x,
      y: clampPosition(bedTarget.y + BED_WALK_INTO_OFFSET_Y, MOVEMENT_AREA.minY, MOVEMENT_AREA.maxY)
    };
    movePetTo(walkOntoBedTarget, () => {
      setWalkDurationMs(0);
      setPetPosition(sleepTarget);
      setPetState("sleep");
      setSleepOwnerId(clientId.current);
      setSleepEndsAt(Date.now() + SLEEP_DURATION_MS);
    }, 22);
  };

  const startBallDrag = (event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    markInteraction();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = getBallPoint(event.clientX, event.clientY);
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    setBallDragging(true);
    setBallRoomId(backgroundId);
    setBallTransitionMs(0);
    ballThrownByPlayer.current = false;
    ballVelocity.current = { x: 0, y: 0 };
    // eslint-disable-next-line react-hooks/purity
    lastBallDrag.current = { point, time: performance.now() };
    setBallLastPlayerTouchedAt(now);
    ballPositionRef.current = point;
    setBallPosition(point);
  };

  useEffect(() => {
    if (!ballDragging && !foodDragging && !bedDragging && !noteDragging) return;

    const handlePointerMove = (event: globalThis.PointerEvent) => {
      if (ballDragging) updateBallDrag(event.clientX, event.clientY);
      if (foodDragging) updateFoodDrag(event.clientX, event.clientY);
      if (bedDragging) updateBedDrag(event.clientX, event.clientY);
      if (noteDragging) updateNoteDrag(event.clientX, event.clientY);
    };

    const handlePointerUp = () => {
      if (ballDragging) finishBallThrow();
      if (foodDragging) finishFoodDrop();
      if (bedDragging) finishBedDrop();
      if (noteDragging) finishNoteDrop();
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerup", handlePointerUp, { passive: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ballDragging, foodDragging, bedDragging, noteDragging]);

  const fetchBall = (pickup = ballPositionRef.current) => {
    clearTimers();
    setFocusedPet(false);
    setBallTransitionMs(0);
    ballThrownByPlayer.current = false;
    // eslint-disable-next-line react-hooks/purity
    fetchJumpEnabled.current = Math.random() < FETCH_JUMP_CHANCE;

    const start = petPosition;
    const durationToPickup = getWalkDuration(start, pickup, 22);

    setFacing(pickup.x < start.x ? -1 : 1);
    setWalkDurationMs(durationToPickup);
    setPetState("laufen");
    setPetPosition(pickup);

    if (fetchJumpEnabled.current) {
      const jumpTimer = setTimeout(() => {
        setPetState("springen");

        const resumeRunTimer = setTimeout(() => {
          setPetState("laufen");
        }, 520);
        actionTimers.current.push(resumeRunTimer);
      }, durationToPickup / 2);
      actionTimers.current.push(jumpTimer);
    }

    const pickupTimer = setTimeout(() => {
      setBallVisible(false);

      const returnDuration = getWalkDuration(pickup, BALL_CENTER, 22);
      setFacing(BALL_CENTER.x < pickup.x ? -1 : 1);
      setWalkDurationMs(returnDuration);
      setPetState("laufen");
      setPetPosition(BALL_CENTER);

      const doneTimer = setTimeout(() => {
        setFacing(1);
        setWalkDurationMs(0);
        setPetState("sitzen");
        changeStats({ hunger: -1, energy: -2, mood: 9 });
        markCare("played");
        ballThrownByPlayer.current = false;
        ballVelocity.current = { x: 0, y: 0 };
        ballPositionRef.current = BALL_CENTER;
        setBallRoomId(backgroundId);
        setBallPosition(BALL_CENTER);
        setBallRotation(0);
        setBallTransitionMs(0);
        setBallVisible(true);
      }, returnDuration);
      actionTimers.current.push(doneTimer);
    }, durationToPickup);
    actionTimers.current.push(pickupTimer);
  };

  useEffect(() => {
    if (!foodVisible || foodDragging || !foodSettling) return;

    let animationFrame = 0;
    // eslint-disable-next-line react-hooks/purity
    let lastTick = performance.now();

    const tick = (now: number) => {
      const deltaSeconds = Math.min(0.04, (now - lastTick) / 1000);
      lastTick = now;

      setFoodPosition((current) => {
        let nextX = current.x + foodVelocity.current.x * deltaSeconds;
        let nextY = current.y + foodVelocity.current.y * deltaSeconds;
        let velocityX = foodVelocity.current.x * 0.96;
        let velocityY = (foodVelocity.current.y + ITEM_GRAVITY * deltaSeconds) * 0.99;

        if (nextX < BALL_BOUNDS.minX || nextX > BALL_BOUNDS.maxX) {
          nextX = clampPosition(nextX, BALL_BOUNDS.minX, BALL_BOUNDS.maxX);
          velocityX *= -0.45;
        }

        if (nextY < BALL_AIR_BOUNDS.minY) {
          nextY = BALL_AIR_BOUNDS.minY;
          velocityY *= -0.3;
        }

        if (nextY > BALL_AIR_BOUNDS.floorY) {
          nextY = BALL_AIR_BOUNDS.floorY;
          velocityY *= -0.28;
          velocityX *= 0.72;
        }

        const nextPosition = { x: nextX, y: nextY };
        foodPositionRef.current = nextPosition;
        foodVelocity.current = { x: velocityX, y: velocityY };
        return nextPosition;
      });

      const speed = Math.hypot(foodVelocity.current.x, foodVelocity.current.y);
      const landed = Math.abs(foodPositionRef.current.y - BALL_AIR_BOUNDS.floorY) < 0.6;
      if (landed && speed < 5) {
        foodVelocity.current = { x: 0, y: 0 };
        finishFoodPlacement(foodPositionRef.current);
        return;
      }

      animationFrame = requestAnimationFrame(tick);
    };

    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foodDragging, foodSettling, foodVisible]);

  useEffect(() => {
    if (!bedVisible || bedDragging || !bedSettling) return;

    let animationFrame = 0;
    // eslint-disable-next-line react-hooks/purity
    let lastTick = performance.now();

    const tick = (now: number) => {
      const deltaSeconds = Math.min(0.04, (now - lastTick) / 1000);
      lastTick = now;

      setBedPosition((current) => {
        let nextX = current.x + bedVelocity.current.x * deltaSeconds;
        let nextY = current.y + bedVelocity.current.y * deltaSeconds;
        let velocityX = bedVelocity.current.x * 0.88;
        let velocityY = (bedVelocity.current.y + ITEM_GRAVITY * deltaSeconds) * 0.97;

        if (nextX < BALL_BOUNDS.minX || nextX > BALL_BOUNDS.maxX) {
          nextX = clampPosition(nextX, BALL_BOUNDS.minX, BALL_BOUNDS.maxX);
          velocityX *= -0.25;
        }

        if (nextY < BALL_AIR_BOUNDS.minY) {
          nextY = BALL_AIR_BOUNDS.minY;
          velocityY *= -0.15;
        }

        if (nextY > BALL_AIR_BOUNDS.floorY) {
          nextY = BALL_AIR_BOUNDS.floorY;
          velocityY *= -0.1;
          velocityX *= 0.4;
        }

        const nextPosition = { x: nextX, y: nextY };
        bedPositionRef.current = nextPosition;
        bedVelocity.current = { x: velocityX, y: velocityY };
        return nextPosition;
      });

      const speed = Math.hypot(bedVelocity.current.x, bedVelocity.current.y);
      const landed = Math.abs(bedPositionRef.current.y - BALL_AIR_BOUNDS.floorY) < 0.8;
      if (landed && speed < 6) {
        bedVelocity.current = { x: 0, y: 0 };
        finishBedPlacement(bedPositionRef.current);
        return;
      }

      animationFrame = requestAnimationFrame(tick);
    };

    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bedDragging, bedSettling, bedVisible]);

  useEffect(() => {
    if (!ballVisible || ballDragging) return;

    let animationFrame = 0;
    // eslint-disable-next-line react-hooks/purity
    let lastTick = performance.now();

    const tick = (now: number) => {
      const deltaSeconds = Math.min(0.04, (now - lastTick) / 1000);
      lastTick = now;

      setBallPosition((current) => {
        let nextX = current.x + ballVelocity.current.x * deltaSeconds;
        let nextY = current.y + ballVelocity.current.y * deltaSeconds;
        let velocityX = ballVelocity.current.x * 0.985;
        let velocityY = (ballVelocity.current.y + BALL_GRAVITY * deltaSeconds) * 0.992;

        if (nextX < BALL_BOUNDS.minX || nextX > BALL_BOUNDS.maxX) {
          nextX = clampPosition(nextX, BALL_BOUNDS.minX, BALL_BOUNDS.maxX);
          velocityX *= -0.55;
        }

        if (nextY < BALL_AIR_BOUNDS.minY) {
          nextY = BALL_AIR_BOUNDS.minY;
          velocityY *= -0.35;
        }

        if (nextY > BALL_AIR_BOUNDS.floorY) {
          nextY = BALL_AIR_BOUNDS.floorY;
          velocityY *= -0.32;
          velocityX *= 0.82;
        }

        const nextPosition = { x: nextX, y: nextY };
        ballPositionRef.current = nextPosition;
        ballVelocity.current = { x: velocityX, y: velocityY };
        setBallRotation((currentRotation) => currentRotation + velocityX * deltaSeconds * 16);
        return nextPosition;
      });

      const speed = Math.hypot(ballVelocity.current.x, ballVelocity.current.y);
      const landed = Math.abs(ballPositionRef.current.y - BALL_AIR_BOUNDS.floorY) < 0.4;
      if (landed && speed < 3) {
        ballVelocity.current = { x: 0, y: 0 };
        setBallTransitionMs(0);
        if (ballThrownByPlayer.current) fetchBall(ballPositionRef.current);
        return;
      }

      animationFrame = requestAnimationFrame(tick);
    };

    if (Math.hypot(ballVelocity.current.x, ballVelocity.current.y) > 0) {
      animationFrame = requestAnimationFrame(tick);
    }

    return () => cancelAnimationFrame(animationFrame);
  // The physics loop intentionally reads the latest ball position through refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ballDragging, ballVisible]);

  return (
    <main className="appShell">
      {hearts.map((heart) => (
        <div
          aria-hidden="true"
          className="floatingHeart"
          key={heart.id}
          style={{ left: `${heart.x}px`, top: `${heart.y}px`, "--heart-dx": `${heart.dx}px`, "--heart-rot": `${heart.rot}deg` } as CSSProperties}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt="" draggable={false} src={HEART_IMAGE} />
        </div>
      ))}
      <section className="gameCard" aria-label="Pet game">
        <div
          className="stage"
          onClick={handleStageClick}
          onPointerDown={startStageDrag}
          onPointerMove={dragStage}
          onPointerUp={finishStageDrag}
          onWheel={handleWheel}
          ref={stageRef}
          style={stageStyle}
        >
          <div className="sceneWorld">
            <div className="backgroundFallback" aria-hidden="true" />
            <div aria-label={activeBackground?.label ?? "Background"} className="backgroundSprite" role="img" style={backgroundStyle} />

            {petsInRoom.map((pet) => {
              const variant = PET_VARIANTS.find((entry) => entry.id === pet.assetKey) ?? PET_VARIANTS[0];
              const state = variant?.states[pet.state] ?? PET_STATES[pet.state];
              const allFrames = state.frames.length > 0 ? state.frames : PET_STATES.stehen.frames;
              const isStrokeTarget = petZoomMode === "close" && pet.id === selectedPetId;
              let frames: typeof allFrames;
              if (isStrokeTarget && isStroking) {
                const idx = Math.min(STROKE_FRAME_INDEX[pet.assetKey] ?? 0, allFrames.length - 1);
                frames = [allFrames[idx]] as unknown as typeof allFrames;
              } else if (isStrokeTarget) {
                frames = [allFrames[0]] as unknown as typeof allFrames;
              } else {
                frames = allFrames;
              }
              const safeX = Math.max(2, Math.min(98, pet.position.x));
              const safeY = Math.max(MOVEMENT_AREA.minY, Math.min(MOVEMENT_AREA.maxY, pet.position.y));
              const style = {
                "--pet-x": `${safeX}%`,
                "--pet-y": `${safeY}%`,
                "--pet-facing": pet.facing,
                "--pet-walk-duration": `${pet.walkDurationMs}ms`
              } as CSSProperties;
              return (
                <AnimatedSprite
                  className={`petSprite${pet.id === selectedPetId ? " selected" : ""}${pet.state === "springen" ? " jumping" : ""}${pet.state === "sleep" ? " sleeping" : ""}${isStrokeTarget ? " strokeTarget" : ""}`}
                  frameMs={state.frameMs}
                  frames={frames}
                  key={pet.id}
                  label={`${pet.name} ${state.label}`}
                  onClick={isDead || pet.lifecycle.deadAt > 0 ? undefined : (event) => handlePetClick(pet, event)}
                  onPointerDown={isStrokeTarget ? startPetStroke : undefined}
                  onPointerMove={isStrokeTarget ? movePetStroke : undefined}
                  onPointerUp={isStrokeTarget ? endPetStroke : undefined}
                  style={style}
                />
              );
            })}

            {walkTargetMarker && selectedPet.roomId === backgroundId ? (
              <div
                aria-hidden="true"
                className="walkTargetMarker"
                style={{ "--target-x": `${walkTargetMarker.x}%`, "--target-y": `${walkTargetMarker.y}%` } as CSSProperties}
              />
            ) : null}

            {ballVisible && ballRoomId === backgroundId ? (
              <div
                aria-label="Ball"
                className={`ball${ballDragging ? " dragging" : ""}${ballImageReady ? " hasImage" : ""}`}
                onPointerDown={startBallDrag}
                role="button"
                style={ballStyle}
                tabIndex={0}
              />
            ) : null}

            {foodVisible && foodRoomId === backgroundId ? (
              <div
                aria-label="Steak"
                className={`worldItem foodItem${foodDragging ? " dragging" : ""}${foodImageReady ? " hasImage" : ""}`}
                role="button"
                style={foodStyle}
                tabIndex={0}
              >
                {foodImageReady ? <NextImage alt="" className="worldItemImage" draggable={false} fill sizes="132px" src={foodImageSrc} /> : null}
              </div>
            ) : null}

            {bedVisible && bedRoomId === backgroundId ? (
              <div
                aria-label="Bed"
                className={`worldItem bedItem${bedDragging ? " dragging" : ""}${bedImageReady ? " hasImage" : ""}`}
                role="button"
                style={bedStyle}
                tabIndex={0}
              >
                {bedImageReady ? <NextImage alt="" className="worldItemImage" draggable={false} fill sizes="340px" src={bedImageSrc} /> : null}
              </div>
            ) : null}

            {noteDraftVisible && !noteEditorOpen ? (
              <div
                aria-label="Note draft"
                className={`worldItem noteItem${noteDragging ? " dragging" : ""}${noteImagesReady[noteDraftTemplate] ? " hasImage" : ""}`}
                role="button"
                style={noteDraftStyle}
              >
                {noteImagesReady[noteDraftTemplate] ? <NextImage alt="" className="worldItemImage" draggable={false} fill sizes="180px" src={NOTE_IMAGES[noteDraftTemplate]} /> : null}
              </div>
            ) : null}

            {poops.filter((p) => p.roomId === backgroundId).map((poop) => (
              <button
                aria-label="Clean up"
                className="worldPoop"
                key={poop.id}
                onClick={(event) => { event.stopPropagation(); removePoopById(poop.id); }}
                onPointerDown={(event) => event.stopPropagation()}
                style={{ "--poop-x": `${poop.position.x}%`, "--poop-y": `${poop.position.y}%` } as CSSProperties}
                type="button"
              >
                <NextImage alt="" draggable={false} fill sizes="72px" src={POOP_IMAGE} />
              </button>
            ))}

            {notes.filter((note) => note.roomId === backgroundId).map((note) => (
              <button
                aria-label="Open note"
                className="worldNote"
                key={note.id}
                onClick={(event) => {
                  event.stopPropagation();
                  setViewingNoteId(note.id);
                }}
                onPointerDown={(event) => event.stopPropagation()}
                style={{ "--note-x": `${note.position.x}%`, "--note-y": `${note.position.y}%` } as CSSProperties}
                type="button"
              >
                <span
                  className={`worldNotePaper ${note.template ?? "note1"}${noteImagesReady[note.template ?? "note1"] ? " hasImage" : ""}`}
                  style={noteImagesReady[note.template ?? "note1"] ? { backgroundImage: `url(${NOTE_IMAGES[note.template ?? "note1"]})` } : undefined}
                >
                  {note.imageData ? <span className="worldNoteDrawing" style={{ backgroundImage: `url(${note.imageData})` }} /> : null}
                  {note.text ? <span className="worldNoteText">{note.text}</span> : null}
                </span>
              </button>
            ))}
          </div>

          {petState === "sleep" && selectedPet.roomId === backgroundId && !isDead ? <div className="sleepOverlay" aria-hidden="true" /> : null}

          {isDead ? (
            <div className="deathOverlay" role="dialog" aria-label="Pet died">
              <div className="deathPanel">
                <strong>R.I.P</strong>
                <button onClick={restartGame} type="button">Restart</button>
              </div>
            </div>
          ) : null}

          <section className={`statusPanel${focusedPet ? " dimmed" : ""}`} aria-label="Pet status">
            <div className="petName">
              <button className="petNameButton" disabled={!canSwitchPet} onClick={canSwitchPet ? switchSelectedPet : undefined} title="Switch pet" type="button">
                {petName}
              </button>
            </div>
            <div className="statList">
              <StatBar className="hunger" icon={HUNGER_ICON} label="Hunger" value={stats.hunger} />
              <StatBar className="energy" icon={ENERGY_ICON} label="Energy" value={stats.energy} />
              <StatBar className="mood" icon={MOOD_ICON} label="Mood" value={stats.mood} />
            </div>
          </section>

          {focusedPet ? (
            <section className="focusPanel" aria-label="Edit pet">
              {activeInventoryCategory ? (
                <div className="itemTray inlineInventory fullInventory" aria-label={`${getCategoryLabel(activeInventoryCategory)} inventory`}>
                  <div className="itemTrayBubbles">
                    {trayItems.map((item) => (
                      <button className={`itemTrayBubble ${item}TrayBubble`} key={item} onPointerDown={(event) => startTrayItemDrag(item, event)} type="button">
                        {getTrayImageReady(item, ballImageReady, foodImageReady, bedImageReady, noteImagesReady) ? (
                          <NextImage alt="" className="itemTrayImage" draggable={false} fill sizes="96px" src={getTrayImage(item)} />
                        ) : <span className="itemTrayFallback">{getTrayLabel(item)}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  <label className="nameEditor">
                    <span>Name</span>
                    <input maxLength={24} onBlur={flushPetNameDraft} onChange={(event) => changePetNameDraft(event.target.value)} value={petNameDraft} />
                  </label>
                  <div className="bigStats">
                    <StatBar className="hunger" icon={HUNGER_ICON} label="Hunger" value={stats.hunger} />
                    <StatBar className="energy" icon={ENERGY_ICON} label="Energy" value={stats.energy} />
                    <StatBar className="mood" icon={MOOD_ICON} label="Mood" value={stats.mood} />
                  </div>
                  <div className={`categoryGrid${inventoryCategories.length === 3 ? " threeCategories" : ""}`} aria-label="Inventory categories">
                    {inventoryCategories.map((category) => (
                      <button aria-label={getCategoryLabel(category)} className="categoryButton" key={category} onClick={() => setActiveInventoryCategory(category)} title={getCategoryLabel(category)} type="button">
                        <span className="categoryIcon">
                          <NextImage alt="" draggable={false} fill sizes="72px" src={CATEGORY_ICONS[category]} />
                        </span>
                        <span>{getCategoryLabel(category)}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
              <div className="focusPanelButtons">
                <button className="closeFocus" onClick={handleFocusBack} type="button">
                  Back
                </button>
                <button aria-label="Inspect" className="inspectButton" onClick={() => zoomCloseToPet()} type="button">
                  <NextImage alt="Inspect" draggable={false} fill sizes="24px" src={INSPECT_IMAGE} />
                </button>
              </div>
            </section>
          ) : null}

          {noteEditorOpen ? (
            <section className="noteEditorOverlay" aria-label="Create note" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
              <div className="noteEditorPanel">
                <strong>New note</strong>
                <canvas
                  className="noteCanvas"
                  height={260}
                  onPointerDown={startNoteDrawing}
                  onPointerLeave={stopNoteDrawing}
                  onPointerMove={drawOnNote}
                  onPointerUp={stopNoteDrawing}
                  ref={noteCanvasRef}
                  width={360}
                />
                <textarea maxLength={220} onChange={(event) => setNoteText(event.target.value)} placeholder="Write a message..." value={noteText} />
                <div className="noteTools">
                  <label>
                    Color
                    <input onChange={(event) => setNoteColor(event.target.value)} type="color" value={noteColor} />
                  </label>
                  <label>
                    Size
                    <input max={24} min={2} onChange={(event) => setNoteBrushSize(Number(event.target.value))} type="range" value={noteBrushSize} />
                  </label>
                </div>
                <div className="noteActions">
                  <button onClick={saveNote} type="button">Place</button>
                  <button onClick={cancelNote} type="button">Cancel</button>
                </div>
              </div>
            </section>
          ) : null}

          {viewingNote ? (
            <section className="noteViewerOverlay" aria-label="View note" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
              <div className="noteViewerPanel">
                <time className="noteViewerTimestamp">{formatNoteTime(viewingNote.createdAt)}</time>
                <div
                  className={`noteViewerPaper ${viewingNote.template ?? "note1"}${noteImagesReady[viewingNote.template ?? "note1"] ? " hasImage" : ""}`}
                  style={noteImagesReady[viewingNote.template ?? "note1"] ? { backgroundImage: `url(${NOTE_IMAGES[viewingNote.template ?? "note1"]})` } : undefined}
                >
                  {viewingNote.imageData ? <span className="worldNoteDrawing" style={{ backgroundImage: `url(${viewingNote.imageData})` }} /> : null}
                  {viewingNote.text ? <p>{viewingNote.text}</p> : null}
                </div>
                <div className="noteActions">
                  <button onClick={() => setViewingNoteId(null)} type="button">Keep</button>
                  <button className="removeNoteButton" onClick={removeViewedNote} type="button">Remove</button>
                </div>
              </div>
            </section>
          ) : null}
        </div>

        {settingsOpen && !focusedPet ? (
          <section className="settingsPanel" aria-label="Pet settings">
            {(["pet1", "pet2"] as SharedPet["id"][]).map((slotId) => {
              const slotPet = pets.find((pet) => pet.id === slotId);
              return (
                <div className="petSlot" key={slotId}>
                  <div className="petSlotHeader">
                    <strong>{slotId === "pet1" ? "Pet 1" : "Pet 2"}</strong>
                    <span>{slotPet ? (slotId === selectedPetId ? "Selected" : "Active") : "Empty"}</span>
                  </div>
                  <div className="petVariantList">
                    {PET_VARIANTS.map((variant) => (
                      <button
                        className={slotPet?.assetKey === variant.id ? "active" : ""}
                        key={variant.id}
                        onClick={() => togglePetSlot(slotId, variant.id)}
                        type="button"
                      >
                        {variant.label}
                      </button>
                    ))}
                    {slotId === "pet2" && slotPet ? <button className="removePetButton" onClick={() => removePetSlot(slotId)} type="button">Remove</button> : null}
                  </div>
                </div>
              );
            })}
          </section>
        ) : null}

        {!focusedPet && petZoomMode !== "close" ? (
          <div className="controls" aria-label="Controls">
            <div className="controlMenu" aria-label="Control menu">
                {poops.length > 0 ? (
                  <button
                    aria-label={`${poops.length} poop pile${poops.length > 1 ? "s" : ""} – tap to go there`}
                    className="poopIndicatorButton"
                    onClick={goToFirstPoop}
                    type="button"
                  >
                    <NextImage alt="" draggable={false} fill sizes="28px" src={POOP_IMAGE} />
                    <span aria-hidden="true">!</span>
                  </button>
                ) : null}
                <button
                  aria-label={settingsOpen ? "Settings" : "Follow pet camera"}
                  aria-pressed={settingsOpen || cameraFollowsPet}
                  className={`iconControlButton cameraFollowButton${settingsOpen || cameraFollowsPet ? " active" : ""}`}
                  onClick={handleCameraButtonClick}
                  onPointerUp={(event) => event.currentTarget.blur()}
                  title="Follow pet camera. Click 5 times quickly for settings."
                  type="button"
                >
                  <NextImage alt="" draggable={false} fill sizes="36px" src={settingsOpen ? SETTINGS_ICON : CAM_ICON} />
                </button>
                <select className="select" disabled={isDead} onChange={(event) => changeBackground(event.target.value)} value={backgroundId}>
                  {BACKGROUNDS.map((background) => (
                    <option key={background.id} value={background.id}>
                      {background.label}
                    </option>
                  ))}
                </select>
            </div>
          </div>
        ) : null}

      {petZoomMode === "close" ? (
        <button
          aria-label="Exit inspect mode"
          className="inspectBackButton"
          onClick={exitCloseZoom}
          type="button"
        >
          Back
        </button>
      ) : null}

      </section>
    </main>
  );
}

function createDefaultPet(id: SharedPet["id"], assetKey: string, name: string, now = Date.now()): SharedPet {
  return {
    id,
    updatedAt: now,
    assetKey,
    name,
    stats: { ...initialStats },
    lifecycle: {
      createdAt: now,
      lastFedAt: now,
      lastPlayedAt: now,
      lastSleptAt: now,
      lastDecayAt: now,
      deadAt: 0
    },
    roomId: BACKGROUNDS[0]?.id ?? "Wiese",
    state: "sitzen",
    position: { x: id === "pet1" ? 50 : 58, y: 78 },
    facing: 1,
    walkDurationMs: 0,
    lastInteractionAt: now,
    lastAutoAt: now,
    pendingRoomId: "",
    pendingRoomDirection: 0,
    autoExitAt: 0
  };
}

function normalizeRemotePets(remoteState: SharedGameState): SharedPet[] {
  const now = Date.now();
  if (remoteState.pets?.length) {
    return remoteState.pets.slice(0, 2).map((pet, index) => ({
      ...createDefaultPet(index === 0 ? "pet1" : "pet2", index === 0 ? DEFAULT_PET_VARIANT : SECOND_PET_VARIANT, index === 0 ? "Momo" : "Pet 2"),
      ...pet,
      updatedAt: pet.updatedAt ?? now,
      stats: { ...initialStats, ...pet.stats },
      lifecycle: { ...initialLifecycle, ...pet.lifecycle },
      roomId: pet.roomId ?? remoteState.backgroundId,
      position: {
        x: Math.max(2, Math.min(98, pet.position?.x ?? (index === 0 ? 50 : 58))),
        y: Math.max(MOVEMENT_AREA.minY, Math.min(MOVEMENT_AREA.maxY, pet.position?.y ?? 78))
      },
      lastInteractionAt: pet.lastInteractionAt ?? now,
      lastAutoAt: pet.lastAutoAt ?? now,
      pendingRoomId: pet.pendingRoomId ?? "",
      pendingRoomDirection: pet.pendingRoomDirection ?? 0,
      autoExitAt: pet.autoExitAt ?? 0
    }));
  }

  return [{
    ...createDefaultPet("pet1", DEFAULT_PET_VARIANT, remoteState.petName),
    name: remoteState.petName,
    updatedAt: remoteState.updatedAt,
    stats: { ...initialStats, ...remoteState.stats },
    lifecycle: { ...initialLifecycle, ...remoteState.lifecycle },
    roomId: remoteState.backgroundId,
    state: remoteState.pet.state,
    position: remoteState.pet.position,
    facing: remoteState.pet.facing,
    walkDurationMs: remoteState.pet.walkDurationMs,
    lastInteractionAt: remoteState.updatedAt,
    lastAutoAt: Date.now(),
    pendingRoomId: "",
    pendingRoomDirection: 0,
    autoExitAt: 0
  }];
}

function preloadImage(src: string) {
  if (!src) return;
  const image = new Image();
  image.decoding = "async";
  image.src = src;
}

function StatBar({ className, icon, label, value }: { className: string; icon: string; label: string; value: number }) {
  return (
    <div aria-label={`${label}: ${value}%`} className="statRow" title={`${label}: ${value}%`}>
      <span className="statIcon" aria-hidden="true">
        <NextImage alt="" draggable={false} fill sizes="24px" src={icon} />
      </span>
      <div className="statTrack">
        <div className={`statFill ${className}`} style={{ width: `${value}%` }} />
      </div>
      <span className="statPercent" aria-hidden="true">{value}%</span>
    </div>
  );
}

function clampStat(value: number) {
  return Math.max(0, Math.min(100, value));
}

function clampZoom(value: number) {
  return Math.round(Math.max(MIN_ZOOM, Math.min(4, value)) * 100) / 100;
}

function clampPosition(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getWalkDuration(from: Point, to: Point, speed = 8) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  return Math.max(420, Math.round((distance / speed) * 1000));
}

function getPointDistance(first: Point, second: Point) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function getPointCenter(first: Point, second: Point) {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2
  };
}

function isKitchenRoom(roomId: string) {
  const normalized = roomId.toLocaleLowerCase("de-DE");
  return normalized === "küche" || normalized === "kuche" || normalized === "kueche" || normalized === "kitchen";
}

function getTrayImage(item: TrayItem) {
  if (item === "ball") return BALL_IMAGE;
  if (item === "ball2") return BALL2_IMAGE;
  if (item === "steak") return FOOD_IMAGES.steak;
  if (item === "bone") return FOOD_IMAGES.bone;
  if (item === "napf") return FOOD_IMAGES.napf;
  if (item === "snacks") return FOOD_IMAGES.snacks;
  if (item === "bed") return BED_IMAGE;
  if (item === "bed2") return BED2_IMAGE;
  if (item === "bed3") return BED3_IMAGE;
  return NOTE_IMAGES[item];
}

function getTrayLabel(item: TrayItem) {
  if (item === "ball") return "Ball";
  if (item === "ball2") return "Ball 2";
  if (item === "steak") return "Steak";
  if (item === "bone") return "Bone";
  if (item === "napf") return "Bowl";
  if (item === "snacks") return "Snack";
  if (item === "bed") return "Bed";
  if (item === "bed2") return "Bed 2";
  if (item === "bed3") return "Bed 3";
  return item === "note1" ? "Note 1" : "Note 2";
}

function getTrayImageReady(item: TrayItem, ballReady: boolean, foodReady: boolean, bedReady: boolean, noteReady: Record<NoteTemplate, boolean>) {
  if (item === "ball") return ballReady;
  if (item === "ball2") return true;
  if (item === "steak") return foodReady;
  if (item === "bone" || item === "napf" || item === "snacks") return true;
  if (item === "bed") return bedReady;
  if (item === "bed2") return true;
  if (item === "bed3") return true;
  return noteReady[item];
}

function getInventoryItems(category: InventoryCategory): TrayItem[] {
  if (category === "play") return ["ball", "ball2"];
  if (category === "feed") return ["steak", "bone", "napf", "snacks"];
  if (category === "sleep") return ["bed", "bed2", "bed3"];
  return ["note1", "note2"];
}

function getCategoryLabel(category: InventoryCategory) {
  if (category === "play") return "Toys";
  if (category === "feed") return "Food";
  if (category === "sleep") return "Bed";
  return "Notes";
}

function getCanvasPoint(canvas: HTMLCanvasElement, clientX: number, clientY: number) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) / rect.width) * canvas.width,
    y: ((clientY - rect.top) / rect.height) * canvas.height
  };
}

function formatNoteTime(timestamp: number) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(timestamp);
}

function getSceneWorldMetrics(viewportWidth: number, viewportHeight: number) {
  if (viewportWidth <= 0 || viewportHeight <= 0) {
    return { width: viewportWidth, height: viewportHeight, left: 0, top: 0 };
  }

  const fitsHeightViewport = viewportWidth <= 760;
  const worldScale = fitsHeightViewport
    ? viewportHeight / BACKGROUND_HEIGHT
    : Math.max(viewportWidth / BACKGROUND_WIDTH, viewportHeight / BACKGROUND_HEIGHT, 1);
  const worldWidth = BACKGROUND_WIDTH * worldScale;
  const worldHeight = BACKGROUND_HEIGHT * worldScale;

  return {
    width: worldWidth,
    height: worldHeight,
    left: (viewportWidth - worldWidth) / 2,
    top: (viewportHeight - worldHeight) / 2
  };
}

function getScenePanLimits(zoom: number) {
  const width = typeof window === "undefined" ? 0 : window.innerWidth;
  const height = typeof window === "undefined" ? 0 : window.innerHeight;
  const world = getSceneWorldMetrics(width, height);

  return {
    maxX: Math.max(0, (world.width * zoom - width) / 2),
    maxY: Math.max(0, (world.height * zoom - height) / 2)
  };
}

function getLooseScenePanLimits(zoom: number) {
  const width = typeof window === "undefined" ? 0 : window.innerWidth;
  const height = typeof window === "undefined" ? 0 : window.innerHeight;
  const world = getSceneWorldMetrics(width, height);

  return {
    maxX: Math.max(0, (world.width * zoom + width) / 2),
    maxY: Math.max(0, (world.height * zoom + height) / 2)
  };
}

function getFocusPan(target: Point, zoom: number, allowOverflow = false) {
  const width = typeof window === "undefined" ? 0 : window.innerWidth;
  const height = typeof window === "undefined" ? 0 : window.innerHeight;
  const world = getSceneWorldMetrics(width, height);
  const originX = (target.x / 100) * world.width;
  const originY = (target.y / 100) * world.height;
  const point = {
    x: (world.width / 2 - originX) * zoom,
    y: (world.height / 2 - originY) * zoom
  };

  return allowOverflow ? clampScenePanLoose(point, zoom) : clampScenePan(point, zoom);
}

function clampScenePan(point: Point, zoom: number) {
  const { maxX, maxY } = getScenePanLimits(zoom);

  return {
    x: clampPosition(point.x, -maxX, maxX),
    y: clampPosition(point.y, -maxY, maxY)
  };
}

function clampScenePanLoose(point: Point, zoom: number) {
  const { maxX, maxY } = getLooseScenePanLimits(zoom);

  return {
    x: clampPosition(point.x, -maxX, maxX),
    y: clampPosition(point.y, -maxY, maxY)
  };
}
