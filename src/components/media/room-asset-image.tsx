import { useEffect, useMemo, useRef, useState, type ImgHTMLAttributes } from "react";

import { Expand, ImageOff } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ensureRoomAssetSessionCookie,
  resolveRoomAssetUrl,
  shouldBootstrapRoomAssetSession,
} from "@/lib/room-assets";
import { cn } from "@/lib/utils";

interface RoomAssetImageProps
  extends Omit<ImgHTMLAttributes<HTMLImageElement>, "alt" | "className" | "src"> {
  alt?: string;
  className?: string;
  dialogImageClassName?: string;
  imageClassName?: string;
  roomId?: string;
  src: string;
}

export function RoomAssetImage(props: RoomAssetImageProps) {
  const {
    alt,
    className,
    dialogImageClassName,
    imageClassName,
    roomId,
    src,
    title,
    ...imageProps
  } = props;
  const [previewOpen, setPreviewOpen] = useState(false);
  const shouldBootstrapSession = shouldBootstrapRoomAssetSession(roomId, src);
  const resolvedSrc = useMemo(
    () => resolveRoomAssetUrl(roomId, src),
    [roomId, src],
  );
  const [readySrc, setReadySrc] = useState<string | undefined>();
  const [failedSrc, setFailedSrc] = useState<string | undefined>();
  const [requestState, setRequestState] = useState<{ src: string; version: number }>({
    src: resolvedSrc,
    version: 0,
  });
  const mountedRef = useRef(true);
  const retriedAfterBootstrapRef = useRef<string | undefined>();
  const loadFailed = failedSrc === resolvedSrc;
  const assetReady = !shouldBootstrapSession || readySrc === resolvedSrc;
  const requestVersion = requestState.src === resolvedSrc ? requestState.version : 0;
  const displaySrc = useMemo(
    () => buildAttemptedAssetUrl(resolvedSrc, requestVersion),
    [requestVersion, resolvedSrc],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!shouldBootstrapSession) {
      return;
    }

    let cancelled = false;

    void ensureRoomAssetSessionCookie().finally(() => {
      if (cancelled || !mountedRef.current) {
        return;
      }

      setReadySrc(resolvedSrc);
    });

    return () => {
      cancelled = true;
    };
  }, [resolvedSrc, shouldBootstrapSession]);

  if (!src.trim()) {
    return null;
  }

  if (loadFailed) {
    return (
      <div
        className={cn(
          "my-4 flex min-h-28 w-full max-w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border/80 bg-muted/20 px-4 py-5 text-xs text-muted-foreground",
          className,
        )}
      >
        <ImageOff size={16} />
        <span className="break-all">{alt?.trim() || src}</span>
      </div>
    );
  }

  return (
    <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
      <button
        type="button"
        className={cn(
          "group relative my-4 inline-flex max-w-full overflow-hidden rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          className,
        )}
        aria-label={alt?.trim() ? `Open image preview: ${alt}` : "Open image preview"}
        onClick={() => setPreviewOpen(true)}
      >
        {assetReady ? (
          <img
            {...imageProps}
            src={displaySrc}
            alt={alt}
            title={title ?? alt}
            loading={imageProps.loading ?? "lazy"}
            className={cn(
              "max-h-56 w-auto max-w-full rounded-2xl border border-border/80 bg-card object-contain shadow-sm transition-transform duration-200 group-hover:scale-[1.01]",
              imageClassName,
            )}
            onError={(event) => {
              if (shouldBootstrapSession && retriedAfterBootstrapRef.current !== resolvedSrc) {
                retriedAfterBootstrapRef.current = resolvedSrc;
                setReadySrc(undefined);
                void ensureRoomAssetSessionCookie().finally(() => {
                  if (!mountedRef.current) {
                    return;
                  }

                  setFailedSrc(undefined);
                  setRequestState((current) => ({
                    src: resolvedSrc,
                    version: current.src === resolvedSrc ? current.version + 1 : 1,
                  }));
                  setReadySrc(resolvedSrc);
                });
                return;
              }

              setFailedSrc(resolvedSrc);
              imageProps.onError?.(event);
            }}
          />
        ) : (
          <div
            aria-busy="true"
            className={cn(
              "flex min-h-28 w-full min-w-48 max-w-full items-center justify-center rounded-2xl border border-border/80 bg-muted/20 px-4 py-5 text-xs text-muted-foreground",
              imageClassName,
            )}
          >
            Loading image...
          </div>
        )}
        <span className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-t from-foreground/10 via-transparent to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
        <span className="pointer-events-none absolute right-3 bottom-3 inline-flex items-center gap-1 rounded-full border border-border/80 bg-background/92 px-2.5 py-1 text-[11px] font-medium text-foreground shadow-sm supports-[backdrop-filter]:bg-background/80 supports-[backdrop-filter]:backdrop-blur-sm">
          <Expand size={12} />
          Preview
        </span>
      </button>
      <DialogContent className="h-[min(92vh,64rem)] w-[min(96vw,96rem)] max-w-[96rem] overflow-hidden p-0 sm:max-w-[96rem]">
        <DialogHeader className="shrink-0 border-b border-border/70 px-6 py-4 pr-14">
          <DialogTitle>{alt?.trim() || "Image preview"}</DialogTitle>
          <DialogDescription className="break-all text-xs">
            {src}
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 items-center justify-center bg-muted/10 p-4">
          {assetReady ? (
            <img
              src={displaySrc}
              alt={alt || "Image preview"}
              className={cn(
                "max-h-full w-auto max-w-full rounded-2xl object-contain shadow-lg",
                dialogImageClassName,
              )}
            />
          ) : (
            <div
              aria-busy="true"
              className={cn(
                "flex min-h-48 w-full items-center justify-center rounded-2xl border border-border/80 bg-card/60 px-4 py-5 text-xs text-muted-foreground",
                dialogImageClassName,
              )}
            >
              Loading image...
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function buildAttemptedAssetUrl(src: string, requestVersion: number): string {
  if (requestVersion <= 0) {
    return src;
  }

  try {
    const url = new URL(src);
    url.searchParams.set("oa_asset_attempt", String(requestVersion));
    return url.toString();
  } catch {
    return src;
  }
}
