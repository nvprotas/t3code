import { describe, expect, it } from "vite-plus/test";

import { officeShortNames } from "./officeNames";

describe("officeShortNames", () => {
  it("keeps the first word and adds words only to tell titles apart", () => {
    expect(
      officeShortNames([
        "Изоляция T3 Code в виртуальной машине",
        "Диагностика лагов офиса",
        "Диагностика ARP-связности",
        "Fix flaky login test",
        "",
      ]),
    ).toEqual(["Изоляция", "Диаг. лагов", "Диаг. ARP-связности", "Fix flaky", ""]);
  });
});
