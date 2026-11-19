export interface CooldownClock {
  start(): void;
  stop(): void;
  reset(): void;
}

export class Cooldown implements CooldownClock {
  private timer: number | null = null;
  private remaining = 0;

  constructor(
    private readonly seconds: number,
    private readonly onTick: (remaining: number) => void,
  ) {}

  start(): void {
    this.stop();
    this.remaining = this.seconds;
    this.onTick(this.remaining);
    this.timer = window.setInterval(() => {
      this.remaining -= 1;
      if (this.remaining <= 0) {
        this.remaining = 0;
        this.stop();
      }
      this.onTick(this.remaining);
    }, 1000);
  }

  stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  reset(): void {
    this.remaining = 0;
    this.stop();
    this.onTick(0);
  }
}
