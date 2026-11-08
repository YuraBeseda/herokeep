import { Component } from '@angular/core';

/**
 * `hk-textures` — render ONCE in the app shell. One hidden zero-size SVG that defines the three
 * `feTurbulence` filters (wood grain, parchment fibre, leather) every surface texture refers to
 * through `url(#hkWood)` and friends; see `src/styles/textures.scss` for the `.hk-tex` overlays.
 * It carries no data and no text.
 */
@Component({
  selector: 'hk-textures',
  template: `
    <svg aria-hidden="true" focusable="false" width="0" height="0">
      <filter id="hkWood" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.0022 0.055"
          numOctaves="5"
          seed="9"
          result="n"
        />
        <feColorMatrix
          in="n"
          type="matrix"
          values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1.7 -0.55"
          result="a"
        />
        <feComposite in="SourceGraphic" in2="a" operator="in" />
      </filter>
      <filter
        id="hkPaper"
        x="0"
        y="0"
        width="100%"
        height="100%"
        color-interpolation-filters="sRGB"
      >
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="3" result="n" />
        <feColorMatrix
          in="n"
          type="matrix"
          values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
          result="a"
        />
        <feComposite in="SourceGraphic" in2="a" operator="in" />
      </filter>
      <filter
        id="hkLeather"
        x="0"
        y="0"
        width="100%"
        height="100%"
        color-interpolation-filters="sRGB"
      >
        <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="3" seed="5" result="n" />
        <feColorMatrix
          in="n"
          type="matrix"
          values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
          result="a"
        />
        <feComposite in="SourceGraphic" in2="a" operator="in" />
      </filter>
    </svg>
  `,
  styles: `
    :host {
      position: absolute;
      inline-size: 0;
      block-size: 0;
      overflow: hidden;
    }
  `,
})
export class HkTexturesComponent {}
