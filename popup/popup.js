// Popup Controller for SnapCraft Studio
document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const modeCards = document.querySelectorAll('.mode-card');
  const formatPills = document.querySelectorAll('.format-pill');
  const qualityRow = document.getElementById('qualityRow');
  const qualityRange = document.getElementById('qualityRange');
  const qualityVal = document.getElementById('qualityVal');
  const scaleSelect = document.getElementById('scaleSelect');
  const transparentBg = document.getElementById('transparentBg');
  const btnStartCapture = document.getElementById('btnStartCapture');
  
  // Dummy Data Elements
  const dummyDataToggle = document.getElementById('dummyDataToggle');
  const dummySubControls = document.getElementById('dummySubControls');
  const dummyDataBadge = document.getElementById('dummyDataBadge');
  const dummyNames = document.getElementById('dummyNames');
  const dummyPhones = document.getElementById('dummyPhones');
  const dummyEmails = document.getElementById('dummyEmails');
  
  // Modal Elements
  const previewModal = document.getElementById('previewModal');
  const btnCloseModal = document.getElementById('btnCloseModal');
  const btnCancelModal = document.getElementById('btnCancelModal');
  const previewImage = document.getElementById('previewImage');
  const previewSvgCode = document.getElementById('previewSvgCode');
  const previewDimensions = document.getElementById('previewDimensions');
  const previewFormat = document.getElementById('previewFormat');
  const btnCopyClipboard = document.getElementById('btnCopyClipboard');
  const btnDownload = document.getElementById('btnDownload');

  let currentSettings = {
    mode: 'inspect',
    format: 'png',
    quality: 0.92,
    scale: 2,
    transparentBg: false,
    dummyData: {
      enabled: false,
      names: true,
      phones: true,
      emails: true
    }
  };

  let capturedData = null; // Stores dataUrl or SVG string

  // Load Saved Settings
  chrome.storage.local.get(['snapSettings'], (res) => {
    if (res.snapSettings) {
      currentSettings = { ...currentSettings, ...res.snapSettings };
      if (!res.snapSettings.transparentBgDefaultFixed) {
        currentSettings.transparentBg = false;
        currentSettings.transparentBgDefaultFixed = true;
        chrome.storage.local.set({ snapSettings: currentSettings });
      }
      updateUIFromSettings();
    }
  });

  function updateUIFromSettings() {
    // Mode
    modeCards.forEach(card => {
      card.classList.toggle('active', card.dataset.mode === currentSettings.mode);
    });

    // Format
    formatPills.forEach(pill => {
      pill.classList.toggle('active', pill.dataset.format === currentSettings.format);
    });

    // Quality visibility
    if (currentSettings.format === 'jpeg' || currentSettings.format === 'webp') {
      qualityRow.style.display = 'flex';
      qualityRange.value = Math.round(currentSettings.quality * 100);
      qualityVal.textContent = `${qualityRange.value}%`;
    } else {
      qualityRow.style.display = 'none';
    }

    scaleSelect.value = currentSettings.scale.toString();
    transparentBg.checked = currentSettings.transparentBg;

    // Dummy Data UI State
    if (!currentSettings.dummyData) {
      currentSettings.dummyData = { enabled: false, names: true, phones: true, emails: true };
    }
    const isDummyActive = !!currentSettings.dummyData.enabled;
    dummyDataToggle.checked = isDummyActive;
    dummySubControls.style.display = isDummyActive ? 'flex' : 'none';
    dummyDataBadge.style.display = isDummyActive ? 'inline-block' : 'none';
    dummyNames.checked = currentSettings.dummyData.names !== false;
    dummyPhones.checked = currentSettings.dummyData.phones !== false;
    dummyEmails.checked = currentSettings.dummyData.emails !== false;
  }

  function saveSettings() {
    chrome.storage.local.set({ snapSettings: currentSettings });
  }

  // Event Listeners - Modes
  modeCards.forEach(card => {
    card.addEventListener('click', () => {
      currentSettings.mode = card.dataset.mode;
      updateUIFromSettings();
      saveSettings();
    });
  });

  // Event Listeners - Formats
  formatPills.forEach(pill => {
    pill.addEventListener('click', () => {
      currentSettings.format = pill.dataset.format;
      updateUIFromSettings();
      saveSettings();
    });
  });

  // Quality Slider
  qualityRange.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    qualityVal.textContent = `${val}%`;
    currentSettings.quality = val / 100;
    saveSettings();
  });

  // Scale Select
  scaleSelect.addEventListener('change', (e) => {
    currentSettings.scale = parseFloat(e.target.value);
    saveSettings();
  });

  // Transparent Toggle
  transparentBg.addEventListener('change', (e) => {
    currentSettings.transparentBg = e.target.checked;
    saveSettings();
  });

  // Dummy Data Toggles
  dummyDataToggle.addEventListener('change', (e) => {
    currentSettings.dummyData.enabled = e.target.checked;
    updateUIFromSettings();
    saveSettings();
  });

  dummyNames.addEventListener('change', (e) => {
    currentSettings.dummyData.names = e.target.checked;
    saveSettings();
  });

  dummyPhones.addEventListener('change', (e) => {
    currentSettings.dummyData.phones = e.target.checked;
    saveSettings();
  });

  dummyEmails.addEventListener('change', (e) => {
    currentSettings.dummyData.emails = e.target.checked;
    saveSettings();
  });

  // Launch Capture Trigger
  btnStartCapture.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      alert('Could not find active browser tab.');
      return;
    }

    if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:'))) {
      alert('SnapCraft cannot capture internal browser pages (' + (tab.url.split('/')[2] || 'chrome') + ').\n\nPlease switch to your ClerkHound or regular web application tab, then click Launch Capture.');
      return;
    }

    // Send command to active tab or background
    chrome.runtime.sendMessage({
      action: 'LAUNCH_CAPTURE',
      tabId: tab.id,
      settings: currentSettings
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Launch capture error:', chrome.runtime.lastError);
        alert('Could not launch capture: ' + chrome.runtime.lastError.message + '\n\nPlease refresh the webpage and try again.');
        return;
      }
      if (response && response.success) {
        if (response.data) {
          showPreview(response.data);
        } else {
          // If interactive mode launched (inspect / area), close popup so user can select
          window.close();
        }
      } else {
        const err = (response && response.error) ? response.error : 'Failed to initialize capture. Please refresh the page tab and try again.';
        alert(err);
      }
    });
  });

  // Listen for messages from content scripts / background (e.g. after interactive capture finishes)
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'SHOW_PREVIEW') {
      showPreview(request.data);
      sendResponse({ received: true });
    }
  });

  function showPreview(data) {
    capturedData = data;
    previewModal.classList.add('active');

    previewDimensions.textContent = `${data.width} × ${data.height} px`;
    previewFormat.textContent = data.format.toUpperCase();

    if (data.format === 'svg') {
      previewImage.style.display = 'none';
      previewSvgCode.style.display = 'block';
      previewSvgCode.value = data.content;
    } else {
      previewSvgCode.style.display = 'none';
      previewImage.style.display = 'block';
      previewImage.src = data.content;
    }
  }

  // Modal Controls
  const closePreviewModal = () => {
    previewModal.classList.remove('active');
  };

  btnCloseModal.addEventListener('click', closePreviewModal);
  if (btnCancelModal) {
    btnCancelModal.addEventListener('click', closePreviewModal);
  }

  // Dismiss on backdrop click
  previewModal.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-backdrop') || e.target === previewModal) {
      closePreviewModal();
    }
  });

  // Dismiss on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && previewModal.classList.contains('active')) {
      closePreviewModal();
    }
  });

  btnCopyClipboard.addEventListener('click', async () => {
    if (!capturedData) return;

    try {
      if (capturedData.format === 'svg') {
        await navigator.clipboard.writeText(capturedData.content);
        alert('SVG Markup copied to clipboard!');
      } else {
        const response = await fetch(capturedData.content);
        const blob = await response.blob();
        await navigator.clipboard.write([
          new ClipboardItem({ [blob.type]: blob })
        ]);
        alert('Image copied to clipboard!');
      }
    } catch (err) {
      console.error('Clipboard copy failed:', err);
      alert('Could not copy automatically. You can right click to copy image.');
    }
  });

  btnDownload.addEventListener('click', () => {
    if (!capturedData) return;

    const filename = `snapcraft_${Date.now()}.${capturedData.format}`;
    
    if (capturedData.format === 'svg') {
      const blob = new Blob([capturedData.content], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      chrome.downloads.download({ url, filename, saveAs: true });
    } else {
      chrome.downloads.download({ url: capturedData.content, filename, saveAs: true });
    }
  });
});
