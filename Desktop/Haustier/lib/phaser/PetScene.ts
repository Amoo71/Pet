// Phaser game scene – pure rendering layer.
// React owns all state and logic; this scene reads stateRef every frame.

export const WORLD_W = 1672;
export const WORLD_H = 941;

export type PhaserPoint = { x: number; y: number };

export type PhaserPetData = {
  id: string;
  assetKey: string;
  state: string;
  position: PhaserPoint;
  facing: number;
  walkDurationMs: number;
  isSelected: boolean;
  isDead: boolean;
};

export type PhaserPoopData = { id: string; position: PhaserPoint };
export type PhaserNoteData = { id: string; position: PhaserPoint; template: string };

export type PhaserState = {
  backgroundFrames: readonly string[];
  backgroundFrameMs: number;
  petsInRoom: PhaserPetData[];
  selectedPetId: string;
  petZoomMode: "normal" | "close";
  isStroking: boolean;
  strokeFrameIndex: Record<string, number>;
  petFramesByVariantState: Record<string, Record<string, readonly string[]>>;
  petFrameMsByVariantState: Record<string, Record<string, number>>;
  walkTargetMarker: PhaserPoint | null;
  ballVisible: boolean;
  ballImageSrc: string;
  ballPosition: PhaserPoint;
  ballRotation: number;
  foodVisible: boolean;
  foodImageSrc: string;
  foodPosition: PhaserPoint;
  bedVisible: boolean;
  bedImageSrc: string;
  bedPosition: PhaserPoint;
  noteDraftVisible: boolean;
  noteDraftTemplate: string;
  noteDraftPosition: PhaserPoint;
  poops: PhaserPoopData[];
  notes: PhaserNoteData[];
  zoom: number;
  scenePan: PhaserPoint;
  sleepActive: boolean;
};

function urlKey(url: string): string {
  return `t_${url.replace(/[^a-z0-9]/gi, "_")}`;
}

// Factory avoids top-level Phaser import (which breaks SSR in Next.js)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createPetSceneClass(PhaserLib: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return class PetScene extends (PhaserLib.Scene as any) {
    stateRef!: { current: PhaserState };

    private bgSprite: unknown = null;
    private prevBgUrl = "";
    private bgAnimTimer = 0;
    private bgFrameIdx = 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private petSprites = new Map<string, any>();
    private petAnimTimers = new Map<string, { elapsed: number; idx: number }>();

    private markerSprite: unknown = null;
    private ballSprite: unknown = null;
    private foodSprite: unknown = null;
    private bedSprite: unknown = null;
    private noteDraftSprite: unknown = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private poopSprites = new Map<string, any>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private noteSprites = new Map<string, any>();
    private sleepRect: unknown = null;

    private queuedLoads = new Set<string>();

    constructor() {
      super({ key: "PetScene" });
    }

    preload() {
      const state = this.stateRef.current;
      this._loadTextures(state);
    }

    create() {
      // Camera world bounds (generous so we can scroll freely)
      this.cameras.main.setBounds(-WORLD_W * 3, -WORLD_H * 3, WORLD_W * 7, WORLD_H * 7);

      // Background sprite
      this.bgSprite = this.add.image(WORLD_W / 2, WORLD_H / 2, "__DEFAULT");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.bgSprite as any).setOrigin(0.5, 0.5).setDepth(0);

      // Walk target marker
      this.markerSprite = this.add.image(0, 0, "__DEFAULT");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.markerSprite as any).setOrigin(0.5, 0.9).setDepth(5).setVisible(false).setAlpha(0.9);

      // Ball
      this.ballSprite = this.add.image(0, 0, "__DEFAULT");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.ballSprite as any).setOrigin(0.5, 0.5).setDepth(6).setVisible(false);

      // Food
      this.foodSprite = this.add.image(0, 0, "__DEFAULT");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.foodSprite as any).setOrigin(0.5, 1.0).setDepth(6).setVisible(false);

      // Bed
      this.bedSprite = this.add.image(0, 0, "__DEFAULT");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.bedSprite as any).setOrigin(0.5, 1.0).setDepth(4).setVisible(false);

      // Note draft
      this.noteDraftSprite = this.add.image(0, 0, "__DEFAULT");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.noteDraftSprite as any).setOrigin(0.5, 0.5).setDepth(6).setVisible(false);

      // Sleep dark overlay
      this.sleepRect = this.add
        .rectangle(WORLD_W / 2, WORLD_H / 2, WORLD_W * 7, WORLD_H * 7, 0x03040e, 0.55)
        .setDepth(8)
        .setVisible(false);

      // Kick off loading any remaining textures
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.load as any).start();
    }

    update(_time: number, delta: number) {
      const state = this.stateRef.current;
      this._ensureTextures(state);
      this._updateCamera(state);
      this._updateBackground(state, delta);
      this._updatePets(state, delta);
      this._updateMarker(state);
      this._updateBall(state);
      this._updateFood(state);
      this._updateBed(state);
      this._updateNoteDraft(state);
      this._updatePoops(state);
      this._updateNotes(state);
      this._updateSleepOverlay(state);
    }

    // ── Texture loading ─────────────────────────────────────────────────────

    _loadTextures(state: PhaserState) {
      const urls: string[] = [
        ...state.backgroundFrames,
        "/assets/backgrounds/UI/position.png",
        "/assets/backgrounds/UI/poop.png",
        "/assets/items/ball.png",
        "/assets/items/ball2.png",
        "/assets/items/food/steak.png",
        "/assets/items/food/bone.png",
        "/assets/items/food/napf.png",
        "/assets/items/food/snacks.png",
        "/assets/items/bett.png",
        "/assets/items/bett2.png",
        "/assets/items/bett3.png",
        "/assets/items/notiz1.png",
        "/assets/items/notiz2.png",
      ];
      Object.values(state.petFramesByVariantState).forEach((states) => {
        Object.values(states).forEach((frames) => frames.forEach((u) => urls.push(u)));
      });
      urls.forEach((url) => this._queueLoad(url));
    }

    _ensureTextures(state: PhaserState) {
      let added = false;
      const check = (url: string) => {
        if (this._queueLoad(url)) added = true;
      };
      state.backgroundFrames.forEach(check);
      check(state.ballImageSrc);
      check(state.foodImageSrc);
      check(state.bedImageSrc);
      if (added) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.load as any).start();
      }
    }

    _queueLoad(url: string): boolean {
      if (!url) return false;
      const key = urlKey(url);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((this.textures as any).exists(key) || this.queuedLoads.has(key)) return false;
      this.queuedLoads.add(key);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.load as any).image(key, url);
      return true;
    }

    _hasTexture(url: string): boolean {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return !!(url && (this.textures as any).exists(urlKey(url)));
    }

    _setTexture(sprite: unknown, url: string) {
      if (!this._hasTexture(url)) return false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sprite as any).setTexture(urlKey(url));
      return true;
    }

    // Returns native height of a texture, or 0 if not loaded
    _texHeight(url: string): number {
      if (!this._hasTexture(url)) return 0;
      const key = urlKey(url);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const src = (this.textures as any).get(key).source[0];
      return src?.height ?? src?.naturalHeight ?? 0;
    }
    _texWidth(url: string): number {
      if (!this._hasTexture(url)) return 0;
      const key = urlKey(url);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const src = (this.textures as any).get(key).source[0];
      return src?.width ?? src?.naturalWidth ?? 0;
    }

    // ── Camera ───────────────────────────────────────────────────────────────

    _updateCamera(state: PhaserState) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { width: vw, height: vh } = (this.scale as any);
      const cam = this.cameras.main;

      // Match React's fill-to-viewport behavior (see getSceneWorldMetrics)
      const isMobileHeight = vw <= 760;
      const fillZoom = isMobileHeight
        ? vh / WORLD_H
        : Math.max(vw / WORLD_W, vh / WORLD_H, 1);

      const effectiveZoom = state.zoom * fillZoom;
      cam.setZoom(effectiveZoom);
      cam.setScroll(
        WORLD_W / 2 - vw / (2 * effectiveZoom) - state.scenePan.x / effectiveZoom,
        WORLD_H / 2 - vh / (2 * effectiveZoom) - state.scenePan.y / effectiveZoom
      );
    }

    // ── Background ───────────────────────────────────────────────────────────

    _updateBackground(state: PhaserState, delta: number) {
      const { backgroundFrames, backgroundFrameMs } = state;
      if (backgroundFrames.length === 0) return;

      if (backgroundFrames.length > 1) {
        this.bgAnimTimer += delta;
        if (this.bgAnimTimer >= backgroundFrameMs) {
          this.bgAnimTimer = 0;
          this.bgFrameIdx = (this.bgFrameIdx + 1) % backgroundFrames.length;
        }
      } else {
        this.bgFrameIdx = 0;
        this.bgAnimTimer = 0;
      }

      const url = backgroundFrames[this.bgFrameIdx] ?? backgroundFrames[0];
      if (!url || url === this.prevBgUrl) return;
      if (!this._setTexture(this.bgSprite, url)) return;
      this.prevBgUrl = url;

      const h = this._texHeight(url);
      const w = this._texWidth(url);
      if (h > 0 && w > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.bgSprite as any).setScale(WORLD_W / w, WORLD_H / h);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.bgSprite as any).setVisible(true);
    }

    // ── Pets ─────────────────────────────────────────────────────────────────

    _updatePets(state: PhaserState, delta: number) {
      const {
        petsInRoom, petZoomMode, isStroking, strokeFrameIndex,
        petFramesByVariantState, petFrameMsByVariantState,
      } = state;

      const activeIds = new Set(petsInRoom.map((p) => p.id));

      // Destroy sprites for pets that left the room
      this.petSprites.forEach((sprite, id) => {
        if (!activeIds.has(id)) {
          sprite.destroy();
          this.petSprites.delete(id);
          this.petAnimTimers.delete(id);
        }
      });

      petsInRoom.forEach((pet) => {
        const variantStates = petFramesByVariantState[pet.assetKey]
          ?? petFramesByVariantState[Object.keys(petFramesByVariantState)[0]]
          ?? {};
        const frames = variantStates[pet.state] ?? variantStates["sitzen"] ?? [];
        const frameMs = petFrameMsByVariantState[pet.assetKey]?.[pet.state] ?? 240;

        // Decide which frame to display
        const isStrokeTarget = petZoomMode === "close" && pet.id === state.selectedPetId;
        let frameIdx: number;

        if (isStrokeTarget) {
          const si = Math.min(strokeFrameIndex[pet.assetKey] ?? 0, frames.length - 1);
          frameIdx = isStroking ? si : 0;
        } else {
          let timer = this.petAnimTimers.get(pet.id);
          if (!timer) { timer = { elapsed: 0, idx: 0 }; this.petAnimTimers.set(pet.id, timer); }
          timer.elapsed += delta;
          if (timer.elapsed >= frameMs && frames.length > 1) {
            timer.elapsed = 0;
            timer.idx = (timer.idx + 1) % frames.length;
          }
          frameIdx = Math.min(timer.idx, Math.max(0, frames.length - 1));
        }

        const frameUrl = frames[frameIdx] ?? frames[0];

        // Create sprite if missing
        let sprite = this.petSprites.get(pet.id);
        if (!sprite) {
          const initKey = frameUrl && this._hasTexture(frameUrl) ? urlKey(frameUrl) : "__DEFAULT";
          sprite = this.add.image(0, 0, initKey);
          sprite.setOrigin(0.5, 1.0).setDepth(7);
          this.petSprites.set(pet.id, sprite);
        }

        // Texture
        if (frameUrl) this._setTexture(sprite, frameUrl);

        // Position (bottom-center anchor in world space)
        sprite.setPosition(
          (pet.position.x / 100) * WORLD_W,
          (pet.position.y / 100) * WORLD_H
        );

        // Flip for facing direction
        sprite.setFlipX(pet.facing < 0);

        // Origin: sleeping = center, otherwise bottom
        sprite.setOrigin(0.5, pet.state === "sleep" ? 0.5 : 1.0);

        // Scale: target world height = WORLD_H * 0.26 (matches CSS clamp(180px,26vw,340px) at fill zoom)
        const targetH = WORLD_H * 0.26;
        if (frameUrl) {
          const nh = this._texHeight(frameUrl);
          if (nh > 0) sprite.setScale(targetH / nh);
        }

        // Alpha: non-selected pets are slightly dimmed
        sprite.setAlpha(pet.isSelected ? 1 : 0.85);
      });
    }

    // ── Walk target marker ───────────────────────────────────────────────────

    _updateMarker(state: PhaserState) {
      const url = "/assets/backgrounds/UI/position.png";
      const s = this.markerSprite as { setVisible: (b: boolean) => void; setPosition: (x: number, y: number) => void; setScale: (n: number) => void };
      if (!state.walkTargetMarker) { s.setVisible(false); return; }
      s.setPosition(
        (state.walkTargetMarker.x / 100) * WORLD_W,
        (state.walkTargetMarker.y / 100) * WORLD_H
      );
      this._setTexture(this.markerSprite, url);
      const nh = this._texHeight(url);
      if (nh > 0) s.setScale((WORLD_H * 0.075) / nh);
      s.setVisible(true);
    }

    // ── Ball ─────────────────────────────────────────────────────────────────

    _updateBall(state: PhaserState) {
      const s = this.ballSprite as { setVisible: (b: boolean) => void; setPosition: (x: number, y: number) => void; setRotation: (r: number) => void; setScale: (n: number) => void };
      s.setVisible(state.ballVisible);
      if (!state.ballVisible) return;
      s.setPosition(
        (state.ballPosition.x / 100) * WORLD_W,
        (state.ballPosition.y / 100) * WORLD_H
      );
      s.setRotation((state.ballRotation * Math.PI) / 180);
      if (this._setTexture(this.ballSprite, state.ballImageSrc)) {
        const nh = this._texHeight(state.ballImageSrc);
        if (nh > 0) s.setScale((WORLD_H * 0.085) / nh);
      }
    }

    // ── Food ─────────────────────────────────────────────────────────────────

    _updateFood(state: PhaserState) {
      const s = this.foodSprite as { setVisible: (b: boolean) => void; setPosition: (x: number, y: number) => void; setScale: (n: number) => void };
      s.setVisible(state.foodVisible);
      if (!state.foodVisible) return;
      s.setPosition(
        (state.foodPosition.x / 100) * WORLD_W,
        (state.foodPosition.y / 100) * WORLD_H
      );
      if (this._setTexture(this.foodSprite, state.foodImageSrc)) {
        const nh = this._texHeight(state.foodImageSrc);
        if (nh > 0) s.setScale((WORLD_H * 0.14) / nh);
      }
    }

    // ── Bed ──────────────────────────────────────────────────────────────────

    _updateBed(state: PhaserState) {
      const s = this.bedSprite as { setVisible: (b: boolean) => void; setPosition: (x: number, y: number) => void; setScale: (n: number) => void };
      s.setVisible(state.bedVisible);
      if (!state.bedVisible) return;
      s.setPosition(
        (state.bedPosition.x / 100) * WORLD_W,
        (state.bedPosition.y / 100) * WORLD_H
      );
      if (this._setTexture(this.bedSprite, state.bedImageSrc)) {
        const nw = this._texWidth(state.bedImageSrc);
        if (nw > 0) s.setScale((WORLD_W * 0.22) / nw);
      }
    }

    // ── Note draft ───────────────────────────────────────────────────────────

    _updateNoteDraft(state: PhaserState) {
      const url = state.noteDraftTemplate === "note2"
        ? "/assets/items/notiz2.png"
        : "/assets/items/notiz1.png";
      const s = this.noteDraftSprite as { setVisible: (b: boolean) => void; setPosition: (x: number, y: number) => void; setScale: (n: number) => void };
      s.setVisible(state.noteDraftVisible);
      if (!state.noteDraftVisible) return;
      s.setPosition(
        (state.noteDraftPosition.x / 100) * WORLD_W,
        (state.noteDraftPosition.y / 100) * WORLD_H
      );
      if (this._setTexture(this.noteDraftSprite, url)) {
        const nh = this._texHeight(url);
        if (nh > 0) s.setScale((WORLD_H * 0.17) / nh);
      }
    }

    // ── Poops ────────────────────────────────────────────────────────────────

    _updatePoops(state: PhaserState) {
      const url = "/assets/backgrounds/UI/poop.png";
      const activeIds = new Set(state.poops.map((p) => p.id));
      this.poopSprites.forEach((sprite, id) => {
        if (!activeIds.has(id)) { sprite.destroy(); this.poopSprites.delete(id); }
      });
      state.poops.forEach((poop) => {
        let sprite = this.poopSprites.get(poop.id);
        if (!sprite) {
          sprite = this.add.image(0, 0, this._hasTexture(url) ? urlKey(url) : "__DEFAULT");
          sprite.setOrigin(0.5, 1.0).setDepth(5);
          this.poopSprites.set(poop.id, sprite);
        }
        sprite.setPosition((poop.position.x / 100) * WORLD_W, (poop.position.y / 100) * WORLD_H);
        if (this._setTexture(sprite, url)) {
          const nh = this._texHeight(url);
          if (nh > 0) sprite.setScale((WORLD_H * 0.08) / nh);
        }
      });
    }

    // ── Notes ────────────────────────────────────────────────────────────────

    _updateNotes(state: PhaserState) {
      const activeIds = new Set(state.notes.map((n) => n.id));
      this.noteSprites.forEach((sprite, id) => {
        if (!activeIds.has(id)) { sprite.destroy(); this.noteSprites.delete(id); }
      });
      state.notes.forEach((note) => {
        const url = note.template === "note2" ? "/assets/items/notiz2.png" : "/assets/items/notiz1.png";
        let sprite = this.noteSprites.get(note.id);
        if (!sprite) {
          sprite = this.add.image(0, 0, this._hasTexture(url) ? urlKey(url) : "__DEFAULT");
          sprite.setOrigin(0.5, 0.5).setDepth(6);
          this.noteSprites.set(note.id, sprite);
        }
        sprite.setPosition((note.position.x / 100) * WORLD_W, (note.position.y / 100) * WORLD_H);
        if (this._setTexture(sprite, url)) {
          const nh = this._texHeight(url);
          if (nh > 0) sprite.setScale((WORLD_H * 0.15) / nh);
        }
      });
    }

    // ── Sleep overlay ────────────────────────────────────────────────────────

    _updateSleepOverlay(state: PhaserState) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.sleepRect as any).setVisible(state.sleepActive);
    }
  };
}
