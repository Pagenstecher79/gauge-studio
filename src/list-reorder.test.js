import { describe, it, expect, vi } from 'vitest';
import { indexAtY, ListReorder } from './list-reorder.js';

/** A list of rows 40 tall with an 8 pixel gap, starting at 100. */
const rows = (n, top = 100, h = 40, gap = 8) =>
  Array.from({ length: n }, (_, i) => ({ top: top + i * (h + gap),
                                         bottom: top + i * (h + gap) + h }));

describe('which row a pointer is over', () => {
  it('answers the row it is inside', () => {
    const r = rows(3);
    expect(indexAtY(r, 100)).toBe(0);
    expect(indexAtY(r, 139)).toBe(0);
    expect(indexAtY(r, 148)).toBe(1);
    expect(indexAtY(r, 240)).toBe(2);
  });

  it('gives a gap to the row it is nearest', () => {
    const r = rows(3);
    expect(indexAtY(r, 141)).toBe(0);
    expect(indexAtY(r, 146)).toBe(1);
  });

  it('gives the exact middle of a gap to the earlier row', () => {
    expect(indexAtY(rows(2), 144)).toBe(0);
  });

  it('answers the ends for a pointer dragged off the list', () => {
    const r = rows(4);
    expect(indexAtY(r, -500)).toBe(0);
    expect(indexAtY(r, 5000)).toBe(3);
  });

  it('answers the fallback for a list with no rows', () => {
    expect(indexAtY([], 100)).toBe(-1);
    expect(indexAtY([], 100, 2)).toBe(2);
    expect(indexAtY(null, 100, 7)).toBe(7);
  });
});

/** A pointer event, as much of one as the controller reads. */
const ev = (type, y, id = 1) => ({
  type, clientY: y, pointerId: id,
  currentTarget: { setPointerCapture: vi.fn() },
  preventDefault: vi.fn(), stopPropagation: vi.fn(),
});

/** A host that counts its redraws, and rows that are what they are told. */
const bench = (n) => {
  const host = { redraws: 0, requestUpdate() { this.redraws += 1; } };
  const move = vi.fn();
  const list = rows(n).map(r => ({ getBoundingClientRect: () => r }));
  return { host, move, r: new ListReorder(host, { rows: () => list, move }) };
};

describe('carrying a row to another place', () => {
  it('moves it where it was let go', () => {
    const { r, move } = bench(4);
    r.down(ev('pointerdown', 110), 0);
    r.over(ev('pointermove', 250));
    r.up(ev('pointerup', 250));
    expect(move).toHaveBeenCalledWith(0, 3, null);
  });

  it('does nothing where it was let go over itself', () => {
    const { r, move } = bench(4);
    r.down(ev('pointerdown', 110), 0);
    r.over(ev('pointermove', 120));
    r.up(ev('pointerup', 120));
    expect(move).not.toHaveBeenCalled();
  });

  it('does nothing when the gesture is taken away', () => {
    const { r, move } = bench(4);
    r.down(ev('pointerdown', 110), 0);
    r.over(ev('pointermove', 250));
    r.up(ev('pointercancel', 250));
    expect(move).not.toHaveBeenCalled();
    expect(r.held).toBe(null);
  });

  it('hears only the pointer that took the row', () => {
    const { r, move } = bench(4);
    r.down(ev('pointerdown', 110), 0);
    r.over(ev('pointermove', 250, 2));
    r.up(ev('pointerup', 250, 2));
    expect(move).not.toHaveBeenCalled();
    r.up(ev('pointerup', 110, 1));
    expect(move).not.toHaveBeenCalled();
  });

  it('ignores a move or a release nobody started', () => {
    const { r, move, host } = bench(4);
    r.over(ev('pointermove', 250));
    r.up(ev('pointerup', 250));
    expect(move).not.toHaveBeenCalled();
    expect(host.redraws).toBe(0);
  });

  it('says which row is carried and which is the place', () => {
    const { r } = bench(4);
    r.down(ev('pointerdown', 110), 0);
    r.over(ev('pointermove', 250));
    expect(r.lifted(0)).toBe(true);
    expect(r.target(3)).toBe(true);
    expect(r.target(0)).toBe(false);
    expect(r.lifted(3)).toBe(false);
  });

  it('marks no place while the row is still over itself', () => {
    const { r } = bench(4);
    r.down(ev('pointerdown', 110), 0);
    expect(r.lifted(0)).toBe(true);
    expect(r.target(0)).toBe(false);
  });

  it('redraws when the place changes, and not for every move', () => {
    const { r, host } = bench(4);
    r.down(ev('pointerdown', 110), 0);
    const after = host.redraws;
    r.over(ev('pointermove', 250));
    r.over(ev('pointermove', 252));
    expect(host.redraws).toBe(after + 1);
  });

  it('keeps two lists of one host apart', () => {
    const { r } = bench(4);
    r.down(ev('pointerdown', 110), 0, 'a');
    expect(r.lifted(0, 'a')).toBe(true);
    expect(r.lifted(0, 'b')).toBe(false);
    expect(r.lifted(0)).toBe(false);
  });

  it('hands the list back to the mover it came from', () => {
    const { r, move } = bench(4);
    r.down(ev('pointerdown', 110), 1, 'sectors:2');
    r.over(ev('pointermove', 110));
    r.up(ev('pointerup', 110));
    expect(move).toHaveBeenCalledWith(1, 0, 'sectors:2');
  });

  it('takes the press off the row it sits in', () => {
    const { r } = bench(2);
    const down = ev('pointerdown', 110);
    r.down(down, 0);
    expect(down.preventDefault).toHaveBeenCalled();
    expect(down.stopPropagation).toHaveBeenCalled();
    expect(down.currentTarget.setPointerCapture).toHaveBeenCalledWith(1);
  });
});
