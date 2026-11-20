import { TestBed } from '@angular/core/testing';
import { PeekService } from './peek.service';

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

  it('close clears it', () => {
    const peek = setup();
    peek.open('pack:feature/a');
    peek.close();
    expect(peek.current()).toBeNull();
  });
});
