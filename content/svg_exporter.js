/**
 * SnapCraft SVG Exporter Module
 * 
 * Compiles DOM elements directly into 100% PURE NATIVE SVG elements:
 * - Cards, badges, buttons -> <rect rx="..." ry="..." fill="..." stroke="...">
 * - Progress rings, circles -> <circle cx="..." cy="..." r="..."> with computed stroke/dasharray
 * - Icons, checkmarks, SVG shapes -> inlined with resolved currentColor & stroke/fill
 * - Multiline text -> detected at character precision (spaces, hyphens, word breaks)
 * - Whitespace normalization -> eliminates runaway spaces pushing text off-screen
 * - Inputs & textareas -> rendered with values or placeholders
 * 
 * ZERO <foreignObject> dependencies. Immune to browser <img> sandboxing.
 */

window.SnapCraftSVG = (function () {

  /**
   * Export target DOM element as pure native SVG string
   * @param {HTMLElement|SVGElement} element - Target element
   * @param {Object} options - Export options
   * @returns {Promise<string>} Clean SVG XML
   */
  async function exportToSVG(element, options = {}) {
    if (!element) return '';

    const rootRect = element.getBoundingClientRect();
    const width = Math.max(1, Math.round(rootRect.width));
    const height = Math.max(1, Math.round(rootRect.height));

    // Case 1: Target element is already an SVG node
    if (element.tagName.toLowerCase() === 'svg' || element.ownerSVGElement) {
      return exportNativeSVG(element, width, height, options);
    }

    // Case 2: Convert DOM tree directly to Native SVG shapes (<rect>, <circle>, <path>, <text>)
    return exportDomToNativeSvg(element, rootRect, width, height, options);
  }

  /**
   * Climbs up the DOM tree to locate the true rendered background color of the UI
   * rather than returning transparent if the selected container doesn't specify one.
   */
  function findEffectiveBackgroundColor(element) {
    let curr = element;
    while (curr && curr !== document.documentElement) {
      const cs = window.getComputedStyle(curr);
      const bg = cs.backgroundColor;
      const parsed = parseCssColor(bg);
      if (parsed.a > 0.1) {
        return bg;
      }
      curr = curr.parentElement;
    }
    const htmlBg = window.getComputedStyle(document.documentElement).backgroundColor;
    const parsedHtml = parseCssColor(htmlBg);
    if (parsedHtml.a > 0.1) return htmlBg;
    const bodyBg = window.getComputedStyle(document.body).backgroundColor;
    const parsedBody = parseCssColor(bodyBg);
    if (parsedBody.a > 0.1) return bodyBg;
    return '#1e2530'; // Sensible dark background fallback
  }

  /**
   * Converts a DOM tree into native vector SVG elements without foreignObject
   */
  async function exportDomToNativeSvg(rootElement, rootRect, width, height, options) {
    const layerContainerBg = []; // 1. Large container backgrounds (behind everything)
    const layerRowBg = [];       // 2. Table row backgrounds / timeline row tints
    const layerGrid = [];        // 3. Grid lines, column borders, row dividers, accent stripes
    const layerComponents = [];  // 4. Cards, appointment pills, avatar circles, buttons, badges
    const layerMedia = [];       // 5. Inlined SVGs, Images, Canvas
    const layerText = [];        // 6. Multiline text, inputs, textarea values
    const layerPseudos = [];     // 7. Pseudo elements (knobs, checkmarks)
    const defsElements = [];

    // Background color of the capture
    let bgColor = 'transparent';
    if (!options || !options.transparentBg) {
      const rawBg = findEffectiveBackgroundColor(rootElement);
      const parsedRaw = parseCssColor(rawBg);
      // Guarantee solid opaque background so grid lines and semi-transparent row tints are crisp
      if (parsedRaw.a < 1 && parsedRaw.a > 0) {
        // Blend over dark slate base (#0e1424: r=14, g=20, b=36)
        const baseR = 14, baseG = 20, baseB = 36;
        const finalR = Math.round(parsedRaw.r * parsedRaw.a + baseR * (1 - parsedRaw.a));
        const finalG = Math.round(parsedRaw.g * parsedRaw.a + baseG * (1 - parsedRaw.a));
        const finalB = Math.round(parsedRaw.b * parsedRaw.a + baseB * (1 - parsedRaw.a));
        bgColor = `rgb(${finalR}, ${finalG}, ${finalB})`;
      } else if (parsedRaw.a === 1) {
        bgColor = `rgb(${parsedRaw.r}, ${parsedRaw.g}, ${parsedRaw.b})`;
      } else {
        bgColor = '#0e1424'; // Default dark UI canvas
      }
    }

    // Walk the DOM tree and convert each visual node to native SVG
    async function processNode(node) {
      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
        return;
      }

      const rect = node.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;

      const relX = Math.round((rect.left - rootRect.left) * 100) / 100;
      const relY = Math.round((rect.top - rootRect.top) * 100) / 100;
      const relW = Math.round(rect.width * 100) / 100;
      const relH = Math.round(rect.height * 100) / 100;

      const tagName = node.tagName.toLowerCase();

      // Sub-case A: Node is an SVG element (e.g. icon, progress ring, checkmark, close button)
      if (tagName === 'svg') {
        const clonedSvg = node.cloneNode(true);
        dereferenceSvgUse(clonedSvg);

        // Resolve all computed styles (stroke, fill, currentColor, dasharray) into explicit SVG attributes
        inlineSvgNodeStyles(node, clonedSvg);

        const viewBox = clonedSvg.getAttribute('viewBox') || `0 0 ${relW} ${relH}`;
        let innerContent = clonedSvg.innerHTML;

        layerMedia.push(`
  <!-- Inlined Vector Component: ${node.className || 'vector'} -->
  <g transform="translate(${relX}, ${relY})">
    <svg width="${relW}" height="${relH}" viewBox="${viewBox}" style="overflow: visible;">
      ${innerContent}
    </svg>
  </g>`);
        return; // Don't traverse inside SVG children as HTML
      }

      // Sub-case B: Node is an <img>
      if (tagName === 'img') {
        const src = node.getAttribute('src');
        if (src) {
          const dataUrl = await toDataUrl(src);
          layerMedia.push(`  <image x="${relX}" y="${relY}" width="${relW}" height="${relH}" href="${dataUrl}"/>`);
        }
        return;
      }

      // Sub-case B2: Node is a <canvas> (e.g. background grid or chart)
      if (tagName === 'canvas') {
        try {
          const canvasData = node.toDataURL('image/png');
          if (canvasData && canvasData.length > 30) {
            layerMedia.push(`  <image x="${relX}" y="${relY}" width="${relW}" height="${relH}" href="${canvasData}"/>`);
          }
        } catch (e) {
          console.warn('[SnapCraft] Canvas export skipped:', e);
        }
        return;
      }

      // Sub-case C: HTML Container -> Extract background, border, border-radius as native shapes
      const bg = style.backgroundColor;
      const parsedBg = parseCssColor(bg);
      const hasBg = parsedBg.a > 0;

      // 4-side independent border extraction
      const bwTop = parseFloat(style.borderTopWidth) || 0;
      const bcTop = style.borderTopColor;
      const bsTop = style.borderTopStyle;
      const hasTop = bwTop > 0 && bsTop !== 'none' && parseCssColor(bcTop).a > 0;

      const bwRight = parseFloat(style.borderRightWidth) || 0;
      const bcRight = style.borderRightColor;
      const bsRight = style.borderRightStyle;
      const hasRight = bwRight > 0 && bsRight !== 'none' && parseCssColor(bcRight).a > 0;

      const bwBottom = parseFloat(style.borderBottomWidth) || 0;
      const bcBottom = style.borderBottomColor;
      const bsBottom = style.borderBottomStyle;
      const hasBottom = bwBottom > 0 && bsBottom !== 'none' && parseCssColor(bcBottom).a > 0;

      const bwLeft = parseFloat(style.borderLeftWidth) || 0;
      const bcLeft = style.borderLeftColor;
      const bsLeft = style.borderLeftStyle;
      const hasLeft = bwLeft > 0 && bsLeft !== 'none' && parseCssColor(bcLeft).a > 0;

      const hasAnyBorder = hasTop || hasRight || hasBottom || hasLeft;

      const allBordersEqual = (
        hasTop && hasRight && hasBottom && hasLeft &&
        Math.abs(bwTop - bwRight) < 0.5 &&
        Math.abs(bwRight - bwBottom) < 0.5 &&
        Math.abs(bwBottom - bwLeft) < 0.5 &&
        isSameColor(bcTop, bcRight) && isSameColor(bcRight, bcBottom) && isSameColor(bcBottom, bcLeft)
      );

      // Corner radii
      const maxRadius = Math.min(relW / 2, relH / 2);
      const rTopLeft = Math.min(parseFloat(style.borderTopLeftRadius) || 0, maxRadius);
      const rTopRight = Math.min(parseFloat(style.borderTopRightRadius) || 0, maxRadius);
      const rBottomRight = Math.min(parseFloat(style.borderBottomRightRadius) || 0, maxRadius);
      const rBottomLeft = Math.min(parseFloat(style.borderBottomLeftRadius) || 0, maxRadius);

      const allRadiiEqual = (
        Math.abs(rTopLeft - rTopRight) < 0.5 &&
        Math.abs(rTopRight - rBottomRight) < 0.5 &&
        Math.abs(rBottomRight - rBottomLeft) < 0.5
      );

      const opacAttr = style.opacity && style.opacity !== '1' ? ` opacity="${style.opacity}"` : '';

      // Check whether this background is redundant or an overlay that would wipe out rows
      const isFullCanvas = relW >= width * 0.95 && relH >= height * 0.95;
      const isTallColumn = relH >= height * 0.4 && relW < width * 0.4;
      const isSameAsCanvas = isSameColor(bg, bgColor);

      let skipBgFill = false;
      if ((isFullCanvas || isTallColumn) && isSameAsCanvas && !hasAnyBorder) {
        skipBgFill = true;
      }

      // Component, Pill, Badge, Avatar, Header identification
      const hasBorderRadius = (rTopLeft >= 3 || rTopRight >= 3 || rBottomRight >= 3 || rBottomLeft >= 3);
      const isButtonOrBadge = (
        tagName === 'button' ||
        node.getAttribute('role') === 'button' ||
        (node.className && typeof node.className === 'string' && (
          node.className.includes('badge') ||
          node.className.includes('pill') ||
          node.className.includes('avatar') ||
          node.className.includes('event') ||
          node.className.includes('Header') ||
          node.className.includes('header') ||
          node.className.includes('Corner')
        ))
      );
      const isPill = hasBorderRadius && relW < width * 0.8 && relH < height * 0.25;

      // Row or Row Tint identification
      const isWideBand = relW >= width * 0.35 && relH <= height * 0.35;
      const isTintedColor = (
        parsedBg.a > 0 &&
        (Math.max(parsedBg.r, parsedBg.g, parsedBg.b) - Math.min(parsedBg.r, parsedBg.g, parsedBg.b) > 15 ||
         (parsedBg.a < 0.85 && (parsedBg.r > 40 || parsedBg.g > 40 || parsedBg.b > 40)))
      );

      // Classify into appropriate visual layer
      let targetBgLayer = layerContainerBg;
      if (isPill || isButtonOrBadge) {
        targetBgLayer = layerComponents;
      } else if (isWideBand || isTintedColor) {
        targetBgLayer = layerRowBg;
      }

      // 1. Draw Background Fill
      if (!skipBgFill && hasBg) {
        const fillAttr = formatSvgFill(bg);
        if (allRadiiEqual) {
          const rxAttr = rTopLeft > 0 ? ` rx="${rTopLeft}" ry="${rTopLeft}"` : '';
          targetBgLayer.push(`  <rect x="${relX}" y="${relY}" width="${relW}" height="${relH}"${rxAttr} ${fillAttr}${opacAttr}/>`);
        } else {
          const pathD = buildSvgRoundedRectPath(relX, relY, relW, relH, rTopLeft, rTopRight, rBottomRight, rBottomLeft);
          targetBgLayer.push(`  <path d="${pathD}" ${fillAttr}${opacAttr}/>`);
        }
      }

      // 2. Draw Borders (always in layerGrid or layerComponents so they sit ON TOP of background fills)
      if (hasAnyBorder) {
        if (allBordersEqual) {
          const strokeAttr = formatSvgStroke(bcTop, bwTop);
          const borderTargetLayer = (isPill || isButtonOrBadge) ? layerComponents : layerGrid;
          if (allRadiiEqual) {
            const rxAttr = rTopLeft > 0 ? ` rx="${rTopLeft}" ry="${rTopLeft}"` : '';
            borderTargetLayer.push(`  <rect x="${relX}" y="${relY}" width="${relW}" height="${relH}"${rxAttr} fill="none" ${strokeAttr}${opacAttr}/>`);
          } else {
            const pathD = buildSvgRoundedRectPath(relX, relY, relW, relH, rTopLeft, rTopRight, rBottomRight, rBottomLeft);
            borderTargetLayer.push(`  <path d="${pathD}" fill="none" ${strokeAttr}${opacAttr}/>`);
          }
        } else {
          // Independent borders (grid lines, column dividers, vertical accent stripes)
          if (hasTop) {
            const strokeA = formatSvgStroke(bcTop, bwTop);
            const y = relY + (bwTop / 2);
            layerGrid.push(`  <line x1="${relX}" y1="${y}" x2="${relX + relW}" y2="${y}" ${strokeA}${opacAttr}/>`);
          }
          if (hasRight) {
            const strokeA = formatSvgStroke(bcRight, bwRight);
            const x = relX + relW - (bwRight / 2);
            layerGrid.push(`  <line x1="${x}" y1="${relY}" x2="${x}" y2="${relY + relH}" ${strokeA}${opacAttr}/>`);
          }
          if (hasBottom) {
            const strokeA = formatSvgStroke(bcBottom, bwBottom);
            const y = relY + relH - (bwBottom / 2);
            layerGrid.push(`  <line x1="${relX}" y1="${y}" x2="${relX + relW}" y2="${y}" ${strokeA}${opacAttr}/>`);
          }
          if (hasLeft) {
            const strokeA = formatSvgStroke(bcLeft, bwLeft);
            const x = relX + (bwLeft / 2);
            const lineTarget = (bwLeft >= 2) ? layerComponents : layerGrid;
            lineTarget.push(`  <line x1="${x}" y1="${relY}" x2="${x}" y2="${relY + relH}" ${strokeA}${opacAttr}/>`);
          }
        }
      }

      // 2b. Inset Box-Shadow Accent Stripes (e.g. box-shadow: inset 4px 0 0 var(--row-accent))
      const shadow = style.boxShadow;
      if (shadow && shadow !== 'none' && shadow.includes('inset')) {
        const insetParts = shadow.split(/,(?![^(]*\))/);
        for (const part of insetParts) {
          if (!part.includes('inset')) continue;
          const numMatches = part.match(/([-\d.]+)px\s+([-\d.]+)px(?:\s+([-\d.]+)px)?(?:\s+([-\d.]+)px)?/);
          if (numMatches) {
            const ox = parseFloat(numMatches[1]) || 0;
            const oy = parseFloat(numMatches[2]) || 0;
            const rawCol = part.replace(/inset/gi, '').replace(numMatches[0], '').trim();
            const resolvedCol = resolveCssColor(rawCol, node);
            const fillCol = formatSvgFill(resolvedCol);
            if (ox > 0) {
              layerComponents.push(`  <rect x="${relX}" y="${relY}" width="${ox}" height="${relH}" ${fillCol}${opacAttr}/>`);
            } else if (ox < 0) {
              layerComponents.push(`  <rect x="${relX + relW + ox}" y="${relY}" width="${Math.abs(ox)}" height="${relH}" ${fillCol}${opacAttr}/>`);
            } else if (oy > 0) {
              layerComponents.push(`  <rect x="${relX}" y="${relY}" width="${relW}" height="${oy}" ${fillCol}${opacAttr}/>`);
            } else if (oy < 0) {
              layerComponents.push(`  <rect x="${relX}" y="${relY + relH + oy}" width="${relW}" height="${Math.abs(oy)}" ${fillCol}${opacAttr}/>`);
            }
          }
        }
      }

      // 3. CSS Background Images, Multi-Layer Gradients, Grid Lines & Row Tints
      let rawBgImg = style.backgroundImage;
      if ((!rawBgImg || rawBgImg === 'none') && node.style && node.style.backgroundImage) {
        rawBgImg = node.style.backgroundImage;
      }
      if (rawBgImg && rawBgImg !== 'none') {
        const bgLayers = splitBackgroundLayers(rawBgImg);
        for (const layer of bgLayers) {
          if (layer.includes('gradient(')) {
            const g = parseGradientLayer(layer);
            let handled = false;
            if (g && g.stops.length >= 3) {
              const isVertical = g.direction.includes('to right') || g.direction.includes('90deg');
              const isHorizontal = g.direction.includes('to bottom') || g.direction.includes('180deg');

              // Case A: Thin line gradient (e.g. 4 stops transparent, color, color, transparent with <= 2px gap)
              if (g.stops.length === 4 && g.stops[0].color === 'transparent' && g.stops[3].color === 'transparent' && g.stops[1].color === g.stops[2].color) {
                const totalDim = isVertical ? relW : relH;
                const p1 = parsePosToPx(g.stops[1].pos, totalDim);
                const p2 = parsePosToPx(g.stops[2].pos, totalDim);
                const pos = Math.round(((p1 + p2) / 2) * 10) / 10;
                const resolvedCol = resolveCssColor(g.stops[1].color, node);
                const strokeAttr = formatSvgStroke(resolvedCol, 1);
                if (isVertical) {
                  layerGrid.push(`  <line x1="${relX + pos}" y1="${relY}" x2="${relX + pos}" y2="${relY + relH}" ${strokeAttr}${opacAttr}/>`);
                } else {
                  layerGrid.push(`  <line x1="${relX}" y1="${relY + pos}" x2="${relX + relW}" y2="${relY + pos}" ${strokeAttr}${opacAttr}/>`);
                }
                handled = true;
              } else if (g.stops.length >= 4) {
                // Case B: Discrete bands (e.g. timeline row tints)
                const totalDim = isHorizontal ? relH : relW;
                let foundBands = false;
                for (let i = 0; i < g.stops.length - 1; i++) {
                  const s1 = g.stops[i];
                  const s2 = g.stops[i + 1];
                  if (s1.color === s2.color && s1.color !== 'transparent') {
                    const startPx = parsePosToPx(s1.pos, totalDim);
                    const endPx = parsePosToPx(s2.pos, totalDim);
                    const size = Math.round((endPx - startPx) * 10) / 10;
                    if (size > 0.5) {
                      foundBands = true;
                      const resolvedCol = resolveCssColor(s1.color, node);
                      const fillAttr = formatSvgFill(resolvedCol);
                      if (isHorizontal) {
                        layerRowBg.push(`  <rect x="${relX}" y="${relY + startPx}" width="${relW}" height="${size}" ${fillAttr}${opacAttr}/>`);
                      } else {
                        layerRowBg.push(`  <rect x="${relX + startPx}" y="${relY}" width="${size}" height="${relH}" ${fillAttr}${opacAttr}/>`);
                      }
                    }
                  }
                }
                if (foundBands) handled = true;
              }
            }

            // Case C: Smooth gradient fallback
            if (!handled) {
              const gradId = `grad-${Math.round(relX)}-${Math.round(relY)}-${defsElements.length}`;
              const gradSvg = parseLinearGradientToSvg(layer, gradId, node);
              if (gradSvg) {
                defsElements.push(gradSvg);
                const rxAttr = (allRadiiEqual && rTopLeft > 0) ? ` rx="${rTopLeft}" ry="${rTopLeft}"` : '';
                const targetL = isPill ? layerComponents : (isWideBand || isTintedColor ? layerRowBg : layerContainerBg);
                targetL.push(`  <rect x="${relX}" y="${relY}" width="${relW}" height="${relH}"${rxAttr} fill="url(#${gradId})"${opacAttr}/>`);
              }
            }
          } else {
            // Case D: Background Image URL
            const urlMatch = layer.match(/url\(['"]?(.*?)['"]?\)/);
            if (urlMatch && urlMatch[1]) {
              const imgUrl = urlMatch[1];
              let dataUrl = imgUrl;
              if (!dataUrl.startsWith('data:')) {
                dataUrl = await toDataUrl(imgUrl);
              }
              layerMedia.push(`  <image x="${relX}" y="${relY}" width="${relW}" height="${relH}" href="${escapeXml(dataUrl)}" preserveAspectRatio="xMidYMid meet"/>`);
            }
          }
        }
      }

      // Sub-case D: Inputs & Textarea Values or Placeholders
      if (tagName === 'input' || tagName === 'textarea') {
        const val = node.value || node.getAttribute('placeholder') || '';
        if (val.trim().length > 0) {
          const isPlaceholder = !node.value && node.getAttribute('placeholder');
          const textColor = isPlaceholder ? '#64748b' : style.color;
          const padLeft = !isNaN(parseFloat(style.paddingLeft)) ? parseFloat(style.paddingLeft) : 0;
          const padRight = !isNaN(parseFloat(style.paddingRight)) ? parseFloat(style.paddingRight) : 0;
          const padTop = !isNaN(parseFloat(style.paddingTop)) ? parseFloat(style.paddingTop) : 0;
          const padBottom = !isNaN(parseFloat(style.paddingBottom)) ? parseFloat(style.paddingBottom) : 0;
          const borderLeft = !isNaN(parseFloat(style.borderLeftWidth)) ? parseFloat(style.borderLeftWidth) : 0;
          const borderRight = !isNaN(parseFloat(style.borderRightWidth)) ? parseFloat(style.borderRightWidth) : 0;
          const textAlign = style.textAlign || 'left';
          const fontFamily = style.fontFamily.replace(/"/g, "'");
          const fontSize = parseFloat(style.fontSize) || 14;
          const fontWeight = style.fontWeight || 'normal';

          // Unique clipPath to strictly contain text inside its input/textarea box
          const clipId = `input-clip-${Math.round(relX)}-${Math.round(relY)}`;
          defsElements.push(`    <clipPath id="${clipId}"><rect x="${relX}" y="${relY}" width="${relW}" height="${relH}"/></clipPath>`);

          if (tagName === 'textarea') {
            // Multiline text wrapping for <textarea>
            const availW = Math.max(20, relW - borderLeft - borderRight - padLeft - padRight);
            const fontCss = `${fontWeight} ${fontSize}px ${style.fontFamily}`;
            const wrappedLines = wrapTextToLines(val, availW, fontCss);

            const computedLineHeight = parseFloat(style.lineHeight);
            const lineHeight = (!isNaN(computedLineHeight) && computedLineHeight > 0) ? computedLineHeight : Math.round(fontSize * 1.4);
            const startY = relY + padTop + (fontSize / 2);

            let lineX = relX + borderLeft + padLeft;
            let taAnchorAttr = '';
            if (textAlign === 'right' || textAlign === 'end') {
              lineX = relX + relW - borderRight - padRight;
              taAnchorAttr = ' text-anchor="end"';
            } else if (textAlign === 'center') {
              lineX = relX + borderLeft + padLeft + (availW / 2);
              taAnchorAttr = ' text-anchor="middle"';
            }

            layerText.push(`  <!-- Textarea Wrapped Content -->`);
            layerText.push(`  <g clip-path="url(#${clipId})">`);
            for (let li = 0; li < wrappedLines.length; li++) {
              const lineY = startY + (li * lineHeight);
              // Stop if line extends beyond the bottom padding of the textarea
              if (lineY - (fontSize / 2) > relY + relH - padBottom) break;

              layerText.push(`    <text x="${lineX}" y="${lineY}" font-family="${fontFamily}" font-size="${fontSize}" font-weight="${fontWeight}" fill="${escapeXml(textColor)}" dominant-baseline="central"${taAnchorAttr}>${escapeXml(wrappedLines[li])}</text>`);
            }
            layerText.push('  </g>');
          } else {
            // Single-line inputs: vertically centered, clipped to input boundary, respecting textAlign
            let textX = relX + borderLeft + padLeft;
            let anchorAttr = '';
            if (textAlign === 'right' || textAlign === 'end') {
              textX = relX + relW - borderRight - padRight;
              anchorAttr = ' text-anchor="end"';
            } else if (textAlign === 'center') {
              textX = relX + borderLeft + padLeft + Math.max(0, (relW - borderLeft - borderRight - padLeft - padRight) / 2);
              anchorAttr = ' text-anchor="middle"';
            }

            const textY = relY + (relH / 2);
            layerText.push(`  <g clip-path="url(#${clipId})">`);
            layerText.push(`    <text x="${textX}" y="${textY}" font-family="${fontFamily}" font-size="${fontSize}" font-weight="${fontWeight}" fill="${escapeXml(textColor)}" dominant-baseline="central"${anchorAttr}>${escapeXml(val)}</text>`);
            layerText.push('  </g>');
          }
        }
      }

      // Sub-case E: Process Direct Text Nodes of this Element (with Multiline Support)
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
          const lines = extractLinesFromTextNode(child, rootRect);
          if (lines.length > 0) {
            const fontFamily = style.fontFamily.replace(/"/g, "'");
            const fontSize = style.fontSize;
            const fontWeight = style.fontWeight;
            const color = style.color;
            const letterSpacing = style.letterSpacing !== 'normal' ? `letter-spacing="${style.letterSpacing}"` : '';
            const textTransform = style.textTransform;
            const textAlign = style.textAlign || 'left';

            for (const line of lines) {
              let displayText = line.text;
              if (textTransform === 'uppercase') displayText = displayText.toUpperCase();
              else if (textTransform === 'lowercase') displayText = displayText.toLowerCase();

              let posX = line.x;
              let anchorAttr = '';
              if ((textAlign === 'right' || textAlign === 'end') && line.right !== undefined) {
                posX = line.right;
                anchorAttr = ' text-anchor="end"';
              } else if (textAlign === 'center' && line.centerX !== undefined) {
                posX = line.centerX;
                anchorAttr = ' text-anchor="middle"';
              }

              layerText.push(`  <text x="${posX}" y="${line.y}" font-family="${fontFamily}" font-size="${fontSize}" font-weight="${fontWeight}" fill="${escapeXml(color)}" dominant-baseline="central"${anchorAttr} ${letterSpacing}>${escapeXml(displayText)}</text>`);
            }
          }
        }
      }

      // Sub-case F: Check for CSS Pseudo-Elements (::before or ::after toggle knobs, checkmarks, badges)
      await processPseudoElement(node, '::before', relX, relY, relW, relH, layerPseudos);
      await processPseudoElement(node, '::after', relX, relY, relW, relH, layerPseudos);

      // Recurse through children
      for (const childNode of Array.from(node.children)) {
        await processNode(childNode);
      }
    }

    await processNode(rootElement);

    const rootComputed = window.getComputedStyle(rootElement);
    const fontDefs = await collectBase64Fonts();
    const rootMaxRadius = Math.min(width / 2, height / 2);
    const rRootTL = Math.min(parseFloat(rootComputed.borderTopLeftRadius) || 0, rootMaxRadius);
    const rRootTR = Math.min(parseFloat(rootComputed.borderTopRightRadius) || 0, rootMaxRadius);
    const rRootBR = Math.min(parseFloat(rootComputed.borderBottomRightRadius) || 0, rootMaxRadius);
    const rRootBL = Math.min(parseFloat(rootComputed.borderBottomLeftRadius) || 0, rootMaxRadius);

    const rootAllEqual = (
      Math.abs(rRootTL - rRootTR) < 0.5 &&
      Math.abs(rRootTR - rRootBR) < 0.5 &&
      Math.abs(rRootBR - rRootBL) < 0.5
    );

    let bgShape = '';
    if (bgColor !== 'transparent') {
      const bgFill = formatSvgFill(bgColor);
      if (rootAllEqual) {
        const rootRx = rRootTL > 0 ? `rx="${rRootTL}" ry="${rRootTL}"` : '';
        bgShape = `  <rect width="${width}" height="${height}" ${bgFill} ${rootRx}/>`;
      } else {
        const rootPath = buildSvgRoundedRectPath(0, 0, width, height, rRootTL, rRootTR, rRootBR, rRootBL);
        bgShape = `  <path d="${rootPath}" ${bgFill}/>`;
      }
    }

    const svgMarkup = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" 
     xmlns:xlink="http://www.w3.org/1999/xlink" 
     width="${width}" 
     height="${height}" 
     viewBox="0 0 ${width} ${height}">
  <defs>
    <style type="text/css">
      text {
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        user-select: none;
      }
      ${fontDefs}
    </style>
    ${defsElements.join('\n')}
  </defs>
  <!-- 1. Background Canvas -->
  ${bgShape}
  <!-- 2. Container Backgrounds -->
${layerContainerBg.filter(Boolean).join('\n')}
  <!-- 3. Row Tints & Table Backgrounds -->
${layerRowBg.filter(Boolean).join('\n')}
  <!-- 4. Grid Lines & Dividers -->
${layerGrid.filter(Boolean).join('\n')}
  <!-- 5. Component Cards, Badges & Event Pills -->
${layerComponents.filter(Boolean).join('\n')}
  <!-- 6. Icons, Canvas & Images -->
${layerMedia.filter(Boolean).join('\n')}
  <!-- 7. Foreground Text & Inputs -->
${layerText.filter(Boolean).join('\n')}
  <!-- 8. Interactive Knobs & Pseudo Elements -->
${layerPseudos.filter(Boolean).join('\n')}
</svg>`.trim();

    return svgMarkup;
  }

  /**
   * Extracts lines from a text node.
   * Accurately detects line wraps at any boundary (spaces, hyphens, slashes, word breaks)
   * by measuring rendered character positions and collapses internal whitespace.
   */
  function extractLinesFromTextNode(textNode, rootRect) {
    const rawText = textNode.textContent;
    if (!rawText || rawText.trim().length === 0) return [];

    const range = document.createRange();
    range.selectNodeContents(textNode);
    const rects = range.getClientRects();

    // Fast path: Single line text
    if (rects.length <= 1) {
      let actualStart = 0;
      while (actualStart < rawText.length && /\s/.test(rawText[actualStart])) actualStart++;
      let actualEnd = rawText.length;
      while (actualEnd > actualStart && /\s/.test(rawText[actualEnd - 1])) actualEnd--;

      if (actualEnd <= actualStart) return [];

      range.setStart(textNode, actualStart);
      range.setEnd(textNode, actualEnd);

      const textRect = range.getBoundingClientRect();
      if (textRect.width === 0 || textRect.height === 0) return [];
      const normalized = rawText.slice(actualStart, actualEnd).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
      return [{
        text: normalized,
        x: Math.round((textRect.left - rootRect.left) * 100) / 100,
        right: Math.round((textRect.right - rootRect.left) * 100) / 100,
        centerX: Math.round(((textRect.left + textRect.right) / 2 - rootRect.left) * 100) / 100,
        y: Math.round((textRect.top - rootRect.top + (textRect.height / 2)) * 100) / 100
      }];
    }

    // Multi-line path: Walk characters to find exact line-break indices
    const len = rawText.length;
    const breakIndices = [0];
    let lastTop = null;

    for (let i = 0; i < len; i++) {
      // Only measure visible non-whitespace characters to get true line tops
      if (/\s/.test(rawText[i])) continue;

      range.setStart(textNode, i);
      range.setEnd(textNode, i + 1);
      const charRects = range.getClientRects();
      if (charRects.length === 0) continue;

      const charTop = Math.round(charRects[0].top);

      if (lastTop === null) {
        lastTop = charTop;
      } else if (Math.abs(charTop - lastTop) > 4) {
        // Character i wrapped to a new visual line!
        breakIndices.push(i);
        lastTop = charTop;
      }
    }
    breakIndices.push(len);

    const lines = [];
    for (let b = 0; b < breakIndices.length - 1; b++) {
      const start = breakIndices[b];
      const end = breakIndices[b + 1];
      if (end <= start) continue;

      // Find non-whitespace bounds for accurate range measuring
      let actualStart = start;
      while (actualStart < end && /\s/.test(rawText[actualStart])) actualStart++;
      let actualEnd = end;
      while (actualEnd > actualStart && /\s/.test(rawText[actualEnd - 1])) actualEnd--;

      if (actualEnd <= actualStart) continue;

      range.setStart(textNode, actualStart);
      range.setEnd(textNode, actualEnd);

      const lineRect = range.getBoundingClientRect();
      const lineStr = rawText.slice(actualStart, actualEnd).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();

      if (lineStr.length > 0 && lineRect.width > 0) {
        lines.push({
          text: lineStr,
          x: Math.round((lineRect.left - rootRect.left) * 100) / 100,
          right: Math.round((lineRect.right - rootRect.left) * 100) / 100,
          centerX: Math.round(((lineRect.left + lineRect.right) / 2 - rootRect.left) * 100) / 100,
          y: Math.round((lineRect.top - rootRect.top + (lineRect.height / 2)) * 100) / 100
        });
      }
    }

    return lines;
  }

  /**
   * Deeply copies computed styles (color, stroke, fill, dasharray) into SVG elements
   * and resolves currentColor to the exact computed RGB color.
   */
  function inlineSvgNodeStyles(origNode, targetNode) {
    if (origNode.nodeType !== Node.ELEMENT_NODE) return;

    const cs = window.getComputedStyle(origNode);
    const computedColor = cs.color;

    // Resolve stroke
    let stroke = cs.stroke;
    const origStrokeAttr = origNode.getAttribute('stroke');
    if (stroke === 'currentColor' || origStrokeAttr === 'currentColor' || (cs.stroke === 'none' && origStrokeAttr)) {
      stroke = computedColor;
    }
    if (stroke && stroke !== 'none') {
      targetNode.setAttribute('stroke', stroke);
      if (cs.strokeWidth) targetNode.setAttribute('stroke-width', cs.strokeWidth);
      if (cs.strokeLinecap) targetNode.setAttribute('stroke-linecap', cs.strokeLinecap);
      if (cs.strokeLinejoin) targetNode.setAttribute('stroke-linejoin', cs.strokeLinejoin);
      if (cs.strokeDasharray && cs.strokeDasharray !== 'none') {
        targetNode.setAttribute('stroke-dasharray', cs.strokeDasharray);
      }
      if (cs.strokeDashoffset && cs.strokeDashoffset !== '0px') {
        targetNode.setAttribute('stroke-dashoffset', cs.strokeDashoffset);
      }
    }

    // Resolve fill
    let fill = cs.fill;
    const origFillAttr = origNode.getAttribute('fill');
    if (fill === 'currentColor' || origFillAttr === 'currentColor') {
      fill = computedColor;
    }

    const tagName = targetNode.tagName.toLowerCase();
    if (fill && fill !== 'none') {
      targetNode.setAttribute('fill', fill);
    } else if (tagName !== 'g' && tagName !== 'svg') {
      targetNode.setAttribute('fill', 'none');
    }

    if (cs.opacity && cs.opacity !== '1') {
      targetNode.setAttribute('opacity', cs.opacity);
    }

    const origChildren = origNode.children;
    const targetChildren = targetNode.children;
    for (let i = 0; i < origChildren.length; i++) {
      if (targetChildren[i]) {
        inlineSvgNodeStyles(origChildren[i], targetChildren[i]);
      }
    }
  }

  /**
   * Renders CSS pseudo-elements (e.g. toggle switch knobs, checkmarks, badges, dots) into native SVG
   */
  async function processPseudoElement(node, pseudoName, parentX, parentY, parentW, parentH, svgElements) {
    let pseudoStyle;
    try {
      pseudoStyle = window.getComputedStyle(node, pseudoName);
    } catch (e) {
      return;
    }
    if (!pseudoStyle || pseudoStyle.display === 'none' || pseudoStyle.visibility === 'hidden') {
      return;
    }

    const content = pseudoStyle.content;
    // If content is 'none' or not set, pseudo-element does not generate a box
    if (!content || content === 'none') {
      return;
    }

    const rawContent = content.replace(/^['"]|['"]$/g, '');
    const bg = pseudoStyle.backgroundColor;
    const parsedBg = parseCssColor(bg);
    const hasBg = parsedBg.a > 0;
    const bgImg = pseudoStyle.backgroundImage;
    const hasBgImg = bgImg && bgImg !== 'none';
    const bw = parseFloat(pseudoStyle.borderTopWidth) || 0;
    const bc = pseudoStyle.borderTopColor;
    const hasBorder = bw > 0 && pseudoStyle.borderTopStyle !== 'none' && parseCssColor(bc).a > 0;

    let pw = parseFloat(pseudoStyle.width) || 0;
    let ph = parseFloat(pseudoStyle.height) || 0;

    // Determine position of the pseudo-element relative to parent
    let pLeft = parseFloat(pseudoStyle.left);
    let pTop = parseFloat(pseudoStyle.top);
    let pRight = parseFloat(pseudoStyle.right);
    let pBottom = parseFloat(pseudoStyle.bottom);

    // Auto-calculate full-size or stretch dimensions for absolute pseudo overlays
    if (pw === 0 && !isNaN(pLeft) && !isNaN(pRight)) {
      pw = Math.max(0, parentW - pLeft - pRight);
    }
    if (ph === 0 && !isNaN(pTop) && !isNaN(pBottom)) {
      ph = Math.max(0, parentH - pTop - pBottom);
    }
    if (pw === 0 && ph === 0 && (hasBg || hasBgImg) && (pseudoStyle.position === 'absolute' || pseudoStyle.display === 'block')) {
      pw = parentW;
      ph = parentH;
    }

    const hasVisualShape = (pw > 0 && ph > 0 && (hasBg || hasBorder || hasBgImg));
    const hasTextGlyph = rawContent.length > 0;
    const bwBottom = parseFloat(pseudoStyle.borderBottomWidth) || 0;
    const bwRight = parseFloat(pseudoStyle.borderRightWidth) || 0;
    const hasBorderCheckmark = bwBottom > 0 && bwRight > 0;

    if (!hasVisualShape && !hasTextGlyph && !hasBorderCheckmark) {
      return;
    }

    let tx = 0, ty = 0;
    if (pseudoStyle.transform && pseudoStyle.transform !== 'none') {
      const matrixMatch = pseudoStyle.transform.match(/matrix\(([^)]+)\)/);
      if (matrixMatch) {
        const parts = matrixMatch[1].split(',').map(s => parseFloat(s.trim()));
        if (parts.length >= 6) {
          tx = parts[4] || 0;
          ty = parts[5] || 0;
        }
      }
    }

    let posX = parentX;
    if (!isNaN(pLeft)) {
      posX = parentX + pLeft + tx;
    } else if (!isNaN(pRight)) {
      posX = parentX + parentW - pw - pRight + tx;
    } else {
      if ((node.checked || node.getAttribute('aria-checked') === 'true') && pw > 0) {
        posX = parentX + parentW - pw - 2;
      } else {
        posX = parentX + (pw > 0 && pw < parentW ? 2 : 0);
      }
    }

    let posY = parentY;
    if (!isNaN(pTop)) {
      posY = parentY + pTop + ty;
    } else if (!isNaN(pBottom)) {
      posY = parentY + parentH - ph - pBottom + ty;
    } else {
      posY = parentY + Math.max(0, (parentH - ph) / 2);
    }

    posX = Math.round(posX * 100) / 100;
    posY = Math.round(posY * 100) / 100;
    pw = Math.round(pw * 100) / 100;
    ph = Math.round(ph * 100) / 100;

    // 1. Render Background Box/Circle (e.g. Toggle Knob or Accent Stripe!)
    if (hasVisualShape) {
      const maxPRad = Math.min(pw / 2, ph / 2);
      const prTL = Math.min(parseFloat(pseudoStyle.borderTopLeftRadius) || 0, maxPRad);
      const fillAttr = formatSvgFill(bg);
      const strokeAttr = hasBorder ? formatSvgStroke(bc, bw) : '';
      const rxAttr = prTL > 0 ? `rx="${prTL}" ry="${prTL}"` : '';

      svgElements.push(`  <!-- Pseudo-element (${pseudoName}) Shape -->`);
      svgElements.push(`  <rect x="${posX}" y="${posY}" width="${pw}" height="${ph}" ${rxAttr} ${fillAttr}${strokeAttr ? ' ' + strokeAttr : ''}/>`);

      // If the knob has a background image (e.g. SVG checkmark)
      if (hasBgImg) {
        const urlMatch = bgImg.match(/url\(['"]?(.*?)['"]?\)/);
        if (urlMatch && urlMatch[1]) {
          const imgUrl = urlMatch[1];
          let dataUrl = imgUrl;
          if (!dataUrl.startsWith('data:')) {
            dataUrl = await toDataUrl(imgUrl);
          }
          const iconPad = Math.max(2, Math.round(Math.min(pw, ph) * 0.18));
          const iconW = pw - (iconPad * 2);
          const iconH = ph - (iconPad * 2);
          svgElements.push(`  <image x="${posX + iconPad}" y="${posY + iconPad}" width="${iconW}" height="${iconH}" href="${escapeXml(dataUrl)}" preserveAspectRatio="xMidYMid meet"/>`);
        }
      }
    }

    // 2. Render Text Glyph (e.g. '✓')
    if (hasTextGlyph) {
      const centerX = posX + (pw > 0 ? pw / 2 : parentW / 2);
      const centerY = posY + (ph > 0 ? ph / 2 : parentH / 2);
      const color = pseudoStyle.color || '#ffffff';
      const fontFamily = pseudoStyle.fontFamily.replace(/"/g, "'");
      svgElements.push(`  <text x="${centerX}" y="${centerY}" font-family="${fontFamily}" font-size="${pseudoStyle.fontSize}" font-weight="${pseudoStyle.fontWeight}" fill="${escapeXml(color)}" dominant-baseline="central" text-anchor="middle">${escapeXml(rawContent)}</text>`);
    }

    // 3. Render CSS Border-based checkmark (rotated borders)
    if (hasBorderCheckmark) {
      const borderColor = pseudoStyle.borderBottomColor || pseudoStyle.color;
      const cx = posX + (pw > 0 ? pw / 2 : parentW / 2);
      const cy = posY + (ph > 0 ? ph / 2 : parentH / 2);
      const checkW = Math.max(bwBottom, bwRight);
      svgElements.push(`  <path d="M ${cx - 4} ${cy} L ${cx - 1} ${cy + 3} L ${cx + 5} ${cy - 4}" stroke="${escapeXml(borderColor)}" stroke-width="${checkW}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`);
    }
  }

  /**
   * Builds an SVG path string for rectangles with independent per-corner radii
   */
  function buildSvgRoundedRectPath(x, y, w, h, tl, tr, br, bl) {
    let scale = 1;
    const maxTop = tl + tr;
    const maxBottom = bl + br;
    const maxLeft = tl + bl;
    const maxRight = tr + br;
    if (maxTop > w && maxTop > 0) scale = Math.min(scale, w / maxTop);
    if (maxBottom > w && maxBottom > 0) scale = Math.min(scale, w / maxBottom);
    if (maxLeft > h && maxLeft > 0) scale = Math.min(scale, h / maxLeft);
    if (maxRight > h && maxRight > 0) scale = Math.min(scale, h / maxRight);

    tl = Math.round(tl * scale * 100) / 100;
    tr = Math.round(tr * scale * 100) / 100;
    br = Math.round(br * scale * 100) / 100;
    bl = Math.round(bl * scale * 100) / 100;

    let d = `M ${x + tl} ${y}`;
    d += ` H ${x + w - tr}`;
    if (tr > 0) d += ` A ${tr} ${tr} 0 0 1 ${x + w} ${y + tr}`;
    d += ` V ${y + h - br}`;
    if (br > 0) d += ` A ${br} ${br} 0 0 1 ${x + w - br} ${y + h}`;
    d += ` H ${x + bl}`;
    if (bl > 0) d += ` A ${bl} ${bl} 0 0 1 ${x} ${y + h - bl}`;
    d += ` V ${y + tl}`;
    if (tl > 0) d += ` A ${tl} ${tl} 0 0 1 ${x + tl} ${y}`;
    d += ' Z';
    return d;
  }

  /**
   * Accurately wraps multiline text (e.g. textarea values) to fit within a given pixel width
   */
  function wrapTextToLines(text, maxWidth, fontCss) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (fontCss) {
      try { ctx.font = fontCss; } catch (e) {}
    }

    const paragraphs = text.split(/\r?\n/);
    const resultLines = [];

    for (const para of paragraphs) {
      if (para.trim().length === 0) {
        resultLines.push('');
        continue;
      }
      const words = para.split(/\s+/);
      let currentLine = '';

      for (let i = 0; i < words.length; i++) {
        const word = words[i];
        if (!word) continue;

        const candidate = currentLine.length === 0 ? word : currentLine + ' ' + word;
        const textW = (ctx && ctx.measureText) ? ctx.measureText(candidate).width : (candidate.length * 8);

        if (textW > maxWidth && currentLine.length > 0) {
          resultLines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = candidate;
        }
      }
      if (currentLine.length > 0) {
        resultLines.push(currentLine);
      }
    }
    return resultLines;
  }

  /**
   * Export native SVG elements
   */
  async function exportNativeSVG(svgEl, width, height, options) {
    const rootSvg = svgEl.tagName.toLowerCase() === 'svg' ? svgEl : svgEl.ownerSVGElement;
    const clone = rootSvg.cloneNode(true);

    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    clone.setAttribute('width', width);
    clone.setAttribute('height', height);
    if (!clone.getAttribute('viewBox')) {
      clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
    }

    dereferenceSvgUse(clone);
    inlineSvgNodeStyles(rootSvg, clone);

    const fontDefs = await collectBase64Fonts();
    let defs = clone.querySelector('defs');
    if (!defs) {
      defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      clone.insertBefore(defs, clone.firstChild);
    }

    const styleElem = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    styleElem.textContent = fontDefs;
    defs.appendChild(styleElem);

    return new XMLSerializer().serializeToString(clone).trim();
  }

  function dereferenceSvgUse(root) {
    const useElements = Array.from(root.querySelectorAll('use'));
    for (const use of useElements) {
      const href = use.getAttribute('href') || use.getAttribute('xlink:href');
      if (href && href.startsWith('#')) {
        const id = href.slice(1);
        const source = document.getElementById(id);
        if (source) {
          const clone = source.cloneNode(true);
          clone.removeAttribute('id');
          use.replaceWith(clone);
        }
      }
    }
  }

  async function toDataUrl(url) {
    if (url.startsWith('data:')) return url;
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      return url;
    }
  }

  async function collectBase64Fonts() {
    const fontRules = [];
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        const rules = sheet.cssRules || sheet.rules;
        if (!rules) continue;
        for (const rule of Array.from(rules)) {
          if (rule instanceof CSSFontFaceRule) {
            fontRules.push(rule.cssText);
          }
        }
      } catch (e) {
        // Cross origin
      }
    }
    return fontRules.join('\n');
  }

  function escapeXml(unsafe) {
    if (typeof unsafe !== 'string') return unsafe;
    return unsafe.replace(/[<>&'"]/g, function (c) {
      switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '\'': return '&apos;';
        case '"': return '&quot;';
      }
    });
  }

  /**
   * Universal CSS color parser - parses ANY color format (hex, rgb, rgba, rgb with slash,
   * hsl, oklch, named colors, transparent) into { r, g, b, a } (0-255, alpha 0-1).
   */
  function parseCssColor(colorStr) {
    if (!colorStr || colorStr === 'transparent') {
      return { r: 0, g: 0, b: 0, a: 0 };
    }
    // Standard rgba(r, g, b, a) or rgb(r, g, b)
    const mRgba = colorStr.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/);
    if (mRgba) {
      return {
        r: Math.round(parseFloat(mRgba[1])),
        g: Math.round(parseFloat(mRgba[2])),
        b: Math.round(parseFloat(mRgba[3])),
        a: mRgba[4] !== undefined ? parseFloat(mRgba[4]) : 1
      };
    }
    // Modern CSS Color 4 rgb(r g b / a)
    const mSlash = colorStr.match(/rgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)/);
    if (mSlash) {
      let a = 1;
      if (mSlash[4]) {
        a = mSlash[4].endsWith('%') ? parseFloat(mSlash[4]) / 100 : parseFloat(mSlash[4]);
      }
      return {
        r: Math.round(parseFloat(mSlash[1])),
        g: Math.round(parseFloat(mSlash[2])),
        b: Math.round(parseFloat(mSlash[3])),
        a: Math.round(a * 1000) / 1000
      };
    }
    // Hex formats #rgb, #rgba, #rrggbb, #rrggbbaa
    if (colorStr.startsWith('#')) {
      const hex = colorStr.slice(1);
      if (hex.length === 3 || hex.length === 4) {
        const r = parseInt(hex[0] + hex[0], 16);
        const g = parseInt(hex[1] + hex[1], 16);
        const b = parseInt(hex[2] + hex[2], 16);
        const a = hex.length === 4 ? parseInt(hex[3] + hex[3], 16) / 255 : 1;
        return { r, g, b, a: Math.round(a * 1000) / 1000 };
      } else if (hex.length === 6 || hex.length === 8) {
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
        return { r, g, b, a: Math.round(a * 1000) / 1000 };
      }
    }
    // In-browser Canvas 2D fallback for any remaining color (hsl, oklch, lab, color-mix, named)
    if (typeof document !== 'undefined') {
      try {
        const cvs = document.createElement('canvas');
        cvs.width = 1;
        cvs.height = 1;
        const ctx = cvs.getContext('2d', { willReadFrequently: true });
        ctx.fillStyle = colorStr;
        ctx.fillRect(0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data;
        return {
          r: d[0],
          g: d[1],
          b: d[2],
          a: Math.round((d[3] / 255) * 1000) / 1000
        };
      } catch (e) {}
    }
    return { r: 0, g: 0, b: 0, a: 1 };
  }

  function isSameColor(col1, col2) {
    if (!col1 || !col2) return false;
    if (col1 === col2) return true;
    const c1 = parseCssColor(col1);
    const c2 = parseCssColor(col2);
    if (c1.a === 0 && c2.a === 0) return true;
    return Math.abs(c1.r - c2.r) <= 3 &&
           Math.abs(c1.g - c2.g) <= 3 &&
           Math.abs(c1.b - c2.b) <= 3 &&
           Math.abs(c1.a - c2.a) <= 0.05;
  }

  /**
   * Converts CSS color strings (including rgba, rgb / slash, hex, named) to valid SVG 1.1 fill attributes.
   * Adobe Illustrator & SVG 1.1 do not support fill="rgba(...)".
   */
  function formatSvgFill(cssColor) {
    if (!cssColor) return 'fill="none"';
    const c = parseCssColor(cssColor);
    if (c.a === 0) return 'fill="none"';
    if (c.a < 1) return `fill="rgb(${c.r}, ${c.g}, ${c.b})" fill-opacity="${c.a}"`;
    return `fill="rgb(${c.r}, ${c.g}, ${c.b})"`;
  }

  /**
   * Converts CSS color strings and width to valid SVG 1.1 stroke attributes.
   */
  function formatSvgStroke(cssColor, width) {
    if (!cssColor || width <= 0) return '';
    const c = parseCssColor(cssColor);
    if (c.a === 0) return '';
    if (c.a < 1) return `stroke="rgb(${c.r}, ${c.g}, ${c.b})" stroke-width="${width}" stroke-opacity="${c.a}"`;
    return `stroke="rgb(${c.r}, ${c.g}, ${c.b})" stroke-width="${width}"`;
  }

  /**
   * Resolves any CSS variable or modern color function (var(--...), color-mix(...))
   * using the browser's live computed style engine on the target context node.
   */
  function resolveCssColor(rawColorStr, contextNode) {
    if (!rawColorStr) return 'transparent';
    const trimmed = rawColorStr.trim();
    if (trimmed === 'transparent') return 'transparent';

    if (trimmed.startsWith('#') || trimmed.startsWith('rgb(') || trimmed.startsWith('rgba(')) {
      return trimmed;
    }

    if (typeof document !== 'undefined') {
      try {
        const span = document.createElement('span');
        span.style.display = 'none';
        span.style.color = trimmed;
        const parent = contextNode || document.body || document.documentElement;
        if (parent && parent.appendChild) {
          parent.appendChild(span);
          const resolved = window.getComputedStyle(span).color;
          span.remove();
          if (resolved && resolved !== '' && resolved !== 'rgba(0, 0, 0, 0)') {
            return resolved;
          }
        }
      } catch (e) {}
    }

    return trimmed;
  }

  /**
   * Splits comma-separated CSS background layers respecting nested parentheses
   */
  function splitBackgroundLayers(str) {
    if (!str) return [];
    const layers = [];
    let current = '';
    let depth = 0;
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (ch === ',' && depth === 0) {
        if (current.trim()) layers.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim()) layers.push(current.trim());
    return layers;
  }

  /**
   * Parses position expressions from gradient color stops (calc(X% +- Ypx), X%, Xpx) into pixels
   */
  function parsePosToPx(posStr, totalPx) {
    if (!posStr || posStr === '0') return 0;
    posStr = posStr.trim();
    const calcMatch = posStr.match(/calc\(\s*([\d.]+)%\s*([+-])\s*([\d.]+)px\s*\)/i);
    if (calcMatch) {
      const pct = parseFloat(calcMatch[1]) / 100;
      const sign = calcMatch[2] === '-' ? -1 : 1;
      const pxOffset = parseFloat(calcMatch[3]);
      return Math.round((pct * totalPx + sign * pxOffset) * 100) / 100;
    }
    const pctMatch = posStr.match(/^([\d.]+)%$/);
    if (pctMatch) {
      return Math.round(((parseFloat(pctMatch[1]) / 100) * totalPx) * 100) / 100;
    }
    const pxMatch = posStr.match(/^([\d.]+)px$/);
    if (pxMatch) {
      return parseFloat(pxMatch[1]);
    }
    return 0;
  }

  /**
   * Parses direction and stops from a linear-gradient(...) string
   */
  function parseGradientLayer(gradientStr) {
    const startIdx = gradientStr.indexOf('linear-gradient(');
    if (startIdx === -1) return null;
    let inside = '';
    let depth = 0;
    for (let i = startIdx + 'linear-gradient('.length; i < gradientStr.length; i++) {
      const ch = gradientStr[i];
      if (ch === '(') depth++;
      else if (ch === ')') {
        if (depth === 0) break;
        depth--;
      }
      inside += ch;
    }
    inside = inside.trim();

    const parts = [];
    let current = '';
    let parenDepth = 0;
    for (let i = 0; i < inside.length; i++) {
      const c = inside[i];
      if (c === '(') parenDepth++;
      else if (c === ')') parenDepth--;
      if (c === ',' && parenDepth === 0) {
        if (current.trim()) parts.push(current.trim());
        current = '';
      } else {
        current += c;
      }
    }
    if (current.trim()) parts.push(current.trim());

    let direction = 'to bottom';
    let stopStart = 0;
    const first = parts[0] ? parts[0].toLowerCase() : '';
    if (first.includes('to ') || first.includes('deg')) {
      direction = parts[0].trim();
      stopStart = 1;
    }

    const rawStops = parts.slice(stopStart);
    const parsedStops = [];
    for (const s of rawStops) {
      let colorPart = '';
      let posPart = '';
      let pDepth = 0;
      let splitIdx = -1;
      for (let i = s.length - 1; i >= 0; i--) {
        const c = s[i];
        if (c === ')') pDepth++;
        else if (c === '(') pDepth--;
        if (pDepth === 0 && /\s/.test(c)) {
          const remainder = s.slice(i + 1).trim();
          if (remainder.startsWith('calc(') || remainder.endsWith('%') || remainder.endsWith('px')) {
            splitIdx = i;
            break;
          }
        }
      }
      if (splitIdx !== -1) {
        colorPart = s.slice(0, splitIdx).trim();
        posPart = s.slice(splitIdx + 1).trim();
      } else {
        colorPart = s.trim();
      }
      parsedStops.push({ color: colorPart, pos: posPart });
    }

    return { direction, stops: parsedStops };
  }

  /**
   * Converts CSS linear-gradient string to native SVG <linearGradient> element
   * Never emits stop-color="transparent" (which renders as opaque black in SVG 1.1).
   */
  function parseLinearGradientToSvg(cssGradient, id, contextNode) {
    const startIdx = cssGradient.indexOf('linear-gradient(');
    if (startIdx === -1) return null;
    let inside = '';
    let depth = 0;
    let ended = false;
    for (let i = startIdx + 'linear-gradient('.length; i < cssGradient.length; i++) {
      const ch = cssGradient[i];
      if (ch === '(') depth++;
      else if (ch === ')') {
        if (depth === 0) {
          ended = true;
          break;
        }
        depth--;
      }
      inside += ch;
    }
    if (!ended) return null;
    inside = inside.trim();

    const parts = [];
    let current = '';
    let parenDepth = 0;
    for (let i = 0; i < inside.length; i++) {
      const c = inside[i];
      if (c === '(') parenDepth++;
      else if (c === ')') parenDepth--;
      if (c === ',' && parenDepth === 0) {
        parts.push(current.trim());
        current = '';
      } else {
        current += c;
      }
    }
    if (current.trim()) parts.push(current.trim());

    let x1 = '0%', y1 = '0%', x2 = '0%', y2 = '100%';
    let stopStartIndex = 0;

    const firstPart = parts[0].toLowerCase();
    if (firstPart.includes('to right') || firstPart === '90deg') {
      x1 = '0%'; y1 = '0%'; x2 = '100%'; y2 = '0%';
      stopStartIndex = 1;
    } else if (firstPart.includes('to bottom') || firstPart === '180deg') {
      x1 = '0%'; y1 = '0%'; x2 = '0%'; y2 = '100%';
      stopStartIndex = 1;
    } else if (firstPart.includes('to top') || firstPart === '0deg') {
      x1 = '0%'; y1 = '100%'; x2 = '0%'; y2 = '0%';
      stopStartIndex = 1;
    } else if (firstPart.includes('to left') || firstPart === '270deg') {
      x1 = '100%'; y1 = '0%'; x2 = '0%'; y2 = '0%';
      stopStartIndex = 1;
    } else if (firstPart.includes('deg') || firstPart.startsWith('to ')) {
      stopStartIndex = 1;
    }

    const rawStops = parts.slice(stopStartIndex);
    if (rawStops.length === 0) return null;

    let allTransparent = true;
    const stops = [];
    for (let s = 0; s < rawStops.length; s++) {
      const item = rawStops[s];
      const stopMatch = item.match(/^(.*?)(?:\s+([\d.]+%))?$/);
      const rawColor = stopMatch ? stopMatch[1].trim() : item;
      const defaultOffset = (rawStops.length === 1) ? '100%' : Math.round((s / (rawStops.length - 1)) * 100) + '%';
      const offset = (stopMatch && stopMatch[2]) ? stopMatch[2] : defaultOffset;

      const resolvedColor = resolveCssColor(rawColor, contextNode);
      const c = parseCssColor(resolvedColor);
      if (c.a > 0) allTransparent = false;

      if (c.a === 0) {
        stops.push(`    <stop offset="${offset}" stop-color="rgb(${c.r}, ${c.g}, ${c.b})" stop-opacity="0"/>`);
      } else if (c.a < 1) {
        stops.push(`    <stop offset="${offset}" stop-color="rgb(${c.r}, ${c.g}, ${c.b})" stop-opacity="${c.a}"/>`);
      } else {
        stops.push(`    <stop offset="${offset}" stop-color="rgb(${c.r}, ${c.g}, ${c.b})"/>`);
      }
    }

    if (allTransparent) return null;

    return `  <linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">\n${stops.join('\n')}\n  </linearGradient>`;
  }

  return {
    exportToSVG: exportToSVG
  };
})();
