import { useTranslations } from "next-intl";
import { term } from "@/i18n/terms";
import { HoverLink } from "@/components/hover-link";
import { ItemRing } from "@/components/item-icon";
import type { ResolvedOutfit } from "@/lib/catalog";
import { SLOT_NAMES, VISIBLE_SLOTS } from "@/lib/domain";
import { qualityColour } from "@/lib/wow-assets";

const ORDER = VISIBLE_SLOTS as readonly number[];

/**
 * What a look wears, and only that, in the order a person reads a character (head to
 * feet, then weapons). A slot the code leaves to the wearer is simply not listed.
 */
export function LookPieces({ resolved }: { resolved: ResolvedOutfit }) {
  const t = useTranslations("pieces");
  const tw = useTranslations();
  const worn = resolved.slots
    .filter((s) => ORDER.includes(s.slot))
    .sort((a, b) => ORDER.indexOf(a.slot) - ORDER.indexOf(b.slot));
  if (!worn.length) return null;

  return (
    <section aria-labelledby="pieces-heading" className="flex flex-col gap-2">
      <h2 id="pieces-heading" className="flex items-baseline gap-2 font-sans text-sm font-medium text-ink">
        {t("title")} <span className="nums text-xs font-normal text-ink-faint">{worn.length}</span>
      </h2>
      {/* Two columns under the picture, where a single one would run long. */}
      <ul className="grid sm:grid-cols-2 sm:gap-x-6">
        {worn.map((s) => {
          const hidden = s.item === 0;
          const name = hidden ? t("hidden") : (s.name ?? t("item", { id: s.item }));
          return (
            <li key={s.slot} className="flex items-center gap-3 border-b border-line py-1.5">
              <ItemRing icon={s.icon} slot={s.slot} quality={s.quality} size={40} hidden={hidden} />
              <div className="min-w-0 flex-1">
                {hidden ? (
                  <p className="truncate text-sm font-medium text-ink-dim">{name}</p>
                ) : (
                  <HoverLink
                    href={`/community-gallery?item=${s.item}`}
                    className="block truncate text-sm font-medium underline-offset-2 hover:underline"
                    style={{ color: qualityColour(s.quality) }}
                    title={t("everyLook", { name })}
                  >
                    {name}
                  </HoverLink>
                )}
                <p className="text-xs text-ink-faint">{term(tw, "slot", SLOT_NAMES[s.slot])}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
