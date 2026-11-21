import { describe, expect, it } from "vite-plus/test";

import { officeNames, officeTask } from "./officeNames";

describe("officeTask", () => {
  it("keeps the words that tell threads apart and drops verbs and fillers", () => {
    expect(
      [
        "Изоляция T3 Code в виртуальной машине",
        "ARP-связность между Pixel и Mac",
        "Проблемы ARP-связности",
        "Добавить команду /schedule",
        "Fix flaky login test",
        "Исправить",
        "",
      ].map(officeTask),
    ).toEqual([
      "Изоляция T3",
      "ARP-связность",
      "ARP-связности",
      "Команду",
      "Flaky login",
      "Исправить",
      "",
    ]);
  });
});

describe("officeNames", () => {
  it("gives every thread its own name, whatever order the threads come in", () => {
    const ids = Array.from({ length: 12 }, (_, index) => `thread-${index}`);
    const names = officeNames(ids, "ru-RU");
    expect(new Set(names).size).toBe(ids.length);
    const reversed = officeNames([...ids].reverse(), "ru-RU");
    expect([...reversed].reverse()).toEqual(names);
  });
});
