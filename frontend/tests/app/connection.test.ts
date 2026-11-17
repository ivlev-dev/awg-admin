import { ConnectionMonitor, RESTORED_NOTICE_MS } from "@/app/connection";

afterEach(() => {
  vi.useRealTimers();
});

describe("ConnectionMonitor", () => {
  it("shows a sticky offline notice when the browser goes offline", () => {
    const monitor = new ConnectionMonitor();
    monitor.listen();

    window.dispatchEvent(new Event("offline"));

    expect(monitor.online).toBe(false);
    expect(monitor.notice).toBe("offline");

    monitor.dispose();
  });

  it("shows the restored notice for three seconds and then hides it", () => {
    vi.useFakeTimers();
    const monitor = new ConnectionMonitor();
    monitor.listen();

    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));

    expect(monitor.online).toBe(true);
    expect(monitor.notice).toBe("restored");

    vi.advanceTimersByTime(RESTORED_NOTICE_MS - 1);
    expect(monitor.notice).toBe("restored");

    vi.advanceTimersByTime(1);
    expect(monitor.notice).toBeNull();

    monitor.dispose();
  });

  it("returns offline again and cancels the restored timer", () => {
    vi.useFakeTimers();
    const monitor = new ConnectionMonitor();
    monitor.listen();

    window.dispatchEvent(new Event("online"));
    expect(monitor.notice).toBe("restored");

    window.dispatchEvent(new Event("offline"));
    expect(monitor.notice).toBe("offline");

    vi.advanceTimersByTime(RESTORED_NOTICE_MS);
    expect(monitor.notice).toBe("offline");

    monitor.dispose();
  });

  it("removes listeners on dispose", () => {
    const monitor = new ConnectionMonitor();
    monitor.listen();
    monitor.dispose();

    window.dispatchEvent(new Event("offline"));

    expect(monitor.online).not.toBe(false);
  });
});
