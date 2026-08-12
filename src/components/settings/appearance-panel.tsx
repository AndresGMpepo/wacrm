"use client";

import { useEffect, useRef, useState } from "react";
import { Building2, Check, ImageUp, Loader2, Moon, Palette, Save, SunMoon, Sun, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { MODES, THEMES, type Mode, type ThemeId } from "@/lib/themes";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useTranslations } from "next-intl";
import { SettingsPanelHead } from "./settings-panel-head";

/**
 * Appearance panel — light/dark mode + accent-color picker.
 *
 * Two independent controls: a mode toggle (light / dark) and the
 * accent grid. Either applies + persists immediately. No save button:
 * each change is a single attribute swap on <html>, there's nothing
 * to roll back.
 *
 * Persistence: localStorage only (device-scoped). The boot script in
 * layout.tsx replays both choices before first paint on subsequent
 * loads.
 */
export function AppearancePanel() {
  const { theme, setTheme, mode, setMode } = useTheme();
  const t = useTranslations("Settings.appearance");

  return (
    <section className="max-w-3xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title={t("title")}
        description={t("description")}
      />

      <div className="space-y-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <SunMoon className="size-4 text-muted-foreground" />
          {t("mode")}
        </h3>

        <div
          role="radiogroup"
          aria-label="Color mode"
          className="grid max-w-md grid-cols-2 gap-3"
        >
          {MODES.map((m) => (
            <ModeCard
              key={m}
              mode={m}
              isActive={m === mode}
              onPick={() => setMode(m)}
            />
          ))}
        </div>
      </div>

      <div className="mt-8 space-y-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Palette className="size-4 text-muted-foreground" />
          {t("accentColor")}
        </h3>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {THEMES.map((tObj) => (
            <ThemeCard
              key={tObj.id}
              id={tObj.id}
              name={tObj.name}
              tagline={tObj.tagline}
              swatch={tObj.swatch}
              isActive={tObj.id === theme}
              onPick={() => setTheme(tObj.id)}
            />
          ))}
        </div>
      </div>

      <AccountBranding />
    </section>
  );
}

function AccountBranding() {
  const { account, profile, refreshProfile } = useAuth();
  const canManage = profile?.account_role === "owner" || profile?.account_role === "admin";
  const [name, setName] = useState(account?.name ?? "");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const logoUrl = removeLogo ? null : (previewUrl ?? account?.logo_url);

  useEffect(() => {
    const timer = window.setTimeout(() => setName(account?.name ?? ""), 0);
    return () => window.clearTimeout(timer);
  }, [account?.name]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const selectLogo = (file: File | null) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
      toast.error('Usa una imagen PNG, JPG, WebP o GIF.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('El logo debe pesar 2 MB o menos.');
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
    setLogoFile(file);
    setRemoveLogo(false);
  };

  const saveBranding = async () => {
    if (!account || !canManage) return;
    const nextName = name.trim();
    if (!nextName) {
      toast.error('El nombre de la cuenta es obligatorio.');
      return;
    }
    setSaving(true);
    try {
      const supabase = createClient();
      let nextLogoUrl: string | null = account.logo_url;
      const path = `account-${account.id}/brand-logo`;
      if (logoFile) {
        const { error: uploadError } = await supabase.storage.from('account-branding').upload(path, logoFile, {
          upsert: true,
          cacheControl: '3600',
          contentType: logoFile.type,
        });
        if (uploadError) throw uploadError;
        const { data } = supabase.storage.from('account-branding').getPublicUrl(path);
        nextLogoUrl = `${data.publicUrl}?v=${Date.now()}`;
      } else if (removeLogo) {
        nextLogoUrl = null;
      }
      const { error } = await supabase.from('accounts').update({ name: nextName, logo_url: nextLogoUrl }).eq('id', account.id);
      if (error) throw error;
      setLogoFile(null);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      setRemoveLogo(false);
      await refreshProfile();
      toast.success('Identidad visual guardada para esta cuenta.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar la identidad visual.');
    } finally {
      setSaving(false);
    }
  };

  return <div className="mt-8 rounded-xl border border-border bg-card p-5">
    <div className="flex items-start gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Building2 className="size-4" /></span>
      <div><h3 className="text-sm font-semibold text-foreground">Identidad de la cuenta</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">El nombre y logo se muestran a todos los miembros de esta cuenta, sin afectar otras cuentas de NexoOmni.</p></div>
    </div>
    <div className="mt-5 grid gap-5 sm:grid-cols-[112px_minmax(0,1fr)]">
      <div className="flex flex-col items-center gap-2">
        <div className="flex size-22 items-center justify-center overflow-hidden rounded-xl border border-border bg-white p-1">
          {logoUrl ? <>
            {/* Dynamic Storage URL; next/image would require a per-tenant remote pattern. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoUrl} alt="Vista previa del logo" className="size-full object-contain" />
          </> : <Building2 className="size-7 text-muted-foreground" />}
        </div>
        <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" disabled={!canManage || saving} onChange={(event) => selectLogo(event.target.files?.[0] ?? null)} />
        <Button type="button" size="sm" variant="outline" disabled={!canManage || saving} onClick={() => inputRef.current?.click()}><ImageUp className="size-3.5" />Cambiar</Button>
        {account?.logo_url && !removeLogo ? <Button type="button" size="sm" variant="ghost" disabled={!canManage || saving} onClick={() => { if (previewUrl) URL.revokeObjectURL(previewUrl); setPreviewUrl(null); setLogoFile(null); setRemoveLogo(true); }}><Trash2 className="size-3.5" />Quitar</Button> : null}
      </div>
      <div className="space-y-2">
        <label htmlFor="account-brand-name" className="text-sm font-medium text-foreground">Nombre que verá el equipo</label>
        <Input id="account-brand-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} disabled={!canManage || saving} placeholder="Mi empresa" />
        <p className="text-xs text-muted-foreground">PNG, JPG, WebP o GIF; máximo 2 MB. Se recomienda un logo cuadrado.</p>
        {!canManage ? <p className="text-xs text-muted-foreground">Solo el propietario o un administrador puede cambiar la identidad.</p> : null}
      </div>
    </div>
    <Button className="mt-5" type="button" disabled={!canManage || saving || !account} onClick={() => void saveBranding()}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}Guardar identidad</Button>
  </div>;
}

function ModeCard({
  mode,
  isActive,
  onPick,
}: {
  mode: Mode;
  isActive: boolean;
  onPick: () => void;
}) {
  const t = useTranslations("Settings.appearance");
  const isLight = mode === "light";
  const Icon = isLight ? Sun : Moon;
  return (
    <button
      type="button"
      role="radio"
      onClick={onPick}
      aria-checked={isActive}
      aria-label={t("useMode", { mode })}
      className={cn(
        "flex items-center gap-3 rounded-lg border bg-card p-4 text-left transition-colors",
        isActive
          ? "border-primary/60 ring-2 ring-primary/40"
          : "border-border hover:border-border hover:bg-muted/40",
      )}
    >
      <span
        aria-hidden
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-foreground"
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="flex-1 text-sm font-semibold capitalize text-foreground">
        {mode}
      </span>
      {isActive && (
        <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
          <Check className="h-3 w-3" />
          {t("active")}
        </span>
      )}
    </button>
  );
}

function ThemeCard({
  id,
  name,
  tagline,
  swatch,
  isActive,
  onPick,
}: {
  id: ThemeId;
  name: string;
  tagline: string;
  swatch: string;
  isActive: boolean;
  onPick: () => void;
}) {
  const t = useTranslations("Settings.appearance");
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={isActive}
      aria-label={t("useTheme", { name })}
      className={cn(
        "flex flex-col gap-3 rounded-lg border bg-card p-4 text-left transition-colors",
        isActive
          ? "border-primary/60 ring-2 ring-primary/40"
          : "border-border hover:border-border hover:bg-muted/40",
      )}
    >
      <div className="flex items-center justify-between">
        <span
          aria-hidden
          className="h-8 w-8 shrink-0 rounded-full"
          style={{
            background: swatch,
            boxShadow: "inset 0 0 0 1px oklch(1 0 0 / 0.15)",
          }}
        />
        {isActive && (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
            <Check className="h-3 w-3" />
            {t("active")}
          </span>
        )}
      </div>
      <div>
        <div className="text-sm font-semibold text-foreground">{name}</div>
        <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {tagline}
        </div>
      </div>
      <div
        className="mt-1 flex h-2 overflow-hidden rounded-full"
        aria-hidden
      >
        <span className="flex-1" style={{ background: swatch }} />
        <span className="w-3 bg-muted-foreground/60" />
        <span className="w-3 bg-muted" />
        <span className="w-3 bg-card" />
      </div>
      <span className="sr-only">Theme id: {id}</span>
    </button>
  );
}
