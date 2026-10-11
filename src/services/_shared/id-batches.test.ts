import { describe, expect, it, vi } from "vitest";
import { MP_ID_BATCH, idBatches, inFilter, readByIdBatches } from "./id-batches";

describe("idBatches", () => {
  it("splits into batches of the given size", () => {
    const ids = Array.from({ length: 250 }, (_, i) => i + 1);
    const batches = idBatches(ids);
    expect(batches.map((b) => b.length)).toEqual([MP_ID_BATCH, MP_ID_BATCH, 50]);
    expect(batches.flat()).toEqual(ids);
  });

  it("de-duplicates and drops anything that is not an integer", () => {
    expect(idBatches([3, "3", 4, null, undefined, "", "1 OR 1=1", 2.5, NaN, "7"], 10)).toEqual([
      [3, 4, 7],
    ]);
  });

  it("returns no batches for no ids", () => {
    expect(idBatches([])).toEqual([]);
  });

  it("rejects a nonsensical size", () => {
    expect(() => idBatches([1], 0)).toThrow(RangeError);
  });

  it("keeps a full batch of the widest MP id well under IIS's 2048 query limit", () => {
    const widest = Array.from({ length: MP_ID_BATCH }, (_, i) => 2_147_483_647 - i);
    const encoded = encodeURIComponent(inFilter("Invoice_Detail.Invoice_ID", idBatches(widest)[0]));
    expect(encoded.length).toBeLessThan(1400);
  });
});

describe("inFilter", () => {
  it("writes an IN list", () => {
    expect(inFilter("Program_ID", [1, 2, 3])).toBe("Program_ID IN (1,2,3)");
  });
});

describe("readByIdBatches", () => {
  it("reads every batch and concatenates the rows", async () => {
    const read = vi.fn(async (batch: number[]) => batch.map((id) => ({ id })));
    const rows = await readByIdBatches(
      Array.from({ length: 5 }, (_, i) => i),
      read,
      2
    );
    expect(read).toHaveBeenCalledTimes(3);
    expect(rows.map((r) => r.id)).toEqual([0, 1, 2, 3, 4]);
  });

  it("does not call read for no ids", async () => {
    const read = vi.fn(async () => []);
    expect(await readByIdBatches([], read)).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });

  it("rejects when any batch fails rather than returning a partial result", async () => {
    const read = vi.fn(async (batch: number[]) => {
      if (batch[0] === 2) throw new Error("boom");
      return batch;
    });
    await expect(readByIdBatches([0, 1, 2, 3], read, 2)).rejects.toThrow("boom");
  });
});
