"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { SupportLinks } from "@/components/site/support-links";
import { WalletPicker } from "@/components/site/wallets";

const OPEN_EVENT = "eclipse:support";
const SEEN_KEY = "eclipse.support-seen";
const OPEN_DELAY_MS = 1400;

export const openSupportDialog = () => window.dispatchEvent(new Event(OPEN_EVENT));

/**
 * The official page opens this on every load. Here it opens by itself once per
 * browser, and the footer's Donate brings it back for anyone who wants it.
 */
export function SupportDialog() {
  const t = useTranslations("support");
  const ref = useRef<HTMLDialogElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    const dialog = ref.current!;
    const open = () => {
      if (dialog.open) return;
      dialog.classList.remove("is-closing");
      dialog.showModal();
      // Focus the dialog itself: nothing is pre-selected, and Tab still walks in.
      dialog.focus({ preventScroll: true });
    };
    window.addEventListener(OPEN_EVENT, open);
    return () => window.removeEventListener(OPEN_EVENT, open);
  }, []);

  useEffect(() => {
    if (pathname !== "/" || localStorage.getItem(SEEN_KEY)) return;
    const timer = setTimeout(() => {
      localStorage.setItem(SEEN_KEY, "1");
      window.dispatchEvent(new Event(OPEN_EVENT));
    }, OPEN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [pathname]);

  function close() {
    const dialog = ref.current!;
    if (!dialog.open || dialog.classList.contains("is-closing")) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      dialog.close();
      return;
    }
    dialog.classList.add("is-closing");
    dialog.addEventListener("animationend", () => {
      dialog.classList.remove("is-closing");
      dialog.close();
    }, { once: true });
  }

  return (
    <dialog
      ref={ref}
      id="support-modal"
      className="modal"
      aria-labelledby="modal-title"
      tabIndex={-1}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target !== ref.current) return;
        const r = ref.current.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
      }}
    >
      <div className="modal__head">
        <Image src="/assets/img/logo-320.webp" width={56} height={56} alt="" unoptimized />
        <h2 id="modal-title">{t("title")}</h2>
        <p>{t("lead")}</p>
      </div>
      <div className="modal__links"><SupportLinks dialog /></div>
      <div className="modal__crypto"><WalletPicker title={t("orCrypto")} /></div>
      <div className="modal__foot">
        <button type="button" className="btn btn--primary btn--block" onClick={close}>{t("continue")}</button>
      </div>
    </dialog>
  );
}

export function DonateButton() {
  const t = useTranslations("support");
  return (
    <button type="button" className="linklike" onClick={openSupportDialog}>{t("donate")}</button>
  );
}
