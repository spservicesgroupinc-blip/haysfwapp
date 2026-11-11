import React from 'react';

/**
 * Hays + Sons brand lockup.
 *
 * The identity is a red vertical bar paired with a heavy black plus — the "H+"
 * mark — followed by the "Hays+Sons" wordmark. This is a faithful vector
 * reconstruction of the supplied brand artwork: no rounded container and no
 * white-on-red glyph, so the app, the PDFs and the icons all render the same
 * mark.
 *
 * Geometry note: the bar and the plus are the same height and share a single
 * stroke width, and the plus crossbar runs flush into the bar — there is no gap
 * between them. That connection is what makes bar + crossbar + stem read as an
 * "H" while the stem + crossbar read as a "+".
 *
 * If the crossbar is ever pulled clear of the bar the mark stops working, so the
 * three rectangles below are the one place this geometry is defined.
 */

/** Brand red — single source of truth. Mirrored by COLOR_RED in pdfService.ts. */
export const BRAND_RED = '#DC2626';
/** Logo ink — the plus and the wordmark deliberately share one near-black. */
export const BRAND_INK = '#1A1A1A';

/** Mark canvas, in viewBox units: a horizontal "H+" 65 wide by 42 tall. */
const MARK_W = 65;
const MARK_H = 42;

export interface BrandLogoProps {
  /** Height of the mark in pixels. The wordmark and sub-label scale with it. */
  size?: number;
  /** Render the "Hays+Sons" wordmark beside the mark. */
  withWordmark?: boolean;
  /** Optional sub-label stacked under the wordmark. */
  sublabel?: string;
  /** Extra classes for the sub-label line (e.g. hide it below a breakpoint). */
  sublabelClassName?: string;
  /** Use on dark surfaces: the plus and wordmark switch to white. */
  tone?: 'default' | 'inverted';
  className?: string;
}

/** Accessible name for the mark; the wordmark text is presentational. */
export const BRAND_NAME = 'Hays+Sons';

export const BrandLogo: React.FC<BrandLogoProps> = ({
  size = 34,
  withWordmark = true,
  sublabel,
  sublabelClassName = '',
  tone = 'default',
  className = '',
}) => {
  const inverted = tone === 'inverted';

  // The near-black plus needs to become white on dark surfaces; brand red holds.
  const ink = inverted ? '#FFFFFF' : BRAND_INK;
  const wordmarkColor = inverted ? '#FFFFFF' : BRAND_INK;
  const sublabelColor = inverted ? '#94A3B8' : '#64748B';

  // Chosen so the default size (34) reproduces the long-standing 15px / 11px
  // header type scale.
  const wordmarkSize = Math.round(size * 0.44);
  const sublabelSize = Math.max(10, Math.round(size * 0.31));

  return (
    <div className={`flex items-center gap-2.5 min-w-0 ${className}`}>
      <svg
        width={Math.round((size * MARK_W) / MARK_H)}
        height={size}
        viewBox={`0 0 ${MARK_W} ${MARK_H}`}
        role="img"
        aria-label={BRAND_NAME}
        className="shrink-0"
      >
        {/* Red bar — the left stem of the mark, and the reference height: the
            plus is exactly as tall as it is. */}
        <rect x="0" y="0" width="14" height="42" fill={BRAND_RED} />
        {/* Black plus — vertical stem, and a crossbar that meets the red bar. */}
        <rect x="36" y="0" width="14" height="42" fill={ink} />
        <rect x="14" y="14" width="51" height="14" fill={ink} />
      </svg>

      {withWordmark && (
        <div className="min-w-0 leading-tight">
          <p
            className="font-extrabold tracking-tight truncate"
            style={{ fontSize: wordmarkSize, color: wordmarkColor }}
          >
            {BRAND_NAME}
          </p>
          {sublabel ? (
            <p
              className={`truncate ${sublabelClassName}`}
              style={{ fontSize: sublabelSize, color: sublabelColor }}
            >
              {sublabel}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
};
