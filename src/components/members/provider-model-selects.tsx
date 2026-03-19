import { useEffect, useMemo, useState } from "react";

import type { GlobalWorkspaceConfig, ProviderProfileType, TemplateStudioModelCatalog } from "@/domain/model";
import { WorkspaceRuntimeClient } from "@/lib/runtime-client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function ProviderModelSelects(props: {
  globalConfig: GlobalWorkspaceConfig;
  modelProfileId?: string;
  modelId?: string;
  disabled?: boolean;
  allowedProviderTypes?: ProviderProfileType[];
  providerLabel?: string;
  modelLabel?: string;
  providerPlaceholder?: string;
  modelPlaceholder?: string;
  onProviderChange: (profileId: string) => void;
  onModelChange: (modelId?: string) => void;
  onCatalogChange?: (catalog?: TemplateStudioModelCatalog) => void;
}) {
  const {
    globalConfig,
    modelProfileId,
    modelId,
    disabled = false,
    allowedProviderTypes,
    providerLabel = "Provider",
    modelLabel = "Model",
    providerPlaceholder = "Select provider",
    modelPlaceholder = "Select model",
    onProviderChange,
    onModelChange,
    onCatalogChange,
  } = props;
  const runtimeClient = useMemo(() => new WorkspaceRuntimeClient(), []);
  const [catalog, setCatalog] = useState<TemplateStudioModelCatalog | undefined>(undefined);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [catalogError, setCatalogError] = useState<string | undefined>(undefined);
  const selectableProfiles = useMemo(
    () => globalConfig.modelProfiles.filter((profile) => !allowedProviderTypes || allowedProviderTypes.includes(profile.providerType)),
    [allowedProviderTypes, globalConfig.modelProfiles],
  );
  const selectedProfileId = modelProfileId ?? selectableProfiles[0]?.id;

  useEffect(() => {
    let cancelled = false;
    const schedule = (callback: () => void): void => {
      queueMicrotask(() => {
        if (!cancelled) {
          callback();
        }
      });
    };

    if (!selectedProfileId) {
      schedule(() => {
        setCatalog(undefined);
        setCatalogError(undefined);
        setLoadingCatalog(false);
        onCatalogChange?.(undefined);
      });
      return;
    }

    schedule(() => {
      setLoadingCatalog(true);
      setCatalogError(undefined);
    });
    void runtimeClient.getTemplateStudioModels({ modelProfileId: selectedProfileId }).then(
      (nextCatalog) => {
        if (cancelled) {
          return;
        }

        setCatalog(nextCatalog);
        onCatalogChange?.(nextCatalog);
        if (nextCatalog.source === "runtime" && modelId && !nextCatalog.availableModels.some((option) => option.id === modelId)) {
          onModelChange(undefined);
        }
      },
      (error: unknown) => {
        if (cancelled) {
          return;
        }

        const message = error instanceof Error ? error.message : String(error);
        setCatalog(undefined);
        setCatalogError(message);
        onCatalogChange?.(undefined);
      },
    ).finally(() => {
      if (!cancelled) {
        setLoadingCatalog(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [modelId, onCatalogChange, onModelChange, runtimeClient, selectedProfileId]);

  return (
    <>
      <label className="flex flex-col gap-2">
        <span className="text-sm font-medium">{providerLabel}</span>
        <Select value={selectedProfileId ?? ""} onValueChange={onProviderChange} disabled={disabled || selectableProfiles.length === 0}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder={providerPlaceholder} />
          </SelectTrigger>
          <SelectContent>
            {selectableProfiles.map((profile) => (
              <SelectItem key={profile.id} value={profile.id}>
                {profile.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className="flex flex-col gap-2">
        <span className="text-sm font-medium">{modelLabel}</span>
        <Select
          value={modelId ?? ""}
          onValueChange={onModelChange}
          disabled={disabled || loadingCatalog || !catalog || catalog.source !== "runtime" || catalog.availableModels.length === 0}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder={loadingCatalog ? "Loading models…" : catalog?.source === "unavailable" ? "Runtime models unavailable" : modelPlaceholder} />
          </SelectTrigger>
          <SelectContent>
            {catalog?.availableModels.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.label}
                {catalog.source === "runtime" && catalog.currentModelId === option.id ? " (Current)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {loadingCatalog ? <span>Checking runtime models…</span> : null}
          {!loadingCatalog && catalog?.source === "runtime" ? <span>Model list comes from the current {catalog.providerLabel} session.</span> : null}
          {!loadingCatalog && catalog?.source === "unavailable" ? (
            <span className="text-destructive">{catalog.unavailableMessage ?? "Runtime model capability unavailable."}</span>
          ) : null}
          {catalogError ? <span className="text-destructive">{catalogError}</span> : null}
        </div>
      </label>
    </>
  );
}
