/**
 * SnapCraft Service Worker / Background Handler
 */

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'LAUNCH_CAPTURE') {
    const { tabId, settings } = request;

    if (settings.mode === 'viewport') {
      // Direct visible viewport capture
      captureViewport(tabId, settings).then((data) => {
        sendResponse({ success: true, data });
      });
      return true; // Keep message port open for async response
    } else {
      // Interactive modes: inspect, area, fullpage
      // Dynamically inject content scripts first to ensure connection works on pre-existing tabs
      injectContentScripts(tabId).then(() => {
        chrome.tabs.sendMessage(tabId, {
          action: 'ACTIVATE_MODE',
          settings: settings
        }, (res) => {
          if (chrome.runtime.lastError) {
            console.warn('sendMessage error:', chrome.runtime.lastError);
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
            return;
          }
          sendResponse({ success: true, res });
        });
      }).catch(err => {
        console.error('Script injection error:', err);
        sendResponse({ success: false, error: err.message });
      });
      return true;
    }
  }

  if (request.action === 'CAPTURE_TAB') {
    const windowId = sender.tab ? sender.tab.windowId : undefined;
    const captureCallback = (dataUrl) => {
      if (chrome.runtime.lastError) {
        console.error('captureVisibleTab error:', chrome.runtime.lastError);
        sendResponse({ dataUrl: null, error: chrome.runtime.lastError.message });
        return;
      }
      sendResponse({ dataUrl });
    };
    if (windowId !== undefined) {
      chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, captureCallback);
    } else {
      chrome.tabs.captureVisibleTab({ format: 'png' }, captureCallback);
    }
    return true; // Keep message channel open for async callback
  }
});

async function injectContentScripts(tabId) {
  try {
    // Inject CSS
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ['content/inspector.css']
    });

    // Inject JS in sequence
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/dummy_data.js']
    });

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/svg_exporter.js']
    });

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/inspector.js']
    });
  } catch (e) {
    // If scripts are already injected or restricted page (e.g. chrome://), log and continue
    console.log('Script injection note:', e.message);
  }
}

async function captureViewport(tabId, settings) {
  let restoreNeeded = false;
  if (settings.dummyData && settings.dummyData.enabled) {
    try {
      await injectContentScripts(tabId);
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (opts) => {
          if (window.SnapCraftDummyData) {
            window.__snapcraft_viewport_restore = window.SnapCraftDummyData.apply(document.body, opts);
          }
        },
        args: [settings.dummyData]
      });
      restoreNeeded = true;
      await new Promise(r => setTimeout(r, 60));
    } catch (e) {
      console.warn('Viewport dummy data error:', e);
    }
  }

  let dataUrl;
  try {
    dataUrl = await new Promise((resolve) => {
      chrome.tabs.captureVisibleTab({ format: 'png' }, (url) => {
        resolve(url);
      });
    });
  } finally {
    if (restoreNeeded) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            if (window.__snapcraft_viewport_restore && window.__snapcraft_viewport_restore.restore) {
              window.__snapcraft_viewport_restore.restore();
              delete window.__snapcraft_viewport_restore;
            }
          }
        });
      } catch (e) {
        console.warn('Viewport restore error:', e);
      }
    }
  }

  const tab = await chrome.tabs.get(tabId);
  const width = tab.width * settings.scale;
  const height = tab.height * settings.scale;

  if (settings.format === 'svg') {
    const svgMarkup = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <image href="${dataUrl}" width="${width}" height="${height}" />
</svg>`;
    return {
      format: 'svg',
      content: svgMarkup,
      width,
      height
    };
  }

  return {
    format: settings.format,
    content: dataUrl,
    width,
    height
  };
}
