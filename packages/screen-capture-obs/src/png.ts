/**
 * Copyright (C) 2026 Particle AI contributors.
 * SPDX-License-Identifier: GPL-2.0-or-later — see the LICENSE file beside this package.
 */

/** The eight bytes every PNG begins with. */
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Signature (8) + chunk length (4) + chunk type (4) + width (4) + height (4). */
const HEADER_BYTES = 24;

/**
 * How big a PNG is, read out of its own header.
 *
 * OBS hands back the bytes of a picture and says nothing about its size, and a capture result
 * here carries a width and a height. The first chunk of a PNG is IHDR, and its first two fields
 * are the width and the height as big-endian 32-bit numbers — so the real size is in the file
 * and does not have to be invented.
 */
export function pngSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < HEADER_BYTES) return null;
  if (!bytes.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return null;
  if (bytes.subarray(12, 16).toString("ascii") !== "IHDR") return null;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}
