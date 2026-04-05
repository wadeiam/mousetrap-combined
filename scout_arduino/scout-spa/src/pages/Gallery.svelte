<script>
  import { onMount, onDestroy } from 'svelte';
  import { getCaptures, getCaptureURL, deleteCapture } from '../lib/api.js';
  import Card from '../components/Card.svelte';
  import LoadingSpinner from '../components/LoadingSpinner.svelte';
  import ErrorBanner from '../components/ErrorBanner.svelte';

  let images = [];
  let loading = true;
  let error = null;
  let selectedImage = null;
  let selectedIndex = -1;
  let imageUrls = {};
  let showDeleteConfirm = false;
  let deleteTarget = null;

  onMount(() => {
    loadGallery();
    document.addEventListener('keydown', handleKeydown);
  });

  onDestroy(() => {
    document.removeEventListener('keydown', handleKeydown);
    // Clean up blob URLs
    Object.values(imageUrls).forEach(url => URL.revokeObjectURL(url));
  });

  async function loadGallery() {
    loading = true;
    error = null;
    try {
      const data = await getCaptures();
      images = data.files || [];
      // Sort by name descending (newest first, assuming filename has timestamp)
      images.sort((a, b) => b.name.localeCompare(a.name));
    } catch (err) {
      error = err.message || 'Failed to load gallery';
    } finally {
      loading = false;
    }
  }

  async function loadImageUrl(filename) {
    if (imageUrls[filename]) return imageUrls[filename];

    try {
      const url = getCaptureURL(filename);
      imageUrls[filename] = url;
      return url;
    } catch (err) {
      console.error('Failed to load image:', err);
      return null;
    }
  }

  async function openModal(image, index) {
    selectedImage = image;
    selectedIndex = index;
    // Preload the image
    await loadImageUrl(image.name);
  }

  function closeModal() {
    selectedImage = null;
    selectedIndex = -1;
    showDeleteConfirm = false;
    deleteTarget = null;
  }

  function handleKeydown(e) {
    if (!selectedImage) return;

    if (e.key === 'Escape') {
      closeModal();
    } else if (e.key === 'ArrowLeft') {
      navigatePrevious();
    } else if (e.key === 'ArrowRight') {
      navigateNext();
    }
  }

  function navigatePrevious() {
    if (selectedIndex > 0) {
      selectedIndex--;
      selectedImage = images[selectedIndex];
      loadImageUrl(selectedImage.name);
    }
  }

  function navigateNext() {
    if (selectedIndex < images.length - 1) {
      selectedIndex++;
      selectedImage = images[selectedIndex];
      loadImageUrl(selectedImage.name);
    }
  }

  async function downloadImage(filename) {
    try {
      const url = getCaptureURL(filename);
      const response = await fetch(url);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      console.error('Failed to download image:', err);
      alert('Failed to download image');
    }
  }

  function promptDelete(filename) {
    deleteTarget = filename;
    showDeleteConfirm = true;
  }

  async function confirmDelete() {
    if (!deleteTarget) return;

    try {
      await deleteCapture(deleteTarget);

      // Remove from imageUrls
      if (imageUrls[deleteTarget]) {
        URL.revokeObjectURL(imageUrls[deleteTarget]);
        delete imageUrls[deleteTarget];
      }

      // Remove from images array
      images = images.filter(img => img.name !== deleteTarget);

      // Close modal if deleted image was selected
      if (selectedImage && selectedImage.name === deleteTarget) {
        closeModal();
      }

      showDeleteConfirm = false;
      deleteTarget = null;
    } catch (err) {
      console.error('Failed to delete image:', err);
      alert('Failed to delete image');
    }
  }

  function cancelDelete() {
    showDeleteConfirm = false;
    deleteTarget = null;
  }

  function formatTimestamp(filename) {
    // Parse date/time from filename format: img_YYYYMMDD_HHMM_a.jpg or similar
    // Examples: img_20251201_0004_a.jpg (Dec 1, 2025 00:04), snapshot_1733038847.jpg
    if (!filename) return 'Unknown Date';

    // Try to extract YYYYMMDD_HHMM from filename (img_YYYYMMDD_HHMM_...)
    // Format from firmware: strftime(ts, sizeof(ts), "%Y%m%d_%H%M", &tmNow)
    const dateTimeMatch = filename.match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})/);
    if (dateTimeMatch) {
      const year = parseInt(dateTimeMatch[1]);
      const month = parseInt(dateTimeMatch[2]) - 1; // JS months are 0-indexed
      const day = parseInt(dateTimeMatch[3]);
      const hour = parseInt(dateTimeMatch[4]);
      const minute = parseInt(dateTimeMatch[5]);

      // Validate the date/time parts are reasonable
      if (year >= 2020 && year <= 2100 && month >= 0 && month <= 11 &&
          day >= 1 && day <= 31 && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
        const date = new Date(year, month, day, hour, minute);
        return 'Captured ' + date.toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        }) + ' ' + date.toLocaleTimeString(undefined, {
          hour: 'numeric',
          minute: '2-digit',
          second: '2-digit'
        });
      }
    }

    // Fallback: try to parse unix timestamp from filename (snapshot_TIMESTAMP.jpg)
    const unixMatch = filename.match(/(\d{10})/);
    if (unixMatch) {
      const timestamp = parseInt(unixMatch[1]) * 1000;
      const date = new Date(timestamp);
      if (!isNaN(date.getTime())) {
        return 'Captured ' + date.toLocaleString();
      }
    }

    return 'Unknown Date';
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
</script>

<div class="gallery-container">
  <div class="header">
    <h1>Image Gallery</h1>
    <button class="refresh-btn" on:click={loadGallery} disabled={loading}>
      {loading ? 'Loading...' : 'Refresh'}
    </button>
  </div>

  {#if error}
    <ErrorBanner message={error} />
  {/if}

  {#if loading}
    <div class="loading-container">
      <LoadingSpinner />
    </div>
  {:else if images.length === 0}
    <Card>
      <div class="empty-state">
        <p>No captures yet</p>
        <p class="empty-hint">Captured images will appear here</p>
      </div>
    </Card>
  {:else}
    <div class="image-grid">
      {#each images as image, index}
        <div class="thumbnail-card" on:click={() => openModal(image, index)}>
          {#await loadImageUrl(image.name)}
            <div class="thumbnail-loading">
              <LoadingSpinner />
            </div>
          {:then url}
            {#if url}
              <img src={url} alt={image.name} class="thumbnail-image" />
            {:else}
              <div class="thumbnail-error">Failed to load</div>
            {/if}
          {/await}
          <div class="thumbnail-info">
            <div class="thumbnail-filename">{image.name}</div>
            <div class="thumbnail-meta">
              {formatFileSize(image.size)}
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

{#if selectedImage}
  <div class="modal-backdrop" on:click={closeModal}>
    <div class="modal-content" on:click|stopPropagation>
      <div class="modal-header">
        <div class="modal-title">
          <div class="modal-filename">{selectedImage.name}</div>
          <div class="modal-timestamp">{formatTimestamp(selectedImage.name)}</div>
        </div>
        <button class="modal-close" on:click={closeModal}>&times;</button>
      </div>

      <div class="modal-body">
        {#await loadImageUrl(selectedImage.name)}
          <LoadingSpinner />
        {:then url}
          {#if url}
            <img src={url} alt={selectedImage.name} class="modal-image" />
          {:else}
            <div class="modal-error">Failed to load image</div>
          {/if}
        {/await}
      </div>

      <div class="modal-footer">
        <div class="modal-nav">
          <button
            class="nav-btn"
            on:click={navigatePrevious}
            disabled={selectedIndex === 0}
          >
            &larr; Previous
          </button>
          <span class="image-counter">{selectedIndex + 1} / {images.length}</span>
          <button
            class="nav-btn"
            on:click={navigateNext}
            disabled={selectedIndex === images.length - 1}
          >
            Next &rarr;
          </button>
        </div>
        <div class="modal-actions">
          <button class="action-btn" on:click={() => downloadImage(selectedImage.name)}>
            Download
          </button>
          <button class="action-btn delete-btn" on:click={() => promptDelete(selectedImage.name)}>
            Delete
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

{#if showDeleteConfirm}
  <div class="confirm-backdrop" on:click={cancelDelete}>
    <div class="confirm-dialog" on:click|stopPropagation>
      <h3>Confirm Delete</h3>
      <p>Are you sure you want to delete {deleteTarget}?</p>
      <div class="confirm-actions">
        <button class="confirm-btn cancel-btn" on:click={cancelDelete}>Cancel</button>
        <button class="confirm-btn delete-confirm-btn" on:click={confirmDelete}>Delete</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .gallery-container {
    padding: 20px;
    max-width: 1400px;
    margin: 0 auto;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
  }

  h1 {
    margin: 0;
    color: #ddd;
    font-size: 24px;
  }

  .refresh-btn {
    padding: 8px 16px;
    background: #1a1a1a;
    border: 1px solid #444;
    color: #ddd;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    transition: background 0.2s;
  }

  .refresh-btn:hover:not(:disabled) {
    background: #2a2a2a;
  }

  .refresh-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .loading-container {
    display: flex;
    justify-content: center;
    padding: 60px 20px;
  }

  .empty-state {
    text-align: center;
    padding: 40px 20px;
    color: #888;
  }

  .empty-state p {
    margin: 10px 0;
    font-size: 18px;
  }

  .empty-hint {
    font-size: 14px !important;
    color: #666;
  }

  .image-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 16px;
  }

  .thumbnail-card {
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 8px;
    overflow: hidden;
    cursor: pointer;
    transition: transform 0.2s, border-color 0.2s;
  }

  .thumbnail-card:hover {
    transform: translateY(-2px);
    border-color: #555;
  }

  .thumbnail-image {
    width: 100%;
    height: 200px;
    object-fit: cover;
    display: block;
    background: #0a0a0a;
  }

  .thumbnail-loading,
  .thumbnail-error {
    width: 100%;
    height: 200px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #0a0a0a;
    color: #666;
  }

  .thumbnail-info {
    padding: 12px;
  }

  .thumbnail-filename {
    color: #ddd;
    font-size: 14px;
    font-weight: 500;
    margin-bottom: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .thumbnail-meta {
    color: #888;
    font-size: 12px;
  }

  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.9);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 20px;
  }

  .modal-content {
    background: #1a1a1a;
    border: 1px solid #444;
    border-radius: 8px;
    max-width: 90vw;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 16px 20px;
    border-bottom: 1px solid #333;
  }

  .modal-title {
    flex: 1;
  }

  .modal-filename {
    color: #ddd;
    font-size: 16px;
    font-weight: 500;
    margin-bottom: 4px;
  }

  .modal-timestamp {
    color: #888;
    font-size: 14px;
  }

  .modal-close {
    background: none;
    border: none;
    color: #888;
    font-size: 32px;
    cursor: pointer;
    padding: 0;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    margin-left: 16px;
  }

  .modal-close:hover {
    color: #ddd;
  }

  .modal-body {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    overflow: auto;
    background: #0a0a0a;
  }

  .modal-image {
    max-width: 100%;
    max-height: calc(90vh - 200px);
    object-fit: contain;
  }

  .modal-error {
    color: #f44336;
    padding: 40px;
  }

  .modal-footer {
    padding: 16px 20px;
    border-top: 1px solid #333;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 16px;
  }

  .modal-nav {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .nav-btn {
    padding: 8px 16px;
    background: #1a1a1a;
    border: 1px solid #444;
    color: #ddd;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    transition: background 0.2s;
  }

  .nav-btn:hover:not(:disabled) {
    background: #2a2a2a;
  }

  .nav-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .image-counter {
    color: #888;
    font-size: 14px;
  }

  .modal-actions {
    display: flex;
    gap: 8px;
  }

  .action-btn {
    padding: 8px 16px;
    background: #1a1a1a;
    border: 1px solid #444;
    color: #ddd;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    transition: background 0.2s, border-color 0.2s;
  }

  .action-btn:hover {
    background: #2a2a2a;
  }

  .delete-btn {
    border-color: #f44336;
    color: #f44336;
  }

  .delete-btn:hover {
    background: rgba(244, 67, 54, 0.1);
  }

  .confirm-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2000;
  }

  .confirm-dialog {
    background: #1a1a1a;
    border: 1px solid #444;
    border-radius: 8px;
    padding: 24px;
    max-width: 400px;
    width: 90%;
  }

  .confirm-dialog h3 {
    margin: 0 0 12px 0;
    color: #ddd;
    font-size: 18px;
  }

  .confirm-dialog p {
    margin: 0 0 20px 0;
    color: #aaa;
    font-size: 14px;
  }

  .confirm-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  .confirm-btn {
    padding: 8px 16px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    border: 1px solid #444;
    transition: background 0.2s;
  }

  .cancel-btn {
    background: #1a1a1a;
    color: #ddd;
  }

  .cancel-btn:hover {
    background: #2a2a2a;
  }

  .delete-confirm-btn {
    background: #f44336;
    color: white;
    border-color: #f44336;
  }

  .delete-confirm-btn:hover {
    background: #d32f2f;
  }

  @media (max-width: 768px) {
    .image-grid {
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 12px;
    }

    .thumbnail-image {
      height: 150px;
    }

    .modal-footer {
      flex-direction: column;
      align-items: stretch;
    }

    .modal-nav {
      justify-content: center;
    }

    .modal-actions {
      justify-content: center;
    }

    h1 {
      font-size: 20px;
    }
  }
</style>
