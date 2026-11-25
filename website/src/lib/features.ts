// The official page's "Everything in one overlay" grid, word for word, with a
// link wherever the Wardrobe has something to show for that feature. Incarnations,
// spell visuals and procs have none: the overlay keeps them out of look codes.

export interface Feature {
  title: string;
  body: string;
  href?: string;
  /** The link shows published looks, so it waits until there can be some. */
  needsPosts?: boolean;
}

const category = (name: string) => `/community-gallery?category=${encodeURIComponent(name)}`;
const tag = (name: string) => `/community-gallery?tag=${encodeURIComponent(name)}`;

export const FEATURES: Feature[] = [
  { title: "Wardrobe", body: "Every item appearance and set in the game, previewed on your character before you wear it.", href: category("Armor") },
  { title: "Customization", body: "Race, sex, skin, hair and face, with custom colours for skin, hair and eyes.", href: category("Race morph"), needsPosts: true },
  { title: "Mounts", body: "Every mount, shown at full size. Browse the list or let the randomizer choose.", href: category("Mounted"), needsPosts: true },
  { title: "Creature morph", body: "Take the form of any creature the client can render.", href: category("Creature morph"), needsPosts: true },
  { title: "Enchants", body: "Any enchant effect on either weapon, and a colour of your choice for each weapon slot.", href: tag("enchant"), needsPosts: true },
  { title: "Incarnations", body: "Druid forms, warlock demons, hunter pets, ammunition and hearthstones." },
  { title: "Spell visuals", body: "Give any of your spells or auras the visuals of another, and recolour them." },
  { title: "Procs", body: "Change how an aura looks, or how a spell looks while an aura is active." },
  { title: "Optimize", body: "Hide other players’ spell effects in raids for a higher frame rate. Boss mechanics are always shown." },
  { title: "Titles", body: "Any title on your name, or text of your own, in the colours you choose." },
  { title: "Effects", body: "3D models such as wings and capes, attached to your character and animated.", href: category("Cosmetics"), needsPosts: true },
  { title: "Colour", body: "Recolour units and the world around you, and outline units by type." },
  { title: "World", body: "Time of day, weather, sky, fog, draw distance and field of view." },
  { title: "Font", body: "Sharp text at any resolution, and restyled floating combat text." },
  { title: "Loadouts", body: "Save complete looks, share them as a code, and assign one to each specialization.", href: "/loadouts" },
  { title: "Multiplayer", body: "Other Eclipse users see your look, and you see theirs. You choose what is shared." },
];
