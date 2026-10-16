import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';

import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';

import {
  getFirestore,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

import {
  firebaseConfig,
  ADMIN_EMAIL
} from './firebase-config.js';

const $ = id => document.getElementById(id);

const cats = [
  'All',
  'IPL Jerseys',
  'International Jerseys',
  'PSL Jerseys',
  'Score Cards',
  'Cricket Posters',
  'IPL Posters',
  'Player Posters',
  'Cricket Wallpapers',
  'PLP Files',
  'PNG Images',
  'PDF Files',
  'Other Digital Files'
];

let auth;
let db;
let products = [];
let activeCategory = 'All';
let user = null;
let unsubscribe = null;
let editing = null;
let selectedCoverData = '';

const isAdminPage = () =>
  location.pathname.endsWith('/admin.html') ||
  location.pathname === 'admin.html';

const isAuthorizedAdmin = () =>
  isAdminPage() &&
  !!user &&
  user.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();

function toast(message) {
  const el = $('toast');
  if (!el) return;

  el.textContent = message;
  el.classList.remove('hidden');

  setTimeout(() => el.classList.add('hidden'), 3200);
}

function esc(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function validUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol)
      ? url.href
      : '';
  } catch {
    return '';
  }
}

function validImage(value) {
  if (typeof value !== 'string') return '';

  if (
    value.startsWith('data:image/jpeg;base64,') ||
    value.startsWith('data:image/png;base64,') ||
    value.startsWith('data:image/webp;base64,')
  ) {
    return value;
  }

  return validUrl(value);
}

async function compressCover(file) {
  if (!file || !file.type.startsWith('image/')) {
    throw new Error('Please select an image.');
  }

  const bitmap = await createImageBitmap(file);
  let width = bitmap.width;
  let height = bitmap.height;

  const maxSide = 1000;

  if (Math.max(width, height) > maxSide) {
    const scale = maxSide / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');

  if (!context) {
    bitmap.close?.();
    throw new Error('Could not prepare the image.');
  }

  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  let quality = 0.78;
  let data = canvas.toDataURL('image/jpeg', quality);

  while (data.length > 620000 && quality > 0.38) {
    quality -= 0.08;
    data = canvas.toDataURL('image/jpeg', quality);
  }

  if (data.length > 700000) {
    throw new Error('Image too large. Choose a smaller image.');
  }

  return data;
}

function setCoverPreview(data) {
  selectedCoverData = data || '';

  const wrap = $('coverPreviewWrap');
  const image = $('coverPreview');

  if (!wrap || !image) return;

  wrap.classList.toggle('hidden', !selectedCoverData);

  if (selectedCoverData) {
    image.src = selectedCoverData;
  } else {
    image.removeAttribute('src');
  }
}

function showError(message) {
  if ($('count')) $('count').textContent = 'Connection error';

  if ($('products')) {
    $('products').innerHTML = `
      <div class="empty">
        <strong>Unable to load products.</strong><br>
        <span class="small">${esc(message)}</span>
      </div>
    `;
  }

  console.error(message);
}

function renderChips() {
  const container = $('chips');
  if (!container) return;

  container.innerHTML = cats.map(category => `
    <button
      type="button"
      class="chip ${activeCategory === category ? 'active' : ''}"
      data-cat="${esc(category)}"
    >${esc(category)}</button>
  `).join('');

  container.querySelectorAll('[data-cat]').forEach(button => {
    button.onclick = () => {
      activeCategory = button.dataset.cat;
      renderChips();
      renderProducts();
    };
  });
}

function renderProducts() {
  const container = $('products');
  const search = $('search');
  const sort = $('sort');

  if (!container || !search || !sort) return;

  const term = search.value.trim().toLowerCase();

  let list = products.filter(product => {
    const categoryMatches =
      activeCategory === 'All' ||
      product.category === activeCategory;

    const text = [
      product.name,
      product.description,
      product.type,
      product.category
    ].join(' ').toLowerCase();

    return categoryMatches && text.includes(term);
  });

  if (sort.value === 'az') {
    list.sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''))
    );
  } else {
    list.sort((a, b) =>
      (b.createdAtMs || 0) - (a.createdAtMs || 0)
    );
  }

  if ($('count')) {
    $('count').textContent =
      `${list.length} item${list.length === 1 ? '' : 's'}`;
  }

  if (!list.length) {
    container.innerHTML = `
      <div class="empty">
        <div style="font-size:32px">🏏</div>
        <strong>No designs found</strong><br>
        <span class="small">Try another search or category.</span>
      </div>
    `;
    return;
  }

  // Edit and Delete are rendered ONLY on admin.html
  // after the configured administrator signs in.
  const showAdminButtons = isAuthorizedAdmin();

  container.innerHTML = list.map(product => {
    const image = validImage(product.thumbnailUrl || '');

    const thumbnail = image
      ? `<img src="${esc(image)}"
              alt="${esc(product.name || 'Product')}"
              loading="lazy">`
      : `<div>
           ${product.type === 'PDF'
             ? '📄'
             : ['PNG', 'JPG'].includes(product.type)
               ? '🖼️'
               : product.type === 'PLP'
                 ? '🎨'
                 : '🏏'}
           <div style="font-size:11px;margin-top:4px">
             ${esc(product.type || 'FILE')}
           </div>
         </div>`;

    const adminButtons = showAdminButtons
      ? `<div class="cardbuttons" style="margin-top:7px">
           <button type="button"
             class="btn-secondary"
             data-edit="${esc(product.id)}">Edit</button>
           <button type="button"
             class="btn-danger"
             data-delete="${esc(product.id)}">Delete</button>
         </div>`
      : '';

    return `
      <article class="card">
        <div class="thumb">${thumbnail}</div>
        <div class="cardbody">
          <span class="badge">
            ${esc(product.category || 'Other Digital Files')}
          </span>

          <h4>${esc(product.name || 'Untitled product')}</h4>
          <p>${esc(product.description || 'Digital download')}</p>

          <div class="cardbuttons">
            <button type="button"
              class="btn-primary"
              data-get="${esc(product.id)}">Get file ↗</button>
          </div>

          ${adminButtons}
        </div>
      </article>
    `;
  }).join('');

  // Public cards have ONLY the Get File button.
  // No product Share handler exists in this code.
  container.querySelectorAll('[data-get]').forEach(button => {
    button.onclick = () => {
      const product = products.find(
        item => item.id === button.dataset.get
      );

      const url = validUrl(
        product?.downloadUrl || product?.externalUrl || ''
      );

      if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
      } else {
        toast('Download link is unavailable.');
      }
    };
  });

  container.querySelectorAll('[data-edit]').forEach(button => {
    button.onclick = () => startEdit(button.dataset.edit);
  });

  container.querySelectorAll('[data-delete]').forEach(button => {
    button.onclick = () => removeProduct(button.dataset.delete);
  });
}

function listenProducts() {
  if (!db) return;

  if (unsubscribe) unsubscribe();

  if ($('count')) $('count').textContent = 'Connecting…';

  if ($('products')) {
    $('products').innerHTML =
      '<div class="empty">Connecting to the online store…</div>';
  }

  unsubscribe = onSnapshot(
    collection(db, 'products'),

    snapshot => {
      products = snapshot.docs.map(document => {
        const data = document.data();

        return {
          ...data,
          id: document.id,
          createdAtMs: data.createdAt?.toMillis?.() || 0
        };
      });

      renderProducts();
    },

    error => {
      console.error('Firestore error:', error);
      showError(`${error.code || ''} ${error.message || ''}`);
      toast('Database connection failed.');
    }
  );
}

function setSignedIn(currentUser) {
  user = currentUser;

  const authorized = isAuthorizedAdmin();

  $('loginBox')?.classList.toggle('hidden', authorized);
  $('editorBox')?.classList.toggle('hidden', !authorized);

  if ($('adminTitle')) {
    $('adminTitle').textContent =
      authorized ? 'Manage products' : 'Admin login';
  }

  if ($('adminDescription')) {
    $('adminDescription').textContent = authorized
      ? `Signed in as ${currentUser.email}`
      : 'Sign in using your authorized administrator account.';
  }

  if (currentUser && !authorized) {
    toast('This account is not the configured administrator.');
    signOut(auth).catch(console.error);
  }

  renderProducts();
}

function startEdit(id) {
  if (!isAuthorizedAdmin()) {
    toast('Admin access required.');
    return;
  }

  const product = products.find(item => item.id === id);
  if (!product) return;

  editing = product;

  $('editId').value = id;
  $('name').value = product.name || '';

  const category = $('category');
  category.value =
    [...category.options].some(option =>
      option.value === product.category
    )
      ? product.category
      : 'Cricket Posters';

  $('type').value = product.type || 'PLP';
  $('externalUrl').value =
    product.externalUrl || product.downloadUrl || '';

  const thumbnail = product.thumbnailUrl || '';

  $('thumbnailUrlInput').value =
    thumbnail.startsWith('data:image/') ? '' : thumbnail;

  setCoverPreview(
    thumbnail.startsWith('data:image/') ? thumbnail : ''
  );

  $('coverFile').value = '';
  $('description').value = product.description || '';
  $('saveBtn').textContent = 'Save changes';

  $('adminPanel').scrollIntoView({ behavior: 'smooth' });
}

function resetForm() {
  $('productForm').reset();
  $('editId').value = '';
  editing = null;

  setCoverPreview('');

  $('saveBtn').textContent = '＋ Publish product';
}

async function removeProduct(id) {
  if (!isAuthorizedAdmin()) {
    toast('Admin access required.');
    return;
  }

  const product = products.find(item => item.id === id);

  if (!product ||
      !confirm(`Delete "${product.name}" from the catalogue?`)) {
    return;
  }

  try {
    await deleteDoc(doc(db, 'products', id));
    toast('Product deleted');
  } catch (error) {
    console.error(error);
    toast('Delete failed: ' + (error.code || error.message));
  }
}

// Admin login
if ($('loginForm')) {
  $('loginForm').onsubmit = async event => {
    event.preventDefault();

    try {
      await signInWithEmailAndPassword(
        auth,
        $('email').value.trim(),
        $('password').value
      );

      $('password').value = '';
    } catch (error) {
      console.error(error);
      toast('Sign-in failed: ' + (error.code || error.message));
    }
  };
}

if ($('logoutBtn')) {
  $('logoutBtn').onclick = () => signOut(auth);
}

if ($('cancelEdit')) {
  $('cancelEdit').onclick = resetForm;
}

if ($('refreshBtn')) {
  $('refreshBtn').onclick = () => {
    listenProducts();
    toast('Refreshing products…');
  };
}

if ($('search')) $('search').oninput = renderProducts;
if ($('sort')) $('sort').onchange = renderProducts;

// Cover image
if ($('coverFile')) {
  $('coverFile').onchange = async () => {
    const file = $('coverFile').files?.[0];

    if (!file) {
      setCoverPreview('');
      return;
    }

    try {
      toast('Preparing cover image…');

      setCoverPreview(await compressCover(file));
      $('thumbnailUrlInput').value = '';

      toast('Cover image ready');
    } catch (error) {
      $('coverFile').value = '';
      setCoverPreview('');
      toast(error.message || 'Could not read image.');
    }
  };
}

if ($('clearCover')) {
  $('clearCover').onclick = () => {
    $('coverFile').value = '';
    setCoverPreview('');
  };
}

// Publish or update products
if ($('productForm')) {
  $('productForm').onsubmit = async event => {
    event.preventDefault();

    if (!isAuthorizedAdmin()) {
      toast('Please sign in as administrator.');
      return;
    }

    const rawUrl = $('externalUrl').value.trim();
    const externalUrl = validUrl(rawUrl);

    if (rawUrl && !externalUrl) {
      toast('Enter a valid HTTP or HTTPS download URL.');
      return;
    }

    const button = $('saveBtn');
    button.disabled = true;

    try {
      const rawImage = $('thumbnailUrlInput').value.trim();
      const imageUrl = validUrl(rawImage);

      if (rawImage && !imageUrl) {
        throw new Error('Enter a valid image URL.');
      }

      const downloadUrl =
        externalUrl ||
        editing?.downloadUrl ||
        editing?.externalUrl ||
        '';

      if (!downloadUrl) {
        throw new Error('Enter the MediaFire download link.');
      }

      const data = {
        name: $('name').value.trim(),
        category: $('category').value,
        type: $('type').value,
        description: $('description').value.trim(),
        externalUrl: downloadUrl,
        downloadUrl,
        thumbnailUrl:
          selectedCoverData ||
          imageUrl ||
          editing?.thumbnailUrl ||
          '',
        updatedAt: serverTimestamp()
      };

      button.textContent = 'Saving…';

      if (editing) {
        await updateDoc(doc(db, 'products', editing.id), data);
        toast('Product updated');
      } else {
        await addDoc(collection(db, 'products'), {
          ...data,
          createdAt: serverTimestamp()
        });
        toast('Product published');
      }

      resetForm();
    } catch (error) {
      console.error(error);
      toast('Could not save: ' + (error.message || error.code));
    } finally {
      button.disabled = false;
      button.textContent = editing
        ? 'Save changes'
        : '＋ Publish product';
    }
  };
}

// Share App only — no product-level Share button.
if ($('shareTop')) {
  $('shareTop').onclick = async () => {
    try {
      if (navigator.share) {
        await navigator.share({
          title: 'BoundaryBox',
          text: 'Cricket templates and digital assets',
          url: location.href
        });
      } else {
        await navigator.clipboard.writeText(location.href);
        toast('Page link copied');
      }
    } catch (error) {
      if (error?.name !== 'AbortError') console.error(error);
    }
  };
}

if ($('adminToggle')) {
  $('adminToggle').onclick = () => {
    $('adminPanel')?.classList.toggle('hidden');
  };
}

// Firebase setup
renderChips();

if (
  !firebaseConfig ||
  !Object.values(firebaseConfig).every(
    value => typeof value === 'string' && value.length > 0
  ) ||
  !ADMIN_EMAIL ||
  !ADMIN_EMAIL.includes('@')
) {
  showError('Please check firebase-config.js settings.');
} else {
  try {
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);

    onAuthStateChanged(auth, setSignedIn);
    listenProducts();
  } catch (error) {
    console.error('Firebase setup error:', error);
    showError(error.message || 'Firebase setup failed.');
  }
}
