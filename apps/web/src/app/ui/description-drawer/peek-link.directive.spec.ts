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
    click(link, { ctrlKey: true });
    click(link, { shiftKey: true });
    click(link, { metaKey: true });
    expect(peek.current()).toBeNull();
  });
});
