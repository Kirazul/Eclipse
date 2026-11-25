import { useTranslations } from "next-intl";
import { HubTitle } from "@/components/hub";

/** A grid of look cards in outline, as the Community Gallery and a creator's page lay them out. */
function LookCardsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-72 rounded-lg border border-line bg-surface" />)}
    </div>
  );
}

/** The Decoder in outline: the box a code goes in and the panel showing what it holds. */
function DecoderSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="h-10 rounded-md bg-surface" />
      <div className="h-40 rounded-md border border-line bg-surface" />
    </div>
  );
}

/** A look's page in outline, while it loads: its title, picture and pieces. */
export function LookSkeleton() {
  const t = useTranslations("loading");
  return (
    <div className="flex animate-pulse flex-col gap-8" role="status" aria-label={t("look")}>
      <div className="flex items-center gap-4">
        <div className="size-[52px] rounded-full bg-surface" />
        <div className="flex flex-col gap-2">
          <div className="h-9 w-72 max-w-full rounded-md bg-surface" />
          <div className="h-4 w-48 rounded-md bg-surface" />
        </div>
      </div>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="aspect-[4/3] rounded-md bg-surface" />
        <div className="flex flex-col gap-3">
          <div className="h-[2.9rem] rounded-full bg-surface" />
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-12 rounded-md bg-surface" />)}
        </div>
      </div>
    </div>
  );
}

/** The Community Gallery's list in outline, while it loads. */
export function WardrobeSkeleton() {
  const t = useTranslations("loading");
  return (
    <main id="main" className="wrap flex animate-pulse flex-col gap-5 py-10" role="status" aria-label={t("gallery")}>
      <div className="h-16 w-2/3 rounded-lg bg-surface" />
      <div className="h-10 w-full rounded-lg bg-surface" />
      <LookCardsSkeleton />
    </main>
  );
}

/** A creator's page in outline: their name, their numbers and their looks. */
export function CreatorSkeleton() {
  const t = useTranslations("loading");
  return (
    <main id="main" className="wrap flex animate-pulse flex-col gap-5 py-10" role="status" aria-label={t("creator")}>
      <div className="flex flex-col gap-2">
        <div className="h-9 w-64 max-w-full rounded-md bg-surface" />
        <div className="h-4 w-56 max-w-full rounded-md bg-surface" />
      </div>
      <LookCardsSkeleton />
    </main>
  );
}

/**
 * Loadouts in outline. The title holds no data, so it is drawn for real and stays
 * put; only the account's games, looks and loadouts pulse while the page asks for them.
 */
export function LoadoutsSkeleton() {
  const t = useTranslations("loading");
  const th = useTranslations("hub");
  return (
    <main id="main" className="wrap flex flex-col gap-8 py-10">
      <HubTitle title={th("loadouts")} blurb={th("loadoutsBlurb")} />
      <div className="flex animate-pulse flex-col gap-8" role="status" aria-label={t("loadouts")}>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <div className="h-6 w-20 rounded-md bg-surface" />
            <div className="h-3 w-96 max-w-full rounded-md bg-surface" />
          </div>
          <DecoderSkeleton />
        </div>
        <div className="flex max-w-xl flex-col gap-3">
          <div className="h-6 w-36 rounded-md bg-surface" />
          <div className="h-12 rounded-md bg-surface" />
          <div className="h-9 w-32 rounded-full bg-surface" />
        </div>
        <div className="flex flex-col gap-3">
          <div className="h-6 w-64 max-w-full rounded-md bg-surface" />
          <div className="h-28 rounded-lg border border-dashed border-line" />
        </div>
        <div className="flex flex-col gap-3">
          <div className="h-6 w-40 rounded-md bg-surface" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => <div key={i} className="h-56 rounded-lg border border-line bg-surface" />)}
          </div>
        </div>
      </div>
    </main>
  );
}

/** A saved loadout's page in outline: the way back, its name and its breakdown. */
export function SetSkeleton() {
  const t = useTranslations("loading");
  return (
    <main id="main" className="wrap flex animate-pulse flex-col gap-6 py-10" role="status" aria-label={t("loadout")}>
      <div className="h-5 w-24 rounded-md bg-surface" />
      <div className="flex flex-col gap-2">
        <div className="h-10 w-72 max-w-full rounded-md bg-surface" />
        <div className="h-4 w-96 max-w-full rounded-md bg-surface" />
      </div>
      <DecoderSkeleton />
    </main>
  );
}
