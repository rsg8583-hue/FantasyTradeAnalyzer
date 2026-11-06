"use client";

import { useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/client/api";
import { absoluteTime } from "@/lib/client/format";
import type { AccountResponse } from "@/lib/domain/apiTypes";
import { Alert, Badge, Button, cx } from "./ui";

const inputClass =
  "w-full rounded-xl border border-line px-3 py-2 text-sm focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";

/** Sign in / create account. Calls onSignedIn after the auth cookie is set. */
export function AuthForm({ onSignedIn, idPrefix = "auth" }: { onSignedIn: (username: string) => void | Promise<void>; idPrefix?: string }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await (mode === "login" ? api.login : api.signup)({ username, password });
      setPassword("");
      await onSignedIn(res.user.username);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3" noValidate>
      <div role="tablist" aria-label="Account" className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
        {(["login", "signup"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => {
              setMode(m);
              setError(null);
            }}
            className={cx(
              "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-accent",
              mode === m ? "bg-navy text-navy-fg shadow-sm" : "text-fg-soft hover:text-fg",
            )}
          >
            {m === "login" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>
      <div>
        <label htmlFor={`${idPrefix}-username`} className="mb-1 block text-sm font-medium">Username</label>
        <input
          id={`${idPrefix}-username`}
          className={inputClass}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={32}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-password`} className="mb-1 block text-sm font-medium">Password</label>
        <input
          id={`${idPrefix}-password`}
          type="password"
          className={inputClass}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          maxLength={200}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-describedby={mode === "signup" ? `${idPrefix}-password-hint` : undefined}
        />
        {mode === "signup" && <p id={`${idPrefix}-password-hint`} className="mt-1 text-xs text-fg-soft">At least 8 characters.</p>}
      </div>
      {error && <Alert tone="bad" role="alert">{error}</Alert>}
      <Button type="submit" variant="primary" className="w-full" disabled={busy || !username.trim() || !password}>
        {busy ? "Working…" : mode === "login" ? "Sign in" : "Create account"}
      </Button>
    </form>
  );
}

/** The signed-in user's saved leagues, with open and delete. */
export function SavedLeagues({
  account,
  onOpen,
  onChange,
  disabled,
}: {
  account: AccountResponse;
  onOpen: (id: number) => void;
  onChange: (next: AccountResponse) => void;
  disabled: boolean;
}) {
  const [error, setError] = useState<string | null>(null);

  async function remove(id: number, name: string) {
    if (!window.confirm(`Delete "${name}"? This can't be undone.`)) return;
    setError(null);
    try {
      onChange(await api.deleteLeague(id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not delete the league.");
    }
  }

  if (account.leagues.length === 0) {
    return <p className="text-sm text-fg-soft">No saved leagues yet. Leagues you create are saved here automatically.</p>;
  }
  return (
    <div className="space-y-2">
      <ul className="divide-y divide-line/60">
        {account.leagues.map((l) => (
          <li key={l.id} className="flex items-center gap-2 py-2 text-sm">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{l.name}</span>
              <span className="block text-xs text-fg-soft">
                {l.sport === "football" ? "Football" : "Basketball"} · {l.season} · {l.teamCount} {l.teamCount === 1 ? "team" : "teams"} · {absoluteTime(l.updatedAt)}
              </span>
            </span>
            {l.active && <Badge tone="info">Open</Badge>}
            <Button variant="primary" className="px-3 py-1" disabled={disabled} onClick={() => onOpen(l.id)} aria-label={`Open ${l.name}`}>Open</Button>
            <Button variant="ghost" className="px-2 py-1" disabled={disabled} onClick={() => void remove(l.id, l.name)} aria-label={`Delete ${l.name}`}>Delete</Button>
          </li>
        ))}
      </ul>
      {error && <Alert tone="bad" role="alert">{error}</Alert>}
    </div>
  );
}

/** Username and sign-out button for the navy top bar. */
export function AccountChip({ username, onLogout }: { username: string; onLogout: () => void }) {
  return (
    <span className="flex shrink-0 items-center gap-2 text-sm">
      <span className="hidden text-navy-soft sm:inline">Signed in as</span>
      <span className="max-w-32 truncate font-semibold">{username}</span>
      <Button variant="onNavy" className="px-3 py-1" onClick={onLogout}>Sign out</Button>
    </span>
  );
}
