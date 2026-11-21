import { Router } from "@/app/router";
import { setPageLoader } from "@/app/router-records";
import {
  confirmLeave,
  hasUnsavedChanges,
  markClean,
  markDirty,
  registerUnsaved,
} from "@/app/unsaved";

const confirmMock = vi.hoisted(() => ({
  askConfirm: vi.fn(async (_options: unknown) => false),
}));

vi.mock("@/app/confirm", () => confirmMock);

function flush(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe("unsaved registry", () => {
  beforeAll(() => {
    setPageLoader(async () => ({ default: () => undefined }));
  });

  beforeEach(() => {
    confirmMock.askConfirm.mockReset();
    confirmMock.askConfirm.mockResolvedValue(false);
    window.history.replaceState(null, "", "/");
  });

  it("считает форму грязной и спрашивает подтверждение", async () => {
    markDirty("settings");

    expect(hasUnsavedChanges()).toBe(true);
    await expect(confirmLeave()).resolves.toBe(false);
    expect(confirmMock.askConfirm).toHaveBeenCalledTimes(1);

    markClean("settings");
    expect(hasUnsavedChanges()).toBe(false);
    await expect(confirmLeave()).resolves.toBe(true);
  });

  it("учитывает форму с предикатом", () => {
    let dirty = true;
    registerUnsaved("settings", () => dirty);

    expect(hasUnsavedChanges()).toBe(true);
    dirty = false;
    expect(hasUnsavedChanges()).toBe(false);
  });

  it("не меняет маршрут при отказе уйти с грязной формы", async () => {
    const router = new Router();
    markDirty("settings");

    router.navigate("/clients");
    await flush();

    expect(router.path).toBe("/");
    expect(confirmMock.askConfirm).toHaveBeenCalledTimes(1);
  });

  it("уходит без вопроса после очистки формы", async () => {
    const router = new Router();
    markDirty("settings");
    markClean("settings");

    router.navigate("/clients");
    await flush();

    expect(router.path).toBe("/clients");
    expect(confirmMock.askConfirm).not.toHaveBeenCalled();
  });

  it("уходит после подтверждения", async () => {
    confirmMock.askConfirm.mockResolvedValue(true);
    const router = new Router();
    markDirty("settings");

    router.navigate("/clients");
    await flush();

    expect(router.path).toBe("/clients");
  });
});
