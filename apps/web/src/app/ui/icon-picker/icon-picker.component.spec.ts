import { TestBed } from '@angular/core/testing';
import type { ItemIconRef } from '@hk/protocol';
import { ImagePipelineService } from '../../shared/services/images/image-pipeline.service';
import { typeInto } from '../testing/harness';
import { provideShellTransloco } from '../testing/transloco-testing';
import { IconPickerComponent } from './icon-picker.component';

async function mountPicker(inputs: { used?: string[]; value?: ItemIconRef | null } = {}) {
  const encodeIcon = vi.fn().mockResolvedValue({ hash: `sha256:${'a'.repeat(64)}` });
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    providers: [provideShellTransloco(), { provide: ImagePipelineService, useValue: { encodeIcon } }],
  }).compileComponents();
  const fixture = TestBed.createComponent(IconPickerComponent);
  fixture.componentRef.setInput('used', inputs.used ?? []);
  fixture.componentRef.setInput('value', inputs.value ?? null);
  const picked: ItemIconRef[] = [];
  fixture.componentInstance.picked.subscribe((ref) => picked.push(ref));
  await fixture.whenStable();
  return { fixture, el: fixture.nativeElement as HTMLElement, encodeIcon, picked };
}

function glyphNames(el: HTMLElement): string[] {
  return Array.from(el.querySelectorAll<HTMLButtonElement>('.hk-icon-picker__glyph')).map(
    (b) => b.getAttribute('aria-label') ?? '',
  );
}

describe('IconPickerComponent', () => {
  afterEach(() => vi.useRealTimers());

  it("lists the hero's used glyphs first, then the sprite's game icons without repeats", async () => {
    const { el } = await mountPicker({ used: ['shield', 'lyre'] });
    const names = glyphNames(el);
    expect(names.slice(0, 2)).toEqual(['shield', 'lyre']);
    expect(names.filter((n) => n === 'lyre')).toHaveLength(1);
    expect(names.length).toBeGreaterThan(50);
    expect(el.querySelectorAll('[role="group"]').length).toBe(2);
  });

  it('filters the glyphs by the search text', async () => {
    const { fixture, el } = await mountPicker({ used: ['shield'] });
    vi.useFakeTimers();
    typeInto(el.querySelector<HTMLInputElement>('input[type="search"]')!, 'crystal');
    vi.advanceTimersByTime(150);
    fixture.detectChanges();
    const names = glyphNames(el);
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((n) => n.includes('crystal'))).toBe(true);
  });

  it('marks the chosen glyph pressed and emits a gi ref on click', async () => {
    const { el, picked } = await mountPicker({ used: ['shield'], value: { kind: 'gi', id: 'shield' } });
    const ring = el.querySelector<HTMLButtonElement>('.hk-icon-picker__glyph[aria-label="shield"]')!;
    expect(ring.getAttribute('aria-pressed')).toBe('true');
    ring.click();
    expect(picked).toEqual([{ kind: 'gi', id: 'shield' }]);
  });

  it('"Upload your own" runs the image pipeline and emits a blob ref', async () => {
    const { el, encodeIcon, picked } = await mountPicker();
    const input = el.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File([new Uint8Array([1])], 'rune.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(picked).toHaveLength(1));
    expect(encodeIcon).toHaveBeenCalledWith(file);
    expect(picked[0]).toEqual({ kind: 'blob', hash: `sha256:${'a'.repeat(64)}` });
  });
});
