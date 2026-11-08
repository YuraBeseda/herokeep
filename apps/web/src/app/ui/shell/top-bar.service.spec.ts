import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { TopBarService, type TopBarConfig } from './top-bar.service';

@Component({ template: '' })
class Stub {}

const config: TopBarConfig = { title: 'Aldric' };

async function setup(guard?: () => boolean) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'c/:id/:tab', component: Stub },
        { path: 'library', component: Stub },
        { path: 'guarded', component: Stub, canActivate: [guard ?? (() => false)] },
      ]),
    ],
  });
  const router = TestBed.inject(Router);
  const service = TestBed.inject(TopBarService);
  await router.navigateByUrl('/c/1/play');
  return { router, service };
}

describe('TopBarService', () => {
  it('starts empty, sets and clears', async () => {
    const { service } = await setup();
    expect(service.config()).toBeNull();
    service.set(config);
    expect(service.config()).toBe(config);
    service.clear();
    expect(service.config()).toBeNull();
  });

  it('clears on navigation to another path when unscoped', async () => {
    const { router, service } = await setup();
    service.set(config);
    await router.navigateByUrl('/c/1/spells');
    expect(service.config()).toBeNull();
  });

  it('survives navigation inside its scope and clears outside it', async () => {
    const { router, service } = await setup();
    const scoped: TopBarConfig = { title: 'Aldric', scope: ['/c', '1'] };
    service.set(scoped);
    await router.navigateByUrl('/c/1/spells');
    expect(service.config()).toBe(scoped);
    await router.navigateByUrl('/library');
    expect(service.config()).toBeNull();
  });

  it('is not kept for another hero that merely shares a prefix string', async () => {
    const { router, service } = await setup();
    service.set({ title: 'Aldric', scope: ['/c', '1'] });
    await router.navigateByUrl('/c/12/play');
    expect(service.config()).toBeNull();
  });

  it('puts a scoped config back when the navigation is refused', async () => {
    const { router, service } = await setup();
    const scoped: TopBarConfig = { title: 'Aldric', scope: ['/c', '1'] };
    service.set(scoped);
    await router.navigateByUrl('/guarded');
    expect(service.config()).toBe(scoped);
  });
});
