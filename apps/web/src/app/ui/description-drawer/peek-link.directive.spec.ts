import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterLink } from '@angular/router';
import { HkPeekLinkDirective } from './peek-link.directive';
import { PeekService } from './peek.service';

@Component({
  imports: [RouterLink, HkPeekLinkDirective],
  template: `<a [routerLink]="['/library', 'p:x/a']" [hkPeek]="id" [attr.aria-label]="id"></a>`,
})
class Host {
  readonly id = 'p:x/a';
}

describe('HkPeekLinkDirective', () => {
  function setup() {
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: '**', component: Host }])],
    });
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const link = (fixture.nativeElement as HTMLElement).querySelector('a')!;
    return {
      link,
      peek: TestBed.inject(PeekService),
      nav: vi.spyOn(TestBed.inject(Router), 'navigateByUrl'),
    };
  }
  const click = (link: HTMLElement, init: MouseEventInit = {}) =>
    link.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init }),
    );

  it('a plain click peeks and does not navigate', () => {
    const { link, peek, nav } = setup();
    click(link);
    expect(peek.current()?.entityId).toBe('p:x/a');
    expect(peek.current()?.opener).toBe(link);
    expect(nav).not.toHaveBeenCalled();
  });

  it('ctrl and shift clicks leave navigation alone', () => {
    const { link, peek } = setup();
    // dispatchEvent returns true when nothing prevented the default: the browser still navigates.
    expect(click(link, { ctrlKey: true })).toBe(true);
    expect(click(link, { shiftKey: true })).toBe(true);
    expect(click(link, { metaKey: true })).toBe(true);
    expect(peek.current()).toBeNull();
  });

  it('Enter on the focused link peeks (the browser turns Enter into a plain click)', () => {
    const { link, peek } = setup();
    link.click();
    expect(peek.current()?.entityId).toBe('p:x/a');
  });
});
