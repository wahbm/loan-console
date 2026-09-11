import { describe, expect, it } from "vitest";
import { sqlTimestamp } from "./auth.js";

describe("auth SQL timestamps", () => {
  it("formats UTC timestamps for MariaDB DATETIME columns", () => {
    expect(sqlTimestamp(new Date("2026-09-11T13:55:14.918Z"))).toBe("2026-09-11 13:55:14");
  });
});
