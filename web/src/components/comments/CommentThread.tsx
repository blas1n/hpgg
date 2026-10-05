"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/client";
import { deleteComment, fetchComments, postComment, readNickname, rememberNickname, reportComment, type CommentItem, type ListResult } from "@/lib/comments";
import { Card, CardHeader, cx } from "../ui";

/** "10/05 12:03", Korean time (the site's clock, like 갱신 dates). */
const when = (iso: string) => {
  const d = new Date(Date.parse(iso) + 9 * 3600_000).toISOString();
  return `${d.slice(5, 7)}/${d.slice(8, 10)} ${d.slice(11, 16)}`;
};

/** Comments of one thread ("weekly:2026-w40", "hero:valla"): loaded when the section comes into view, so a page
 *  view asks the API nothing until someone scrolls down. Anonymous: nickname + a password to delete with. */
export function CommentThread({ thread, sub }: { thread: string; sub: string }) {
  const t = useT().comments;
  const box = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  const [list, setList] = useState<ListResult | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el || seen) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setSeen(true), { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  useEffect(() => {
    if (seen) void fetchComments(thread).then(setList);
  }, [seen, thread]);

  const comments = list?.kind === "ok" ? list.comments : [];
  const add = (c: CommentItem) => setList((l) => (l?.kind === "ok" ? { ...l, count: l.count + 1, comments: [...l.comments, c] } : { kind: "ok", count: 1, comments: [c] }));
  const remove = (id: number) => setList((l) => (l?.kind === "ok" ? { ...l, count: l.count - 1, comments: l.comments.filter((c) => c.id !== id) } : l));

  return (
    <div ref={box}>
      <Card aria-labelledby="comments-title">
        <CardHeader id="comments-title" title={t.title(list?.kind === "ok" ? String(list.count) : "")} sub={sub} />
        <div id="comments" data-thread={thread} className="divide-y divide-line">
          {!list ? (
            <p className="px-4 py-4 text-[13px] text-muted">{t.loading}</p>
          ) : list.kind === "ok" ? (
            comments.length ? (
              comments.map((c) => <Comment key={c.id} c={c} onDeleted={() => remove(c.id)} />)
            ) : (
              <p id="comments-empty" className="px-4 py-4 text-[13px] text-muted">
                {t.empty}
              </p>
            )
          ) : (
            <p className="px-4 py-4 text-[13px] text-muted">{list.kind === "offline" ? t.offline : t.error}</p>
          )}
        </div>
        <CommentForm thread={thread} onPosted={add} />
      </Card>
    </div>
  );
}

function Comment({ c, onDeleted }: { c: CommentItem; onDeleted: () => void }) {
  const t = useT().comments;
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState("");
  const [note, setNote] = useState("");
  const [reported, setReported] = useState(false);
  const del = async () => {
    const r = await deleteComment(c.id, password);
    if (r.kind === "ok" || r.kind === "not_found") onDeleted();
    else setNote(r.kind === "wrong_password" ? t.wrongPassword : r.kind === "rate_limited" ? t.rate : t.failed);
  };
  const report = async () => {
    const r = await reportComment(c.id);
    if (r.kind === "ok" || r.kind === "not_found") setReported(true);
    else setNote(r.kind === "rate_limited" ? t.rate : t.failed);
  };
  return (
    <article data-comment={c.id} className="px-4 py-2.5">
      <header className="flex flex-wrap items-baseline gap-x-2 text-xs">
        <span className="font-semibold text-fg">{c.nickname}</span>
        <span className="num text-2xs text-muted">({c.tag})</span>
        <time dateTime={c.created_at} className="num text-2xs text-muted">
          {when(c.created_at)}
        </time>
        <span className="ml-auto flex gap-2 text-2xs">
          <button type="button" data-action="delete" onClick={() => setDeleting((v) => !v)} className="text-muted hover:text-fg">
            {t.delete}
          </button>
          <button type="button" data-action="report" disabled={reported} onClick={report} className={cx("text-muted", reported ? "cursor-default" : "hover:text-neg")}>
            {reported ? t.reported : t.report}
          </button>
        </span>
      </header>
      <p className="mt-1 whitespace-pre-line break-words text-[13px] leading-relaxed text-fg-2">{c.body}</p>
      {deleting && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <input
            type="password"
            aria-label={t.password}
            placeholder={t.password}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-8 w-36 rounded-md border border-line bg-surface-2 px-2 text-xs text-fg outline-none focus:border-primary"
          />
          <button type="button" data-action="confirm-delete" onClick={del} className="h-8 rounded-md border border-line px-2.5 text-xs font-semibold text-fg hover:border-neg">
            {t.confirmDelete}
          </button>
          <button type="button" onClick={() => setDeleting(false)} className="h-8 px-1 text-xs text-muted hover:text-fg">
            {t.cancel}
          </button>
        </div>
      )}
      {note && (
        <p role="status" className="mt-1 text-2xs text-neg">
          {note}
        </p>
      )}
    </article>
  );
}

function CommentForm({ thread, onPosted }: { thread: string; onPosted: (c: CommentItem) => void }) {
  const t = useT().comments;
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [body, setBody] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  useEffect(() => setNickname(readNickname()), []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNote("");
    const r = await postComment({ thread, nickname, password, body, website });
    setBusy(false);
    if (r.kind === "ok") {
      rememberNickname(nickname);
      setBody("");
      onPosted(r.comment);
      return;
    }
    if (r.kind === "invalid") {
      const f = r.fields;
      setNote(f.includes("nickname") ? t.invalidNickname : f.includes("password") ? t.invalidPassword : f.includes("body") ? t.invalidBody : t.invalidOther);
    } else setNote(r.kind === "rate_limited" ? t.rate : t.failed);
  };

  const field = "h-9 rounded-md border border-line bg-surface-2 px-2.5 text-[13px] text-fg outline-none focus:border-primary";
  return (
    <form id="comment-form" onSubmit={submit} className="space-y-2 border-t border-line px-4 py-3">
      <div className="flex flex-wrap gap-2">
        <input name="nickname" aria-label={t.nickname} placeholder={t.nickname} value={nickname} maxLength={16} onChange={(e) => setNickname(e.target.value)} className={cx(field, "w-36")} required />
        <input name="password" type="password" aria-label={t.password} placeholder={t.password} value={password} maxLength={64} onChange={(e) => setPassword(e.target.value)} className={cx(field, "w-40")} required minLength={4} />
      </div>
      {/* a field people never see or reach: a bot fills it, and the server refuses the comment */}
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" value={website} onChange={(e) => setWebsite(e.target.value)} className="absolute -left-[9999px] h-px w-px opacity-0" />
      <label className="sr-only" htmlFor="comment-body">
        {t.body}
      </label>
      <textarea
        id="comment-body"
        name="body"
        placeholder={t.placeholder}
        value={body}
        maxLength={500}
        rows={3}
        onChange={(e) => setBody(e.target.value)}
        className="w-full resize-y rounded-md border border-line bg-surface-2 px-2.5 py-2 text-[13px] text-fg outline-none focus:border-primary"
        required
      />
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={busy} className="h-9 rounded-lg bg-primary px-4 text-[13px] font-bold text-primary-ink transition-opacity hover:opacity-90 disabled:opacity-60">
          {busy ? t.posting : t.submit}
        </button>
        <span className="num text-2xs text-muted">{body.length}/500</span>
        {note && (
          <span id="comment-note" role="status" className="text-xs text-neg">
            {note}
          </span>
        )}
      </div>
      <p className="text-2xs text-muted">{t.rules}</p>
    </form>
  );
}
