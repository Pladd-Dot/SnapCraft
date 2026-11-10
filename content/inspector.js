/**
 * SnapCraft Content Script - Inspector, Region Cropper & Full Page Stitcher
 */

(function () {
  let isInspectActive = false;
  let isAreaActive = false;
  let activeSettings = null;
  
  let overlayElem = null;
  let badgeElem = null;
  let floatingBarElem = null;
  let areaCanvasElem = null;

  let hoveredElement = null;
  let areaMouseMove = null;
  let areaMouseUp = null;
  let areaScroll = null;
  let autoScrollInterval = null;

  // Listen for launch requests
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'ACTIVATE_MODE') {
      activeSettings = request.settings;

      if (activeSettings.mode === 'inspect') {
        startInspectMode();
      } else if (activeSettings.mode === 'area') {
        startAreaMode();
      } else if (activeSettings.mode === 'fullpage') {
        captureFullPage();
      }
      sendResponse({ status: 'started' });
    }
    return true;
  });

  // ----------------------------------------------------
  // 1. ELEMENT INSPECTOR MODE
  // ----------------------------------------------------

  function startInspectMode() {
    stopAllModes();
    isInspectActive = true;

    createOverlayUI();
    createFloatingBar('🔍 Hover & click any element to capture. Press ESC to cancel.');

    document.addEventListener('mousemove', handleInspectMouseMove, true);
    document.addEventListener('click', handleInspectClick, true);
    document.addEventListener('keydown', handleKeyDown, true);
  }

  function handleInspectMouseMove(e) {
    if (!isInspectActive) return;
    e.stopPropagation();

    const rawTarget = e.target;
    if (!rawTarget) return;

    if (rawTarget.closest && (rawTarget.closest('#snapcraft-floating-bar') || rawTarget.closest('#snapcraft-inspector-overlay') || rawTarget.closest('#snapcraft-page-modal'))) {
      return;
    }

    const elem = rawTarget.nodeType === 1 ? rawTarget : rawTarget.parentElement;
    if (!elem) return;

    hoveredElement = elem;
    const rect = hoveredElement.getBoundingClientRect();
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    overlayElem.style.display = 'block';
    overlayElem.style.top = `${rect.top + scrollY}px`;
    overlayElem.style.left = `${rect.left + scrollX}px`;
    overlayElem.style.width = `${rect.width}px`;
    overlayElem.style.height = `${rect.height}px`;

    const tagName = hoveredElement.tagName ? hoveredElement.tagName.toLowerCase() : 'element';
    const idStr = hoveredElement.id ? `#${hoveredElement.id}` : '';
    let classStr = '';
    if (hoveredElement.className && typeof hoveredElement.className === 'string') {
      const filtered = hoveredElement.className.split(' ').filter(c => c && !c.startsWith('snapcraft'));
      if (filtered.length > 0) classStr = `.${filtered.slice(0, 2).join('.')}`;
    }
    
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);

    badgeElem.innerHTML = `<span class="tag">&lt;${tagName}${idStr}${classStr}&gt;</span> <span class="dim">${w} × ${h}px</span>`;
  }

  async function handleInspectClick(e) {
    if (!isInspectActive) return;
    if (e.target && e.target.closest && (e.target.closest('#snapcraft-floating-bar') || e.target.closest('#snapcraft-page-modal'))) {
      return;
    }
    if (!hoveredElement) return;
    e.preventDefault();
    e.stopPropagation();

    const target = hoveredElement;
    stopAllModes();

    await processCapturedElement(target);
  }

  // ----------------------------------------------------
  // 2. CAPTURE PROCESSING (SVG vs RASTER)
  // ----------------------------------------------------

  async function processCapturedElement(target) {
    let rect = target.getBoundingClientRect();
    const format = activeSettings ? activeSettings.format : 'png';

    const vpH = window.innerHeight;
    const vpW = window.innerWidth;
    if (rect.top < 0 || rect.bottom > vpH || rect.left < 0 || rect.right > vpW) {
      target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      await new Promise(r => setTimeout(r, 100));
      rect = target.getBoundingClientRect();
    }

    const computed = window.getComputedStyle(target);
    const radii = {
      tl: parseFloat(computed.borderTopLeftRadius) || 0,
      tr: parseFloat(computed.borderTopRightRadius) || 0,
      br: parseFloat(computed.borderBottomRightRadius) || 0,
      bl: parseFloat(computed.borderBottomLeftRadius) || 0
    };

    // Apply dummy data if enabled
    let dummyHandle = null;
    if (activeSettings && activeSettings.dummyData && activeSettings.dummyData.enabled && window.SnapCraftDummyData) {
      dummyHandle = window.SnapCraftDummyData.apply(target, activeSettings.dummyData);
      await new Promise(r => setTimeout(r, 40));
      rect = target.getBoundingClientRect();
    }

    try {
      if (format === 'svg') {
        let svgMarkup = window.SnapCraftSVG ? await window.SnapCraftSVG.exportToSVG(target, activeSettings) : target.outerHTML;
        showInPagePreview({
          format: 'svg',
          content: svgMarkup.trim(),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        });
        return;
      }

      const restoreFixed = hideFixedElements(target);
      await new Promise(r => setTimeout(r, 60));

      await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'CAPTURE_TAB' }, async (response) => {
          try {
            restoreFixed();

            if (!response || !response.dataUrl) {
              alert('Failed to capture screen.');
              return;
            }

            const croppedDataUrl = await cropImageToRect(
              response.dataUrl,
              rect,
              window.devicePixelRatio,
              activeSettings,
              radii
            );

            showInPagePreview({
              format: format,
              content: croppedDataUrl,
              width: Math.round(rect.width),
              height: Math.round(rect.height)
            });
          } finally {
            resolve();
          }
        });
      });
    } catch (err) {
      console.error('[SnapCraft] Element capture error:', err);
      alert('Capture Error: ' + (err && err.message ? err.message : err));
    } finally {
      if (dummyHandle && dummyHandle.restore) {
        dummyHandle.restore();
      }
    }
  }

  // ----------------------------------------------------
  // 3. REGION SELECTION MODE (With Auto-Scroll & Fixed Header Suppression)
  // ----------------------------------------------------

  function startAreaMode() {
    stopAllModes();
    isAreaActive = true;

    createFloatingBar('✂️ Drag to select region. Move cursor near top/bottom edges to auto-scroll down. Press ESC to cancel.');

    areaCanvasElem = document.createElement('canvas');
    areaCanvasElem.id = 'snapcraft-area-canvas';
    areaCanvasElem.width = window.innerWidth;
    areaCanvasElem.height = window.innerHeight;
    document.body.appendChild(areaCanvasElem);

    const ctx = areaCanvasElem.getContext('2d');
    let startXDoc = 0, startYDoc = 0, currentXDoc = 0, currentYDoc = 0;
    let isDragging = false;

    function drawMask() {
      if (!areaCanvasElem) return;
      ctx.clearRect(0, 0, areaCanvasElem.width, areaCanvasElem.height);

      if (isDragging) {
        const xDoc = Math.min(startXDoc, currentXDoc);
        const yDoc = Math.min(startYDoc, currentYDoc);
        const w = Math.abs(currentXDoc - startXDoc);
        const h = Math.abs(currentYDoc - startYDoc);

        const vx = xDoc - window.scrollX;
        const vy = yDoc - window.scrollY;

        if (w > 0 && h > 0) {
          ctx.strokeStyle = '#6366f1';
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 4]);
          ctx.strokeRect(vx, vy, w, h);
        }
      }
    }

    const startAutoScroll = (direction) => {
      if (autoScrollInterval) return;
      autoScrollInterval = setInterval(() => {
        if (!isAreaActive || !isDragging) {
          stopAutoScroll();
          return;
        }
        const prevY = window.scrollY;
        const delta = direction === 'down' ? 18 : -18;
        window.scrollBy(0, delta);
        if (window.scrollY === prevY) {
          stopAutoScroll();
          return;
        }
        currentYDoc += (window.scrollY - prevY);
        drawMask();
      }, 25);
    };

    const stopAutoScroll = () => {
      if (autoScrollInterval) {
        clearInterval(autoScrollInterval);
        autoScrollInterval = null;
      }
    };

    const onMouseDown = (e) => {
      if (!isAreaActive) return;
      startXDoc = e.pageX;
      startYDoc = e.pageY;
      currentXDoc = e.pageX;
      currentYDoc = e.pageY;
      isDragging = true;
    };

    areaMouseMove = (e) => {
      if (!isAreaActive || !isDragging) return;
      currentXDoc = e.pageX;
      currentYDoc = e.pageY;

      const edgeBuffer = 50;
      if (e.clientY > window.innerHeight - edgeBuffer) {
        startAutoScroll('down');
      } else if (e.clientY < edgeBuffer && window.scrollY > 0) {
        startAutoScroll('up');
      } else {
        stopAutoScroll();
      }

      drawMask();
    };

    areaMouseUp = async (e) => {
      if (!isAreaActive || !isDragging) return;
      isDragging = false;
      stopAutoScroll();

      const cropLeftDoc = Math.min(startXDoc, currentXDoc);
      const cropTopDoc = Math.min(startYDoc, currentYDoc);
      const cropW = Math.abs(currentXDoc - startXDoc);
      const cropH = Math.abs(currentYDoc - startYDoc);

      stopAllModes();

      if (cropW < 5 || cropH < 5) return;

      await processRegionCapture(cropLeftDoc, cropTopDoc, cropW, cropH);
    };

    areaScroll = () => {
      if (isAreaActive) {
        drawMask();
      }
    };

    areaCanvasElem.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', areaMouseMove);
    window.addEventListener('mouseup', areaMouseUp);
    window.addEventListener('scroll', areaScroll);
    document.addEventListener('keydown', handleKeyDown, true);
  }

  /**
   * Captures selected region accurately without hiding webpage elements
   */
  async function processRegionCapture(leftDoc, topDoc, width, height) {
    const format = activeSettings ? activeSettings.format : 'png';
    const vpHeight = window.innerHeight;
    const vpWidth = window.innerWidth;
    const scale = activeSettings ? activeSettings.scale : 2;

    let dummyHandle = null;
    if (activeSettings && activeSettings.dummyData && activeSettings.dummyData.enabled && window.SnapCraftDummyData) {
      dummyHandle = window.SnapCraftDummyData.apply(document.body, activeSettings.dummyData);
      await new Promise(r => setTimeout(r, 40));
    }

    try {
      const fitsInCurrentView = (
        topDoc >= window.scrollY &&
        topDoc + height <= window.scrollY + vpHeight &&
        leftDoc >= window.scrollX &&
        leftDoc + width <= window.scrollX + vpWidth
      );

      if (fitsInCurrentView) {
        const cropRect = {
          left: leftDoc - window.scrollX,
          top: topDoc - window.scrollY,
          width: width,
          height: height
        };

        await new Promise(r => setTimeout(r, 60));

        await new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: 'CAPTURE_TAB' }, async (response) => {
            try {
              if (!response || !response.dataUrl) return;

              const croppedUrl = await cropImageToRect(
                response.dataUrl,
                cropRect,
                window.devicePixelRatio,
                activeSettings,
                null
              );

              let finalContent = croppedUrl;
              if (format === 'svg') {
                finalContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${Math.round(width * scale)}" height="${Math.round(height * scale)}" viewBox="0 0 ${Math.round(width * scale)} ${Math.round(height * scale)}">
  <image width="${Math.round(width * scale)}" height="${Math.round(height * scale)}" href="${croppedUrl}"/>
</svg>`.trim();
              }

              showInPagePreview({
                format: format,
                content: finalContent,
                width: Math.round(width * scale),
                height: Math.round(height * scale)
              });
            } finally {
              resolve();
            }
          });
        });
      } else {
        await captureExtendedRegionStitched(leftDoc, topDoc, width, height, format);
      }
    } finally {
      if (dummyHandle && dummyHandle.restore) {
        dummyHandle.restore();
      }
    }
  }

  /**
   * Multi-segment stitcher for region selections extending past screen fold with zero overlap
   */
  async function captureExtendedRegionStitched(leftDoc, topDoc, width, height, format) {
    try {
      const vpHeight = window.innerHeight;
      const vpWidth = window.innerWidth;
      const dpr = window.devicePixelRatio;
      const scale = activeSettings ? activeSettings.scale : 2;

      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      let lastDrawnDocY = topDoc;
      let targetScrollY = topDoc;

      while (lastDrawnDocY < topDoc + height) {
        window.scrollTo(Math.max(0, leftDoc - 10), targetScrollY);
        await new Promise(r => setTimeout(r, 160));

        const currentScrollY = window.scrollY;

        const response = await new Promise(res => {
          chrome.runtime.sendMessage({ action: 'CAPTURE_TAB' }, res);
        });

        if (response && response.dataUrl) {
          const segImg = await loadImage(response.dataUrl);

          const docYStart = Math.max(lastDrawnDocY, currentScrollY);
          const docYEnd = Math.min(topDoc + height, currentScrollY + vpHeight);

          if (docYEnd > docYStart) {
            const sliceH = docYEnd - docYStart;

            const docXStart = Math.max(leftDoc, window.scrollX);
            const docXEnd = Math.min(leftDoc + width, window.scrollX + vpWidth);
            const sliceW = Math.max(0, docXEnd - docXStart);

            const scaleX = segImg.width / window.innerWidth;
            const scaleY = segImg.height / window.innerHeight;

            const cropX = Math.round((docXStart - window.scrollX) * scaleX);
            const cropY = Math.round((docYStart - currentScrollY) * scaleY);
            const cropW = Math.round(sliceW * scaleX);
            const cropH = Math.round(sliceH * scaleY);

            const destX = Math.round((docXStart - leftDoc) * scale);
            const destY = Math.round((docYStart - topDoc) * scale);
            const destW = Math.round(sliceW * scale);
            const destH = Math.round(sliceH * scale);

            if (cropW > 0 && cropH > 0 && destW > 0 && destH > 0) {
              ctx.drawImage(
                segImg,
                cropX, cropY, cropW, cropH,
                destX, destY, destW, destH
              );
            }

            lastDrawnDocY = docYEnd;
          }
        }

        const nextTarget = currentScrollY + vpHeight;
        if (nextTarget <= targetScrollY && lastDrawnDocY < topDoc + height) {
          break;
        }
        targetScrollY = nextTarget;
      }

      const quality = activeSettings ? activeSettings.quality : 0.92;
      const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
      const finalDataUrl = canvas.toDataURL(mime, quality);

      let finalContent = finalDataUrl;
      if (format === 'svg') {
        finalContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${Math.round(width * scale)}" height="${Math.round(height * scale)}" viewBox="0 0 ${Math.round(width * scale)} ${Math.round(height * scale)}">
  <image width="${Math.round(width * scale)}" height="${Math.round(height * scale)}" href="${finalDataUrl}"/>
</svg>`.trim();
      }

      showInPagePreview({
        format: format,
        content: finalContent,
        width: Math.round(width * scale),
        height: Math.round(height * scale)
      });
    } catch (err) {
      console.error('Region capture error:', err);
      alert('SnapCraft Region Capture Error: ' + err.message);
    }
  }

  /**
   * Helper to temporarily hide fixed & sticky navbar elements outside target (only used for element inspection)
   */
  function hideFixedElements(target) {
    const hiddenElems = [];
    if (!target) return function restoreFixedElements() {};

    const all = document.querySelectorAll('*');

    for (let i = 0; i < all.length; i++) {
      const elem = all[i];

      // Never hide document body, document element, or ancestors containing target
      if (elem === document.body || elem === document.documentElement || elem.contains(target)) {
        continue;
      }

      // Skip target or children of target
      if (elem === target || target.contains(elem)) {
        continue;
      }

      // Hide SnapCraft UI elements during screenshot
      if (elem.id && elem.id.startsWith('snapcraft') && elem.id !== 'snapcraft-page-modal') {
        const origVis = elem.style.visibility;
        elem.style.visibility = 'hidden';
        hiddenElems.push({ elem, origVis });
        continue;
      }

      const pos = window.getComputedStyle(elem).position;
      if (pos === 'fixed' || pos === 'sticky') {
        const origVis = elem.style.visibility;
        elem.style.visibility = 'hidden';
        hiddenElems.push({ elem, origVis });
      }
    }

    return function restoreFixedElements() {
      for (const item of hiddenElems) {
        item.elem.style.visibility = item.origVis;
      }
    };
  }

  // ----------------------------------------------------
  // 4. FULL PAGE SCROLL & STITCH
  // ----------------------------------------------------

  async function captureFullPage() {
    createFloatingBar('📜 Capturing & stitching full webpage...');

    let dummyHandle = null;
    if (activeSettings && activeSettings.dummyData && activeSettings.dummyData.enabled && window.SnapCraftDummyData) {
      dummyHandle = window.SnapCraftDummyData.apply(document.body, activeSettings.dummyData);
      await new Promise(r => setTimeout(r, 40));
    }

    try {
      const totalWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
      const totalHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      const originalX = window.scrollX;
      const originalY = window.scrollY;

      const dpr = window.devicePixelRatio;
      const scale = activeSettings ? activeSettings.scale : 2;
      const canvas = document.createElement('canvas');
      canvas.width = totalWidth * dpr * scale;
      canvas.height = totalHeight * dpr * scale;
      const ctx = canvas.getContext('2d');

      let currentY = 0;
      while (currentY < totalHeight) {
        window.scrollTo(0, currentY);
        await new Promise(r => setTimeout(r, 250));

        const response = await new Promise(res => {
          chrome.runtime.sendMessage({ action: 'CAPTURE_TAB' }, res);
        });

        if (response && response.dataUrl) {
          const img = await loadImage(response.dataUrl);
          const drawY = currentY * dpr * scale;
          ctx.drawImage(img, 0, drawY, img.width * scale, img.height * scale);
        }

        currentY += viewportHeight;
      }

      window.scrollTo(originalX, originalY);
      stopAllModes();

      const format = activeSettings ? activeSettings.format : 'png';
      const quality = activeSettings ? activeSettings.quality : 0.92;
      const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
      const finalDataUrl = canvas.toDataURL(mime, quality);

      showInPagePreview({
        format: format,
        content: finalDataUrl,
        width: Math.round(totalWidth * scale),
        height: Math.round(totalHeight * scale)
      });
    } finally {
      if (dummyHandle && dummyHandle.restore) {
        dummyHandle.restore();
      }
    }
  }

  // ----------------------------------------------------
  // IN-PAGE PREVIEW MODAL
  // ----------------------------------------------------

  function showInPagePreview(data) {
    const oldModal = document.getElementById('snapcraft-page-modal');
    if (oldModal) oldModal.remove();

    const modal = document.createElement('div');
    modal.id = 'snapcraft-page-modal';

    const isSvg = data.format === 'svg';
    const cleanContent = data.content ? data.content.trim() : '';

    const previewContent = isSvg
      ? `<textarea readonly>${escapeHtml(cleanContent)}</textarea>`
      : `<img src="${cleanContent}" alt="Captured element">`;

    modal.innerHTML = `
      <div class="modal-card">
        <div class="modal-header">
          <div class="modal-title">✨ SnapCraft Captured Preview</div>
          <button class="modal-close" id="snapcraftCloseModal">&times;</button>
        </div>
        <div class="modal-body">
          <div class="preview-box">
            ${previewContent}
          </div>
          <div class="meta-row">
            <span>Dimensions: <strong>${data.width} × ${data.height} px</strong></span>
            <span>Format: <strong>${data.format.toUpperCase()}</strong></span>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="snapcraftCancelModalBtn">Cancel</button>
          <button class="btn btn-secondary" id="snapcraftCopyBtn">📋 Copy</button>
          <button class="btn btn-primary" id="snapcraftDownloadBtn">⬇️ Download File</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const closeModal = () => {
      document.removeEventListener('keydown', onModalKeyDown, true);
      const m = document.getElementById('snapcraft-page-modal');
      if (m) m.remove();
    };

    const onModalKeyDown = (e) => {
      if (e.key === 'Escape') {
        closeModal();
      }
    };
    document.addEventListener('keydown', onModalKeyDown, true);

    const closeBtn = document.getElementById('snapcraftCloseModal');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);

    const cancelBtn = document.getElementById('snapcraftCancelModalBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeModal();
      }
    });

    document.getElementById('snapcraftCopyBtn').addEventListener('click', async () => {
      try {
        if (isSvg) {
          await navigator.clipboard.writeText(cleanContent);
          alert('SVG XML code copied to clipboard!');
        } else {
          const res = await fetch(cleanContent);
          const blob = await res.blob();
          await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
          alert('Image copied to clipboard!');
        }
      } catch (err) {
        if (isSvg) {
          await navigator.clipboard.writeText(cleanContent);
        }
        alert('Copied to clipboard!');
      }
    });

    document.getElementById('snapcraftDownloadBtn').addEventListener('click', () => {
      const filename = `snapcraft_${Date.now()}.${data.format}`;
      const a = document.createElement('a');
      
      if (isSvg) {
        const blob = new Blob([cleanContent], { type: 'image/svg+xml;charset=utf-8' });
        a.href = URL.createObjectURL(blob);
      } else {
        a.href = cleanContent;
      }
      
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ----------------------------------------------------
  // UTILITIES & OVERLAYS
  // ----------------------------------------------------

  function createOverlayUI() {
    if (!overlayElem) {
      overlayElem = document.createElement('div');
      overlayElem.id = 'snapcraft-inspector-overlay';

      badgeElem = document.createElement('div');
      badgeElem.id = 'snapcraft-inspector-badge';
      overlayElem.appendChild(badgeElem);

      document.body.appendChild(overlayElem);
    }
  }

  function createFloatingBar(text) {
    removeFloatingBar();
    floatingBarElem = document.createElement('div');
    floatingBarElem.id = 'snapcraft-floating-bar';
    floatingBarElem.innerHTML = `
      <div class="snapcraft-bar-text">
        <span class="snapcraft-dot"></span>
        <span>${text}</span>
      </div>
      <button class="snapcraft-bar-btn danger" id="snapcraftCancelBtn" type="button">Cancel</button>
    `;

    // Isolate mouse and click events on floating bar
    floatingBarElem.addEventListener('mousedown', (e) => e.stopPropagation());
    floatingBarElem.addEventListener('mouseup', (e) => e.stopPropagation());
    floatingBarElem.addEventListener('click', (e) => e.stopPropagation());

    document.body.appendChild(floatingBarElem);

    const cancelBtn = floatingBarElem.querySelector('#snapcraftCancelBtn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        stopAllModes();
      });
    }
  }

  function removeFloatingBar() {
    const existing = document.getElementById('snapcraft-floating-bar');
    if (existing) {
      existing.remove();
    }
    if (floatingBarElem && floatingBarElem.parentNode) {
      floatingBarElem.parentNode.removeChild(floatingBarElem);
    }
    floatingBarElem = null;
  }

  function stopAllModes() {
    isInspectActive = false;
    isAreaActive = false;

    if (autoScrollInterval) {
      clearInterval(autoScrollInterval);
      autoScrollInterval = null;
    }
    if (areaMouseMove) {
      window.removeEventListener('mousemove', areaMouseMove);
      areaMouseMove = null;
    }
    if (areaMouseUp) {
      window.removeEventListener('mouseup', areaMouseUp);
      areaMouseUp = null;
    }
    if (areaScroll) {
      window.removeEventListener('scroll', areaScroll);
      areaScroll = null;
    }

    const overlay = document.getElementById('snapcraft-inspector-overlay');
    if (overlay) overlay.remove();
    overlayElem = null;
    badgeElem = null;

    const canvas = document.getElementById('snapcraft-area-canvas');
    if (canvas) canvas.remove();
    areaCanvasElem = null;

    removeFloatingBar();

    document.removeEventListener('mousemove', handleInspectMouseMove, true);
    document.removeEventListener('click', handleInspectClick, true);
    document.removeEventListener('keydown', handleKeyDown, true);
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      stopAllModes();
    }
  }

  function cropImageToRect(dataUrl, rect, dpr, settings, radii) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const scale = settings ? settings.scale : 2;

        const vv = window.visualViewport;
        const viewWidth = vv ? vv.width : window.innerWidth;
        const viewHeight = vv ? vv.height : window.innerHeight;
        const offX = vv ? vv.offsetLeft : 0;
        const offY = vv ? vv.offsetTop : 0;

        const scaleX = img.width / viewWidth;
        const scaleY = img.height / viewHeight;

        const vLeft = rect.left - offX;
        const vTop = rect.top - offY;

        let cropX = Math.max(0, vLeft * scaleX);
        let cropY = Math.max(0, vTop * scaleY);
        let cropW = Math.min(img.width - cropX, rect.width * scaleX);
        let cropH = Math.min(img.height - cropY, rect.height * scaleY);

        if (cropW <= 0 || cropH <= 0) {
          cropX = Math.max(0, rect.left * dpr);
          cropY = Math.max(0, rect.top * dpr);
          cropW = Math.min(img.width - cropX, rect.width * dpr);
          cropH = Math.min(img.height - cropY, rect.height * dpr);
        }

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(rect.width * scale));
        canvas.height = Math.max(1, Math.round(rect.height * scale));

        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        const isTransparentOpt = (!settings || settings.transparentBg !== false);
        const isTransparentFormat = settings && (settings.format === 'png' || settings.format === 'webp' || settings.format === 'svg');
        
        if (isTransparentOpt && isTransparentFormat && radii && (radii.tl || radii.tr || radii.br || radii.bl)) {
          const rTL = radii.tl * scale * (scaleX / dpr || 1);
          const rTR = radii.tr * scale * (scaleX / dpr || 1);
          const rBR = radii.br * scale * (scaleX / dpr || 1);
          const rBL = radii.bl * scale * (scaleX / dpr || 1);

          ctx.beginPath();
          if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(0, 0, canvas.width, canvas.height, [rTL, rTR, rBR, rBL]);
          } else {
            drawCustomRoundedRect(ctx, 0, 0, canvas.width, canvas.height, rTL, rTR, rBR, rBL);
          }
          ctx.clip();
        }

        ctx.drawImage(
          img,
          cropX, cropY, cropW, cropH,
          0, 0, canvas.width, canvas.height
        );

        const format = settings ? settings.format : 'png';
        const quality = settings ? settings.quality : 0.92;
        const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
        resolve(canvas.toDataURL(mime, quality));
      };
      img.src = dataUrl;
    });
  }

  function drawCustomRoundedRect(ctx, x, y, width, height, tl, tr, br, bl) {
    ctx.moveTo(x + tl, y);
    ctx.lineTo(x + width - tr, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + tr);
    ctx.lineTo(x + width, y + height - br);
    ctx.quadraticCurveTo(x + width, y + height, x + width - br, y + height);
    ctx.lineTo(x + bl, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - bl);
    ctx.lineTo(x, y + tl);
    ctx.quadraticCurveTo(x, y, x + tl, y);
    ctx.closePath();
  }

  function loadImage(src) {
    return new Promise((res) => {
      const img = new Image();
      img.onload = () => res(img);
      img.src = src;
    });
  }
})();
