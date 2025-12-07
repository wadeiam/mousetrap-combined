<script>
  import { onMount } from 'svelte';

  let images = [];
  let loading = true;
  let selectedImage = null;

  onMount(async () => {
    await loadGallery();
  });

  async function loadGallery() {
    loading = true;
    try {
      const res = await fetch('/api/gallery');
      images = await res.json();
      // Sort by name (contains timestamp) - newest first
      images.sort((a, b) => b.name.localeCompare(a.name));
    } catch (e) {
      console.error('Failed to load gallery:', e);
    }
    loading = false;
  }

  function formatTimestamp(filename) {
    // Parse date/time from filename format: img_YYYYMMDD_HHMM_classification.jpg
    if (!filename) return 'Unknown Date';
    const match = filename.match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})/);
    if (match) {
      const year = parseInt(match[1]);
      const month = parseInt(match[2]) - 1;
      const day = parseInt(match[3]);
      const hour = parseInt(match[4]);
      const minute = parseInt(match[5]);
      const date = new Date(year, month, day, hour, minute);
      return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      });
    }
    return filename;
  }

  function getClassification(filename) {
    // Extract classification from filename: img_YYYYMMDD_HHMM_classification.jpg
    const match = filename.match(/_(\w+)\.jpg$/);
    if (match) {
      return match[1];
    }
    return 'unknown';
  }

  function selectImage(image) {
    selectedImage = image;
  }

  function closeModal() {
    selectedImage = null;
  }
</script>

<div class="container">
  <div class="card">
    <div class="card-title">Motion Captures</div>

    {#if loading}
      <div class="loading">
        <div class="spinner"></div>
      </div>
    {:else if images.length === 0}
      <div class="empty-state">
        <p>No motion captures yet.</p>
        <p>Images will appear here when motion is detected.</p>
      </div>
    {:else}
      <div class="gallery-grid">
        {#each images as image}
          <div class="gallery-item" on:click={() => selectImage(image)}>
            <img src="/api/gallery/{image.name}" alt={image.name} loading="lazy" />
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <button class="btn btn-secondary" style="width: 100%;" on:click={loadGallery}>
    Refresh Gallery
  </button>
</div>

{#if selectedImage}
  <div class="modal" on:click={closeModal}>
    <span class="modal-close" on:click={closeModal}>&times;</span>
    <div class="modal-content" on:click|stopPropagation>
      <img src="/api/gallery/{selectedImage.name}" alt={selectedImage.name} />
      <div class="modal-info">
        <p>{formatTimestamp(selectedImage.name)}</p>
        <p class="classification">{getClassification(selectedImage.name)}</p>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-content {
    text-align: center;
  }

  .modal-info {
    margin-top: 1rem;
    color: white;
  }

  .classification {
    text-transform: capitalize;
    font-weight: bold;
    color: var(--accent);
  }
</style>
