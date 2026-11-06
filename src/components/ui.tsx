import type { ButtonHTMLAttributes, ReactNode } from "react";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export function Card({ children, className, as: Tag = "section", ...rest }: { children: ReactNode; className?: string; as?: "section" | "div" | "article"; "aria-labelledby"?: string }) {
  return (
    <Tag className={cx("min-w-0 rounded-2xl border border-line bg-surface p-4 shadow-[0_1px_2px_rgba(10,31,68,0.06),0_4px_16px_rgba(10,31,68,0.05)] sm:p-5", className)} {...rest}>
      {children}
    </Tag>
  );
}

type Variant = "primary" | "cta" | "secondary" | "ghost" | "danger" | "onNavy";

export function Button({ variant = "secondary", className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const styles: Record<Variant, string> = {
    primary: "bg-accent text-accent-fg shadow-sm hover:bg-accent-strong",
    cta: "bg-gold text-gold-fg font-semibold shadow-sm hover:bg-gold-strong",
    secondary: "border border-line bg-surface text-fg hover:bg-muted",
    ghost: "text-fg-soft hover:bg-muted hover:text-fg",
    danger: "border border-bad/40 bg-surface text-bad hover:bg-bad/10",
    onNavy: "border border-white/25 bg-white/10 text-navy-fg hover:bg-white/20",
  };
  return (
    <button
      type="button"
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
        "disabled:cursor-not-allowed disabled:opacity-50",
        styles[variant],
        className,
      )}
      {...props}
    />
  );
}

type Tone = "info" | "warn" | "bad" | "good" | "neutral" | "gold";

const toneStyles: Record<Tone, string> = {
  info: "border-accent/30 bg-accent/8",
  warn: "border-warn/40 bg-warn/10",
  bad: "border-bad/40 bg-bad/10",
  good: "border-good/40 bg-good/10",
  neutral: "border-line bg-muted",
  gold: "border-gold-strong bg-gold text-gold-fg",
};

const toneIcon: Record<Tone, string> = { info: "ℹ", warn: "⚠", bad: "✕", good: "✓", neutral: "•", gold: "★" };

export function Alert({ tone = "info", title, children, action, role }: { tone?: Tone; title?: string; children?: ReactNode; action?: ReactNode; role?: "alert" | "status" }) {
  return (
    <div role={role} className={cx("flex gap-3 rounded-xl border p-3 text-sm", toneStyles[tone])}>
      <span aria-hidden="true" className="mt-0.5 font-bold">{toneIcon[tone]}</span>
      <div className="min-w-0 flex-1 space-y-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-fg-soft">{children}</div>}
        {action && <div className="pt-1">{action}</div>}
      </div>
    </div>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", toneStyles[tone])}>{children}</span>;
}

export function Spinner({ label }: { label: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-fg-soft">
      <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-line border-t-accent" />
      {label}
    </span>
  );
}

/** Site-wide navy bar with the app mark. */
export function TopBar({ children }: { children?: ReactNode }) {
  return (
    <header className="bg-navy text-navy-fg">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-3 px-4">
        <div className="flex items-center gap-2.5">
          <span aria-hidden="true" className="grid size-8 place-items-center rounded-lg bg-gold text-sm font-black text-gold-fg">
            TA
          </span>
          <span className="text-base font-semibold tracking-tight">
            Fantasy <span className="text-gold">Trade Analyzer</span>
          </span>
        </div>
        {children}
      </div>
    </header>
  );
}

/** Section heading with a short yellow accent bar. */
export function SectionTitle({ id, children, as: Tag = "h2" }: { id?: string; children: ReactNode; as?: "h2" | "h3" }) {
  return (
    <Tag id={id} className="flex items-center gap-2 text-lg font-semibold">
      <span aria-hidden="true" className="h-5 w-1 rounded-full bg-gold" />
      {children}
    </Tag>
  );
}
