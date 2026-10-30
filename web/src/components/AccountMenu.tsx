"use client";

import { useEffect, useRef, useState } from "react";
import { hotsHref } from "@/data";
import { useLocale, useT } from "@/i18n/client";
import { battletagName, chooseRegion, deleteAccount, fetchMe, loginOutcome, loginUrl, logout, withoutLoginParam, type Me } from "@/lib/account";
import { playersHref, REGIONS, type Region } from "@/lib/players";
import { cx } from "./ui";

/** Asked once per browser session: a member who closes the region prompt is not asked again on every page. */
const ASKED_KEY = "hpgg-region-asked";
const askedBefore = (): boolean => {
  try {
    return sessionStorage.getItem(ASKED_KEY) === "1";
  } catch {
    return false;
  }
};
const markAsked = (): void => {
  try {
    sessionStorage.setItem(ASKED_KEY, "1");
  } catch {
    // not remembered: asked again on the next page
  }
};

const CONTROL = "h-9 shrink-0 rounded-lg border border-line text-xs font-bold text-muted transition-colors hover:border-line-strong hover:text-fg";
const ITEM = "flex w-full items-center rounded-md px-2.5 py-2 text-left text-[13px] font-semibold text-fg-2 transition-colors hover:bg-surface-3 hover:text-fg";

type Notice = "failed" | "cancelled" | "deleted" | null;

/**
 * Header account control (#28). The page is static, so who is signed in is asked in the browser (/v1/me with the
 * cookie); until the answer, and whenever it fails, the control is a login link. Signed in: the BattleTag opens a menu
 * (disclosure: a button with aria-expanded) with the region, the member's own 전적, the privacy policy, logout and
 * account deletion. Mounted only when FEATURES.accounts is on — otherwise no request is made at all.
 */
export function AccountMenu() {
  const t = useT();
  const locale = useLocale();
  const [me, setMe] = useState<Me | null | "loading">("loading");
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [here, setHere] = useState("/");
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const outcome = loginOutcome(location.search);
    if (outcome) {
      setNotice(outcome);
      history.replaceState(history.state, "", withoutLoginParam(location.pathname + location.search + location.hash));
    }
    setHere(location.pathname + location.search);
    let live = true;
    fetchMe().then((m) => {
      if (!live) return;
      setMe(m);
      if (m && m.region === null && !askedBefore()) {
        markAsked();
        setPrompt(true);
        setOpen(true);
      }
    });
    return () => {
      live = false;
    };
  }, []);

  // closes on Escape (focus back on the button) and on a click outside
  useEffect(() => {
    if (!open && !notice) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (open) {
        close();
        button.current?.focus();
      } else setNotice(null);
    };
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) {
        setOpen(false);
        setConfirming(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open, notice]);

  function close() {
    setOpen(false);
    setConfirming(false);
    setError(null);
  }

  async function pickRegion(region: Region) {
    if (me === "loading" || !me || busy) return;
    setBusy(true);
    setError(null);
    if (await chooseRegion(region)) {
      setMe({ ...me, region });
      setPrompt(false);
    } else setError(t.account.regionFailed);
    setBusy(false);
  }

  async function signOut(remove: boolean) {
    setBusy(true);
    setError(null);
    if (await (remove ? deleteAccount() : logout())) {
      setMe(null);
      close();
      if (remove) setNotice("deleted");
    } else setError(t.account.failed);
    setBusy(false);
  }

  const noticeText = notice === "failed" ? t.account.loginFailed : notice === "cancelled" ? t.account.loginCancelled : notice === "deleted" ? t.account.deleted : "";

  return (
    <div ref={wrap} className="relative shrink-0">
      {me === "loading" ? (
        // the size of the login link, so the header does not move when the answer comes
        <span aria-hidden className="block h-9 w-14" />
      ) : me === null ? (
        <a id="account-login" href={loginUrl(here)} title={t.account.loginTitle} className={cx(CONTROL, "inline-grid place-items-center whitespace-nowrap px-2.5")}>
          {t.account.login}
        </a>
      ) : (
        <button
          ref={button}
          type="button"
          id="account-button"
          aria-expanded={open}
          aria-controls="account-panel"
          aria-label={t.account.menu(me.battletag)}
          onClick={() => (open ? close() : setOpen(true))}
          className={cx(CONTROL, "flex max-w-[7.5rem] items-center gap-1 px-2 sm:max-w-[10rem]", open && "border-line-strong text-fg")}
        >
          {/* the name only: the header is already full in English at 1280px; the menu shows the whole BattleTag */}
          <span className="truncate">{battletagName(me.battletag)}</span>
          <svg aria-hidden viewBox="0 0 12 12" className={cx("size-3 shrink-0 transition-transform", open && "rotate-180")} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 4.5 6 7.5l3-3" />
          </svg>
        </button>
      )}

      {me && me !== "loading" && (
        <div
          id="account-panel"
          hidden={!open}
          className="fixed inset-x-4 top-[calc(var(--header-h,3.5rem)-0.25rem)] z-50 break-keep rounded-lg border border-line-strong bg-surface-2 p-2 shadow-2xl shadow-black/50 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-1.5 sm:w-72"
        >
          <p className="truncate px-2.5 pb-2 pt-1 text-[13px] font-bold text-fg">{me.battletag}</p>
          <div className="border-t border-line px-2.5 pb-2 pt-2.5">
            {prompt && me.region === null && (
              <div id="account-region-prompt" className="mb-2.5">
                <p className="text-[13px] font-semibold text-fg">{t.account.regionPrompt}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-fg-2">{t.account.regionWhy}</p>
              </div>
            )}
            <p id="account-region-label" className="text-xs font-semibold text-muted">
              {t.account.region}
            </p>
            <div role="group" aria-labelledby="account-region-label" className="mt-1.5 grid grid-cols-3 gap-0.5 rounded-lg border border-line bg-surface p-0.5">
              {REGIONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  data-region={r}
                  aria-pressed={me.region === r}
                  disabled={busy}
                  onClick={() => pickRegion(r)}
                  className={cx(
                    "rounded-md px-2 py-1.5 text-[13px] font-semibold transition-colors disabled:cursor-wait",
                    me.region === r ? "bg-primary text-primary-ink shadow-sm" : "text-muted hover:text-fg",
                  )}
                >
                  {t.players.regions[r]}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-0.5 border-t border-line pt-2">
            <a id="account-players" href={playersHref(locale, me.battletag, me.region ?? undefined)} className={ITEM}>
              {t.account.myProfile}
            </a>
            <a id="account-privacy" href={hotsHref(locale).privacy} className={ITEM}>
              {t.account.privacy}
            </a>
            <button type="button" id="account-logout" disabled={busy} onClick={() => signOut(false)} className={ITEM}>
              {t.account.logout}
            </button>
            {confirming ? (
              <div id="account-delete-confirm" role="group" aria-labelledby="account-delete-text" className="rounded-md border border-line bg-surface p-2.5">
                <p id="account-delete-text" className="text-xs leading-relaxed text-fg-2">
                  {t.account.deleteConfirm}
                </p>
                <div className="mt-2.5 flex justify-end gap-1.5">
                  <button type="button" id="account-delete-no" onClick={() => setConfirming(false)} className="rounded-md border border-line px-3 py-1.5 text-xs font-bold text-fg-2 hover:border-line-strong hover:text-fg">
                    {t.account.deleteNo}
                  </button>
                  <button type="button" id="account-delete-yes" disabled={busy} onClick={() => signOut(true)} className="rounded-md border border-neg px-3 py-1.5 text-xs font-bold text-neg hover:bg-surface-3">
                    {t.account.deleteYes}
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" id="account-delete" onClick={() => setConfirming(true)} className={cx(ITEM, "text-muted")}>
                {t.account.delete}
              </button>
            )}
          </div>
          {error && (
            <p role="alert" className="px-2.5 pb-1 pt-2 text-xs text-neg">
              {error}
            </p>
          )}
        </div>
      )}

      <div
        id="account-notice"
        role="status"
        aria-live="polite"
        className={cx(
          noticeText ? "fixed inset-x-4 top-[calc(var(--header-h,3.5rem)+0.5rem)] z-50 flex items-start gap-2 rounded-lg border border-line-strong bg-surface-2 p-3 shadow-2xl shadow-black/50 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-1.5 sm:w-72" : "sr-only",
        )}
      >
        {noticeText && (
          <>
            <p className="flex-1 break-keep text-[13px] text-fg">{noticeText}</p>
            <button type="button" onClick={() => setNotice(null)} aria-label={t.account.close} className="-m-1 grid size-6 shrink-0 place-items-center rounded text-muted hover:text-fg">
              <svg aria-hidden viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="m3 3 6 6M9 3l-6 6" />
              </svg>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
