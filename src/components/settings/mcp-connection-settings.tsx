'use client';

// ============================================================
// McpConnectionSettings — ready-to-copy connection details for the
// in-app HTTP MCP endpoint (`/api/mcp`). This is the "web interface"
// counterpart to the standalone stdio server in `mcp-server/`: no
// local install, no compiling — just an API key and a URL, exactly
// like any other integration on this page.
// ============================================================

import { useSyncExternalStore } from 'react';
import { Bot, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// SSR renders '' (no window); the client re-reads the real origin on
// hydration — the same warning-free pattern as useIsClient in
// themed-toaster.tsx, avoids a setState-in-effect for a value that
// never changes during the component's lifetime.
const noopSubscribe = () => () => {};
function useOrigin(): string {
  return useSyncExternalStore(
    noopSubscribe,
    () => window.location.origin,
    () => ''
  );
}

export function McpConnectionSettings({ onCreateApiKey }: { onCreateApiKey: () => void }) {
  const t = useTranslations('Settings.mcp');
  const origin = useOrigin();

  const endpointUrl = `${origin}/api/mcp`;
  const configSnippet = JSON.stringify(
    {
      mcpServers: {
        nexoomni: {
          url: endpointUrl,
          headers: { Authorization: 'Bearer <tu-clave-de-api>' },
        },
      },
    },
    null,
    2
  );

  async function copy(text: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(successMessage);
    } catch {
      toast.error(t('copyFailed'));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Bot className="size-4" />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-muted-foreground text-xs">{t('endpointLabel')}</Label>
          <div className="flex gap-2">
            <Input
              readOnly
              value={endpointUrl}
              className="font-mono text-xs"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => copy(endpointUrl, t('copyUrlSuccess'))}
            >
              <Copy className="size-4" />
            </Button>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-muted-foreground text-xs">{t('configLabel')}</Label>
          <div className="flex items-start gap-2">
            <pre className="border-border bg-muted flex-1 overflow-x-auto rounded-md border p-2 text-[11px]">
              {configSnippet}
            </pre>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => copy(configSnippet, t('copyConfigSuccess'))}
            >
              <Copy className="size-4" />
            </Button>
          </div>
        </div>

        <p className="text-muted-foreground text-xs">{t('note')}</p>

        <Button type="button" variant="outline" onClick={onCreateApiKey}>
          {t('createKeyButton')}
        </Button>
      </CardContent>
    </Card>
  );
}
