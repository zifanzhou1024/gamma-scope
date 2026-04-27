import { describe, expect, it } from "vitest";
import {
  DEFAULT_DATA_SOURCE,
  DATA_SOURCE_STORAGE_KEY,
  isDataSourcePreference,
  loadDataSourcePreference,
  saveDataSourcePreference
} from "../lib/sourcePreference";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("sourcePreference", () => {
  it("defaults to Moomoo", () => {
    expect(DEFAULT_DATA_SOURCE).toBe("moomoo");
    expect(loadDataSourcePreference(new MemoryStorage())).toBe("moomoo");
  });

  it("validates supported source values", () => {
    expect(isDataSourcePreference("moomoo")).toBe(true);
    expect(isDataSourcePreference("ibkr")).toBe(true);
    expect(isDataSourcePreference("mock")).toBe(false);
  });

  it("loads saved valid preference and ignores invalid values", () => {
    const storage = new MemoryStorage();
    storage.setItem(DATA_SOURCE_STORAGE_KEY, "ibkr");
    expect(loadDataSourcePreference(storage)).toBe("ibkr");

    storage.setItem(DATA_SOURCE_STORAGE_KEY, "bad");
    expect(loadDataSourcePreference(storage)).toBe("moomoo");
  });

  it("saves selected preference", () => {
    const storage = new MemoryStorage();
    saveDataSourcePreference("ibkr", storage);
    expect(storage.getItem(DATA_SOURCE_STORAGE_KEY)).toBe("ibkr");
  });

  it("defaults to Moomoo when storage getItem throws", () => {
    const storage = {
      getItem() {
        throw new Error("Storage unavailable");
      }
    };

    expect(loadDataSourcePreference(storage)).toBe("moomoo");
  });

  it("ignores storage setItem failures when saving", () => {
    const storage = {
      setItem() {
        throw new Error("Storage unavailable");
      }
    };

    expect(() => saveDataSourcePreference("ibkr", storage)).not.toThrow();
  });
});
