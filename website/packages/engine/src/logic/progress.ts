/**
 * Byte-accurate progress over files of known size. Never goes backwards, and only
 * reaches 1 when told to: a load is not done until its first frame is drawn.
 */
export class ByteProgress {
  private total = 0;
  private loaded = 0;
  private shown = 0;

  constructor(private readonly publish: (fraction: number) => void) {}

  expect(bytes: number): void {
    this.total += bytes;
  }

  add(bytes: number): void {
    this.loaded += bytes;
    if (this.total <= 0) return;
    const f = Math.min(this.loaded / this.total, 0.999);
    if (f > this.shown) {
      this.shown = f;
      this.publish(f);
    }
  }

  finish(): void {
    this.shown = 1;
    this.publish(1);
  }

  get bytes(): number {
    return this.loaded;
  }
}
