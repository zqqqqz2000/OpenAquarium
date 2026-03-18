import { readFile } from "node:fs/promises";
import path from "node:path";

export interface LocalImageMetadata {
  absolutePath: string;
  fileName: string;
  byteLength: number;
  format?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  note: string;
}

function isPng(buffer: Buffer): boolean {
  return buffer.length >= 24
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47;
}

function isGif(buffer: Buffer): boolean {
  return buffer.length >= 10
    && (buffer.subarray(0, 6).toString("ascii") === "GIF87a" || buffer.subarray(0, 6).toString("ascii") === "GIF89a");
}

function isWebp(buffer: Buffer): boolean {
  return buffer.length >= 16
    && buffer.subarray(0, 4).toString("ascii") === "RIFF"
    && buffer.subarray(8, 12).toString("ascii") === "WEBP";
}

function isJpeg(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8;
}

function readJpegDimensions(buffer: Buffer): { width?: number; height?: number } {
  let offset = 2;

  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    if (marker === 0xda) {
      break;
    }

    const segmentLength = buffer.readUInt16BE(offset + 2);
    const isStartOfFrame = (
      marker >= 0xc0
      && marker <= 0xcf
      && marker !== 0xc4
      && marker !== 0xc8
      && marker !== 0xcc
    );
    if (isStartOfFrame && offset + 8 < buffer.length) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }

    offset += 2 + segmentLength;
  }

  return {};
}

function readWebpDimensions(buffer: Buffer): { width?: number; height?: number } {
  const chunkType = buffer.subarray(12, 16).toString("ascii");

  if (chunkType === "VP8X" && buffer.length >= 30) {
    const width = 1 + buffer.readUIntLE(24, 3);
    const height = 1 + buffer.readUIntLE(27, 3);
    return { width, height };
  }

  if (chunkType === "VP8L" && buffer.length >= 25) {
    const bits = buffer.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }

  return {};
}

export async function inspectLocalImage(absolutePath: string): Promise<LocalImageMetadata> {
  const buffer = await readFile(absolutePath);
  const base = {
    absolutePath,
    fileName: path.basename(absolutePath),
    byteLength: buffer.byteLength,
    note: "Metadata only. This tool does not perform visual semantic analysis.",
  } satisfies Omit<LocalImageMetadata, "format" | "mimeType" | "width" | "height">;

  if (isPng(buffer)) {
    return {
      ...base,
      format: "png",
      mimeType: "image/png",
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  }

  if (isGif(buffer)) {
    return {
      ...base,
      format: "gif",
      mimeType: "image/gif",
      width: buffer.readUInt16LE(6),
      height: buffer.readUInt16LE(8),
    };
  }

  if (isJpeg(buffer)) {
    const dimensions = readJpegDimensions(buffer);
    return {
      ...base,
      format: "jpeg",
      mimeType: "image/jpeg",
      ...dimensions,
    };
  }

  if (isWebp(buffer)) {
    return {
      ...base,
      format: "webp",
      mimeType: "image/webp",
      ...readWebpDimensions(buffer),
    };
  }

  return {
    ...base,
    format: path.extname(absolutePath).replace(/^\./u, "").toLowerCase() || undefined,
    mimeType: undefined,
  };
}
