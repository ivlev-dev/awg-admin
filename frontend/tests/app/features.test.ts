import { GROUPS_SECTION_ENABLED } from "@/app/features";
import { ROUTE_RECORDS } from "@/app/router-records";

describe("features", () => {
  it("читает флаг групп из окружения", () => {
    expect(GROUPS_SECTION_ENABLED).toBe(import.meta.env.VITE_FEATURE_GROUPS === "true");
  });

  it("прячет маршруты групп при выключенном флаге", () => {
    const groups = ROUTE_RECORDS.find((record) => record.name === "groups");
    const group = ROUTE_RECORDS.find((record) => record.name === "group");
    if (GROUPS_SECTION_ENABLED) {
      expect(groups?.redirect).toBeUndefined();
      expect(group?.redirect).toBeUndefined();
    } else {
      expect(groups?.redirect).toBe("/interfaces");
      expect(group?.redirect).toBe("/interfaces");
    }
  });
});
