import { wrapPrint } from "@/lib/print-template";

/**
 * The print page's "wait for images, then print" script, run against a small
 * stand-in for the page (no browser in these tests). The rule: print as soon as
 * every image has loaded; after 6 seconds, REMOVE whatever still hasn't loaded
 * and print anyway, so a slow photo can't leave a phone stuck on the preview.
 */
type FakeImg = {
  name: string;
  complete: boolean;
  naturalWidth: number;
  src: string | null;
  parentNode: FakeCell | null;
  listeners: Record<string, () => void>;
  addEventListener: (ev: string, fn: () => void) => void;
  removeAttribute: (a: string) => void;
  finish: () => void;
};
type FakeCell = { tagName: string; children: FakeImg[]; parentNode: { removed: FakeCell[]; removeChild: (c: FakeCell) => void } | null; removeChild: (i: FakeImg) => void };

function makeImg(name: string, loaded: boolean, grid: NonNullable<FakeCell["parentNode"]>, tag = "DIV"): FakeImg {
  const img: FakeImg = {
    name,
    complete: loaded,
    naturalWidth: loaded ? 100 : 0,
    src: name,
    parentNode: null,
    listeners: {},
    addEventListener(ev, fn) { this.listeners[ev] = fn; },
    removeAttribute(a) { if (a === "src") this.src = null; },
    finish() { this.complete = true; this.naturalWidth = 100; this.listeners.load?.(); },
  };
  const cell: FakeCell = {
    tagName: tag,
    children: [img],
    parentNode: grid,
    removeChild(i) { this.children = this.children.filter((x) => x !== i); },
  };
  img.parentNode = cell;
  return img;
}

function runPage(imgs: FakeImg[]) {
  const html = wrapPrint({ orgName: "Test Co", docTitle: "Quote" } as never, "<p>body</p>");
  const script = html.slice(html.lastIndexOf("<script>") + 8, html.lastIndexOf("</script>"));
  const win = { printed: 0, focus() {}, print() { this.printed++; } };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function("document", "window", script)({ images: imgs }, win);
  return win;
}

describe("print page: wait for images", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("prints right away when every image is already loaded, removing nothing", () => {
    const grid = { removed: [] as FakeCell[], removeChild(c: FakeCell) { this.removed.push(c); } };
    const win = runPage([makeImg("a", true, grid), makeImg("b", true, grid)]);
    jest.advanceTimersByTime(200);
    expect(win.printed).toBe(1);
    expect(grid.removed).toHaveLength(0);
    jest.advanceTimersByTime(10_000);
    expect(win.printed).toBe(1); // the 6s fallback doesn't print a second time
  });

  it("waits for a slow image, then prints once it lands", () => {
    const grid = { removed: [] as FakeCell[], removeChild(c: FakeCell) { this.removed.push(c); } };
    const slow = makeImg("slow", false, grid);
    const win = runPage([makeImg("a", true, grid), slow]);
    jest.advanceTimersByTime(2000);
    expect(win.printed).toBe(0);
    slow.finish();
    jest.advanceTimersByTime(200);
    expect(win.printed).toBe(1);
    expect(grid.removed).toHaveLength(0);
  });

  it("after 6 seconds removes the photos still loading, keeps the loaded ones, and prints", () => {
    const grid = { removed: [] as FakeCell[], removeChild(c: FakeCell) { this.removed.push(c); } };
    const ok = makeImg("ok", true, grid);
    const hung1 = makeImg("hung1", false, grid);
    const hung2 = makeImg("hung2", false, grid);
    const win = runPage([ok, hung1, hung2]);
    jest.advanceTimersByTime(5900);
    expect(win.printed).toBe(0);
    jest.advanceTimersByTime(400);
    expect(win.printed).toBe(1);
    expect(grid.removed).toEqual([hung1.parentNode, hung2.parentNode]);
    expect(hung1.src).toBeNull(); // download stopped
    expect(ok.src).toBe("ok");
  });

  it("a slow logo (not in a photo cell) is taken out on its own, without removing the header", () => {
    const grid = { removed: [] as FakeCell[], removeChild(c: FakeCell) { this.removed.push(c); } };
    const logo = makeImg("logo", false, grid, "HEADER");
    const header = logo.parentNode!;
    const win = runPage([logo]);
    jest.advanceTimersByTime(6300);
    expect(win.printed).toBe(1);
    expect(grid.removed).toHaveLength(0);
    expect(header.children).toHaveLength(0);
  });
});
