import { describe, it, expect } from "vitest";
import { pngSize } from "./png";

/**
 * OBS hands back the bytes of a picture and says nothing about how big it is, but a capture
 * result in this repository carries a width and a height. Reading them out of the file is the
 * only way to have the real ones; inventing them would put a number in a result that nothing
 * measured.
 */
function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8); // IHDR chunk length
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

describe("the size of a png", () => {
  it("is the one its header declares", () => {
    expect(pngSize(png(1439, 851))).toEqual({ width: 1439, height: 851 });
  });

  it("is nothing when the bytes are not a png", () => {
    expect(pngSize(Buffer.from("not a png at all, really not"))).toBeNull();
    expect(pngSize(Buffer.alloc(0))).toBeNull();
    expect(pngSize(png(10, 10).subarray(0, 20))).toBeNull(); // truncated before the height
  });

  it("is nothing when the header is a png header but the chunk is not IHDR", () => {
    const broken = png(10, 10);
    broken.write("IDAT", 12, "ascii");
    expect(pngSize(broken)).toBeNull();
  });

  it("is nothing when a side is zero, which no picture has", () => {
    expect(pngSize(png(0, 851))).toBeNull();
    expect(pngSize(png(1439, 0))).toBeNull();
  });
});
