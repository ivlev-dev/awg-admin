import { createForbiddenHandler } from "@/app/errors";
import { ApiError } from "@/domain/errors";
import { setLocale } from "@/i18n";

interface Harness {
  handler: (error: ApiError) => void;
  logout: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
}

function harness(): Harness {
  const logout = vi.fn(async () => undefined);
  const error = vi.fn();
  const handler = createForbiddenHandler({ logout }, { error });
  return { handler, logout, error };
}

afterEach(() => {
  setLocale("ru");
  vi.useRealTimers();
});

describe("createForbiddenHandler", () => {
  it("does not log out or notify on an ordinary forbidden error", () => {
    const test = harness();

    test.handler(new ApiError(403, "forbidden", "denied"));

    expect(test.logout).not.toHaveBeenCalled();
    expect(test.error).not.toHaveBeenCalled();
  });

  it("logs out and shows a message when the account is disabled", async () => {
    const test = harness();

    test.handler(new ApiError(403, "account_disabled", "account is disabled"));
    await Promise.resolve();

    expect(test.error).toHaveBeenCalledWith("Учётная запись отключена");
    expect(test.logout).toHaveBeenCalledTimes(1);
  });

  it("handles pending and rejected accounts without duplicate logouts", async () => {
    const test = harness();

    test.handler(new ApiError(403, "pending_approval", "pending"));
    test.handler(new ApiError(403, "rejected", "rejected"));
    await Promise.resolve();

    expect(test.error).toHaveBeenCalledTimes(1);
    expect(test.error).toHaveBeenCalledWith("Заявка ожидает подтверждения администратором.");
    expect(test.logout).toHaveBeenCalledTimes(1);
  });
});
