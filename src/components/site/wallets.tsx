"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Icon, type IconId } from "@/components/site/icons";
import wallets from "@/data/wallets.json";
import { copyText } from "@/lib/clipboard";

type Wallet = (typeof wallets)[number];

const CONFIRM_MS = 1800;

function CopyAddress({ wallet }: { wallet: Wallet }) {
  const t = useTranslations("support");
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <button
      type="button"
      className={`copy ${done ? "is-done" : ""}`}
      onClick={async () => {
        if (!(await copyText(wallet.address))) {
          toast.error(t("selectToCopy"));
          return;
        }
        setDone(true);
        toast.success(t("copied", { ticker: wallet.ticker }));
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setDone(false), CONFIRM_MS);
      }}
    >
      <Icon id={done ? "i-check" : "i-copy"} />
      <span>{done ? t("copiedShort") : t("copy")}</span>
    </button>
  );
}

/** Addresses are one long word: a break at the midpoint wraps them evenly. */
function Address({ value }: { value: string }) {
  const middle = Math.ceil(value.length / 2);
  return <>{value.slice(0, middle)}<wbr />{value.slice(middle)}</>;
}

function Qr({ wallet }: { wallet: Wallet }) {
  const t = useTranslations("support");
  return <Image src={`/assets/img/qr-${wallet.id}.svg`} alt={t("qr", { coin: wallet.coin })} width={320} height={320} unoptimized loading="lazy" />;
}

/** One wallet at a time: the dialog always, the page on phones. */
export function WalletPicker({ title }: { title: string }) {
  const t = useTranslations("support");
  const [selected, setSelected] = useState(0);
  const tabs = useRef<HTMLDivElement>(null);
  const wallet = wallets[selected];

  return (
    <>
      <p className="wpick__title">{title}</p>
      <div ref={tabs} className="wtabs" role="tablist">
        {wallets.map((w, i) => (
          <button
            key={w.id}
            type="button"
            role="tab"
            className="wtab"
            aria-selected={i === selected}
            tabIndex={i === selected ? 0 : -1}
            onClick={() => setSelected(i)}
            onKeyDown={(e) => {
              const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
              if (!step) return;
              e.preventDefault();
              const next = (i + step + wallets.length) % wallets.length;
              setSelected(next);
              (tabs.current?.children[next] as HTMLElement | undefined)?.focus();
            }}
          >
            <Icon id={`c-${w.id}` as IconId} />
            <span>{w.ticker}</span>
          </button>
        ))}
      </div>
      <div className="wpanel" role="tabpanel">
        <div className="wallet__qr"><Qr wallet={wallet} /></div>
        <div className="wpanel__side">
          <p className="wpanel__net">{t.rich("network", { coin: wallet.coin, network: wallet.network, strong: (c) => <strong>{c}</strong> })}</p>
          <code className="wallet__addr"><Address value={wallet.address} /></code>
          <CopyAddress wallet={wallet} />
        </div>
      </div>
    </>
  );
}

export function WalletSection() {
  const t = useTranslations("support");
  return (
    <div>
      <div className="wallets__cards">
        {wallets.map((w) => (
          <article key={w.id} className="wcard">
            <div className="wcard__head">
              <Icon id={`c-${w.id}` as IconId} className="wcard__coin" />
              <span className="wcard__name">
                <strong>{w.coin}</strong>
                <span>{w.ticker} &middot; {w.network}</span>
              </span>
            </div>
            <div className="wcard__qr"><Qr wallet={w} /></div>
            <code className="wcard__addr"><Address value={w.address} /></code>
            <CopyAddress wallet={w} />
          </article>
        ))}
      </div>
      <div className="wallets__pick panel">
        <WalletPicker title={t("sendCrypto")} />
      </div>
    </div>
  );
}
