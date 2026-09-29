import type { ReactNode } from "react";
import { assetUrl } from "@/data";

export const cx = (...c: (string | false | null | undefined)[]): string => c.filter(Boolean).join(" ");

const TIER_BG: Record<string, string> = {
  S: "bg-tier-s",
  A: "bg-tier-a",
  B: "bg-tier-b",
  C: "bg-tier-c",
  D: "bg-tier-d",
  F: "bg-tier-f",
};

export function TierBadge({ tier, size = "md", className }: { tier: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const dim = size === "sm" ? "size-4 text-[10px]" : size === "lg" ? "size-7 text-sm" : "size-5 text-[11px]";
  return (
    <span
      className={cx("tier-badge inline-grid shrink-0 place-items-center rounded-full font-extrabold leading-none text-tier-ink", dim, TIER_BG[tier] ?? "bg-tier-f", className)}
      aria-label={`${tier} 티어`}
    >
      {tier}
    </span>
  );
}

export const ROLE_RING: Record<string, string> = {
  Tank: "ring-role-tank",
  Bruiser: "ring-role-bruiser",
  Healer: "ring-role-healer",
  Support: "ring-role-support",
  "Melee Assassin": "ring-role-melee",
  "Ranged Assassin": "ring-role-ranged",
};

/** Square hero portrait with an optional tier badge on the top-left corner. */
export function Portrait({ src, size = 40, tier, role, className }: { src?: string; size?: number; tier?: string; role?: string; className?: string }) {
  return (
    <span className={cx("relative inline-block shrink-0", className)} style={{ width: size, height: size }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={assetUrl(src)}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          className={cx("size-full rounded-lg bg-surface-3 object-cover", role && "ring-2 ring-offset-0", role && ROLE_RING[role])}
        />
      ) : (
        <span className="block size-full rounded-lg bg-surface-3" />
      )}
      {tier && <TierBadge tier={tier} size={size >= 56 ? "md" : "sm"} className="absolute -left-1.5 -top-1.5 ring-2 ring-surface" />}
    </span>
  );
}

/** ▲3 / ▼2 / —. `value` = previous rank − current rank. */
export function RankDelta({ value, className }: { value: number | null; className?: string }) {
  if (value === null) return <span className={cx("text-2xs text-muted", className)}>–</span>;
  if (value === 0) return <span className={cx("num text-2xs text-muted", className)}>—</span>;
  const up = value > 0;
  return (
    <span className={cx("num inline-flex items-center gap-0.5 text-2xs font-bold", up ? "text-pos" : "text-neg", className)}>
      <span aria-hidden>{up ? "▲" : "▼"}</span>
      <span className="sr-only">{up ? "상승" : "하락"}</span>
      {Math.abs(value)}
    </span>
  );
}

export function Card({ children, className, as: Tag = "section", ...rest }: { children: ReactNode; className?: string; as?: "section" | "div"; id?: string; "aria-labelledby"?: string }) {
  return (
    <Tag className={cx("rounded-card border border-line bg-surface", className)} {...rest}>
      {children}
    </Tag>
  );
}

export function CardHeader({ title, sub, action, id }: { title: ReactNode; sub?: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <header className="flex items-center gap-3 border-b border-line px-4 py-3">
      <div className="min-w-0">
        <h2 id={id} className="text-[15px] font-bold leading-tight text-fg">
          {title}
        </h2>
        {sub && <p className="mt-0.5 truncate text-xs text-muted">{sub}</p>}
      </div>
      {action && <div className="ml-auto shrink-0">{action}</div>}
    </header>
  );
}

export function MoreLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="inline-flex items-center gap-1 text-xs font-semibold text-muted transition-colors hover:text-primary">
      {children}
      <svg aria-hidden viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M6 3l5 5-5 5" />
      </svg>
    </a>
  );
}

/** Two-option segmented control; `idPrefix` gives the buttons stable ids (`mode-qm`, `mode-sl`). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  idPrefix,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
  idPrefix?: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          id={idPrefix ? `${idPrefix}-${o.value}` : undefined}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "rounded-md px-3 py-1.5 text-[13px] font-semibold transition-colors",
            value === o.value ? "bg-primary text-primary-ink shadow-sm" : "text-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
