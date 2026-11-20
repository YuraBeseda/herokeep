import {
  Component,
  createEnvironmentInjector,
  EnvironmentInjector,
  inject,
  Injector,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PeekService } from './peek.service';

@Component({ selector: 'app-peek-caller', template: '' })
class Caller {
  readonly injector = inject(Injector);
  constructor() {
    inject(PeekService).open('pack:feature/a', undefined, { injector: this.injector });
  }
}

@Component({
  imports: [Caller],
  template: `@if (shown()) {
    <app-peek-caller />
  }`,
})
class Page {
  readonly shown = signal(true);
}

describe('PeekService', () => {
  const setup = () => TestBed.inject(PeekService);

  it('starts closed', () => {
    expect(setup().current()).toBeNull();
  });

  it('opens an entity with its opener', () => {
    const peek = setup();
    const opener = document.createElement('button');
    peek.open('pack:feature/a', opener);
    expect(peek.current()).toEqual({ entityId: 'pack:feature/a', opener });
  });

  it('opening another entity replaces the content and keeps the first opener', () => {
    const peek = setup();
    const opener = document.createElement('button');
    peek.open('pack:feature/a', opener);
    peek.open('pack:feature/b');
    expect(peek.current()).toEqual({ entityId: 'pack:feature/b', opener });
  });

  it('a new opener replaces the old one', () => {
    const peek = setup();
    const first = document.createElement('button');
    const second = document.createElement('button');
    peek.open('pack:feature/a', first);
    peek.open('pack:feature/b', second);
    expect(peek.current()?.opener).toBe(second);
  });

  it('carries the context, and close clears it', () => {
    const peek = setup();
    const ctx = { injector: Injector.create({ providers: [] }) };
    peek.open('pack:feature/a', undefined, ctx);
    expect(peek.current()?.ctx).toBe(ctx);
    peek.close();
    expect(peek.current()).toBeNull();
  });

  it('closes when the caller that opened it is destroyed', () => {
    const peek = setup();
    const injector = createEnvironmentInjector([], TestBed.inject(EnvironmentInjector));
    peek.open('pack:feature/a', undefined, { injector });
    injector.destroy();
    expect(peek.current()).toBeNull();
  });

  it('closes when the component that opened it leaves the page (its @if flips)', async () => {
    const fixture = TestBed.createComponent(Page);
    await fixture.whenStable();
    const peek = TestBed.inject(PeekService);
    expect(peek.current()?.entityId).toBe('pack:feature/a');
    fixture.componentInstance.shown.set(false);
    await fixture.whenStable();
    expect(peek.current()).toBeNull();
  });

  it('a later open drops the earlier caller hook: destroying it no longer closes the peek', () => {
    const peek = setup();
    const first = createEnvironmentInjector([], TestBed.inject(EnvironmentInjector));
    peek.open('pack:feature/a', undefined, { injector: first });
    peek.open('pack:feature/b');
    first.destroy();
    expect(peek.current()?.entityId).toBe('pack:feature/b');
  });
});
