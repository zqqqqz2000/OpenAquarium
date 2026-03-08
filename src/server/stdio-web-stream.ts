type StreamChunk = Uint8Array | string;
type StreamListener = ((chunk: StreamChunk) => void) | (() => void) | ((error: Error) => void);

interface ReadableLike {
  on(event: "data" | "end" | "close" | "error", listener: StreamListener): void;
  off?(event: "data" | "end" | "close" | "error", listener: StreamListener): void;
  removeListener?(event: "data" | "end" | "close" | "error", listener: StreamListener): void;
  pause?(): void;
  resume?(): void;
  destroy?(error?: Error): void;
}

interface WritableLike {
  write(chunk: Uint8Array, callback?: () => void): boolean;
  end(callback?: () => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  off?(event: "error", listener: (error: Error) => void): void;
  removeListener?(event: "error", listener: (error: Error) => void): void;
  destroy?(error?: Error): void;
}

function removeReadableListener(
  stream: ReadableLike,
  event: "data" | "end" | "close" | "error",
  listener: StreamListener,
): void {
  if (typeof stream.off === "function") {
    stream.off(event, listener as never);
    return;
  }

  stream.removeListener?.(event, listener as never);
}

function removeWritableListener(stream: WritableLike, event: "error", listener: (error: Error) => void): void {
  if (typeof stream.off === "function") {
    stream.off(event, listener);
    return;
  }

  stream.removeListener?.(event, listener);
}

function toUint8Array(chunk: StreamChunk): Uint8Array {
  if (typeof chunk === "string") {
    return new TextEncoder().encode(chunk);
  }

  return chunk;
}

export function readableToWebStream(stream: ReadableLike): ReadableStream<Uint8Array> {
  let paused = false;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const onData = (chunk: StreamChunk): void => {
        controller.enqueue(toUint8Array(chunk));
        if ((controller.desiredSize ?? 1) <= 0 && !paused) {
          stream.pause?.();
          paused = true;
        }
      };
      const onEnd = (): void => {
        cleanup();
        controller.close();
      };
      const onClose = (): void => {
        cleanup();
        controller.close();
      };
      const onError = (error: Error): void => {
        cleanup();
        controller.error(error);
      };
      const cleanup = (): void => {
        removeReadableListener(stream, "data", onData);
        removeReadableListener(stream, "end", onEnd);
        removeReadableListener(stream, "close", onClose);
        removeReadableListener(stream, "error", onError);
      };

      stream.on("data", onData);
      stream.on("end", onEnd);
      stream.on("close", onClose);
      stream.on("error", onError);
      stream.resume?.();
    },
    pull() {
      if (paused) {
        paused = false;
        stream.resume?.();
      }
    },
    cancel(reason) {
      if (reason instanceof Error) {
        stream.destroy?.(reason);
      } else {
        stream.destroy?.();
      }
    },
  });
}

export function writableToWebStream(stream: WritableLike): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({
    write(chunk) {
      return new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => {
          removeWritableListener(stream, "error", onError);
          reject(error);
        };

        stream.on("error", onError);
        stream.write(chunk, () => {
          removeWritableListener(stream, "error", onError);
          resolve();
        });
      });
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => {
          removeWritableListener(stream, "error", onError);
          reject(error);
        };

        stream.on("error", onError);
        stream.end(() => {
          removeWritableListener(stream, "error", onError);
          resolve();
        });
      });
    },
    abort(reason) {
      if (reason instanceof Error) {
        stream.destroy?.(reason);
      } else {
        stream.destroy?.();
      }
      return Promise.resolve();
    },
  });
}
