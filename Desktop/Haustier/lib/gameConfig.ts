import { GENERATED_BACKGROUNDS, GENERATED_PET_FRAMES, GENERATED_PET_VARIANTS } from "@/lib/generatedAssets";

export type PetStateId = "sitzen" | "stehen" | "laufen" | "springen" | "sleep";

type SpriteConfig = {
  id: string;
  label: string;
  frameMs: number;
  frames: readonly string[];
};

type PetStateConfig = SpriteConfig & {
  id: PetStateId;
};

export type PetVariantConfig = {
  id: string;
  label: string;
  states: Record<PetStateId, PetStateConfig>;
};

const petFrames = GENERATED_PET_FRAMES as Record<string, readonly string[]>;
const petVariants = GENERATED_PET_VARIANTS as Record<string, Record<string, readonly string[]>>;
const backgroundFrames = GENERATED_BACKGROUNDS as Record<string, readonly string[]>;
const backgroundLabels: Record<string, string> = {
  bad: "Bathroom",
  kuche: "Kitchen",
  "küche": "Kitchen",
  kueche: "Kitchen",
  schlafzimmer: "Bedroom",
  wohnzimmer: "Living Room",
  wiese: "Meadow"
};

export const BACKGROUNDS: SpriteConfig[] = Object.entries(backgroundFrames)
  .filter(([id, frames]) => id.toLocaleLowerCase("de-DE") !== "ui" && frames.length > 0)
  .map(([id, frames]) => ({
    id,
    label: backgroundLabels[id.toLocaleLowerCase("de-DE")] ?? id,
    frameMs: 420,
    frames
  }))
  .sort((a, b) => a.label.localeCompare(b.label));

function buildPetStates(frames: Record<string, readonly string[]>): Record<PetStateId, PetStateConfig> {
  return {
  sitzen: {
    id: "sitzen",
    label: "Sitting",
    frameMs: 240,
    frames: frames.sitzen ?? []
  },
  stehen: {
    id: "stehen",
    label: "Standing",
    frameMs: 260,
    frames: frames.stehen ?? []
  },
  laufen: {
    id: "laufen",
    label: "Walking",
    frameMs: 180,
    frames: frames.laufen ?? []
  },
  springen: {
    id: "springen",
    label: "Jumping",
    frameMs: 170,
    frames: frames.springen ?? []
  },
  sleep: {
    id: "sleep",
    label: "Sleeping",
    frameMs: 260,
    frames: frames.sleep ?? []
  }
};
}

export const PET_VARIANTS: PetVariantConfig[] = Object.entries(petVariants).map(([id, frames], index) => ({
  id,
  label: `Pet ${index + 1}`,
  states: buildPetStates(frames)
}));

export const PET_STATES: Record<PetStateId, PetStateConfig> = PET_VARIANTS[0]?.states ?? buildPetStates(petFrames);
