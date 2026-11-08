import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivationEnd, provideRouter, Router } from '@angular/router';
import { ActionStrapService, type StrapConfig } from './action-strap.service';

@Component({ template: '' })
class Stub {}

const config: StrapConfig = {
  primary: [
    { id: 'roll', label: 'shell.icon.roll', icon: 'roll', kind: 'primary', run: () => undefined },
  ],
};

async function setup(guard?: () => boolean) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'a', component: Stub },
        { path: 'b', component: Stub },
        { path: 'c/:id/:tab', component: Stub },
        { path: 'library', component: Stub },
        { path: 'guarded', component: Stub, canActivate: [guard ?? (() => false)] },
      ]),
    ],
  });
  const router = TestBed.inject(Router);
  const service = TestBed.inject(ActionStrapService);
  await router.navigateByUrl('/a');
  return { router, service };
}

describe('ActionStrapService', () => {
  it('starts with no strap', async () => {
    const { service } = await setup();
    expect(service.config()).toBeNull();
  });

  it('sets and clears', async () => {
    const { service } = await setup();
    service.set(config);
    expect(service.config()).toBe(config);
    service.clear();
    expect(service.config()).toBeNull();
  });

  it('clears itself when navigation starts to a different route', async () => {
    const { router, service } = await setup();
    service.set(config);
    await router.navigateByUrl('/b');
    expect(service.config()).toBeNull();
  });

  it('keeps the strap through a query-only or fragment-only navigation', async () => {
    const { router, service } = await setup();
    service.set(config);
    await router.navigateByUrl('/a?tab=2');
    await router.navigateByUrl('/a?tab=2#x');
    expect(service.config()).toBe(config);
  });

  it('lets the next screen set its own strap during navigation without losing it', async () => {
    const { router, service } = await setup();
    service.set(config);
    const next: StrapConfig = { primary: [{ ...config.primary[0], id: 'next' }] };
    router.events.subscribe((event) => {
      if (event instanceof ActivationEnd) service.set(next);
    });
    await router.navigateByUrl('/b');
    expect(service.config()).toBe(next);
  });

  it('puts the strap back when the navigation is refused', async () => {
    const { router, service } = await setup();
    service.set(config);
    await router.navigateByUrl('/guarded');
    expect(service.config()).toBe(config);
  });

  describe('with a scope', () => {
    const scoped = (): StrapConfig => ({ ...config, scope: ['/c', '1'] });

    it('survives navigation between tabs inside the scope', async () => {
      const { router, service } = await setup();
      await router.navigateByUrl('/c/1/play');
      const cfg = scoped();
      service.set(cfg);
      await router.navigateByUrl('/c/1/spells');
      expect(service.config()).toBe(cfg);
    });

    it('is cleared when navigation leaves the scope', async () => {
      const { router, service } = await setup();
      await router.navigateByUrl('/c/1/play');
      service.set(scoped());
      await router.navigateByUrl('/library');
      expect(service.config()).toBeNull();
    });

    it('does not treat another hero sharing a prefix string as inside the scope', async () => {
      const { router, service } = await setup();
      await router.navigateByUrl('/c/1/play');
      service.set(scoped());
      await router.navigateByUrl('/c/12/play');
      expect(service.config()).toBeNull();
    });

    it('still restores the strap when a navigation out of the scope is refused', async () => {
      const { router, service } = await setup();
      await router.navigateByUrl('/c/1/play');
      const cfg = scoped();
      service.set(cfg);
      await router.navigateByUrl('/guarded');
      expect(service.config()).toBe(cfg);
    });
  });
});
