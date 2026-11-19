import { Cooldown } from "@/app/cooldown";

afterEach(() => {
  vi.useRealTimers();
});

describe("Cooldown", () => {
  it("ticks down to zero and stops", () => {
    vi.useFakeTimers();
    const ticks: number[] = [];
    const cooldown = new Cooldown(3, (value) => ticks.push(value));

    cooldown.start();
    expect(ticks).toEqual([3]);

    vi.advanceTimersByTime(1000);
    expect(ticks).toEqual([3, 2]);
    vi.advanceTimersByTime(1000);
    expect(ticks).toEqual([3, 2, 1]);
    vi.advanceTimersByTime(1000);
    expect(ticks).toEqual([3, 2, 1, 0]);

    vi.advanceTimersByTime(5000);
    expect(ticks).toEqual([3, 2, 1, 0]);
  });

  it("restarts from the full duration", () => {
    vi.useFakeTimers();
    const ticks: number[] = [];
    const cooldown = new Cooldown(5, (value) => ticks.push(value));

    cooldown.start();
    vi.advanceTimersByTime(2000);
    cooldown.start();
    expect(ticks.at(-1)).toBe(5);
  });

  it("stops and resets without further ticks", () => {
    vi.useFakeTimers();
    const ticks: number[] = [];
    const cooldown = new Cooldown(10, (value) => ticks.push(value));

    cooldown.start();
    cooldown.stop();
    vi.advanceTimersByTime(2000);
    expect(ticks).toEqual([10]);

    cooldown.reset();
    expect(ticks).toEqual([10, 0]);
  });
});
