/**
 * PersistentVector implementation using structural sharing.
 *
 * We use a wide branching trie with branching factor 32. 32 is chosen because
 * it makes a depth-7 trie cover 2^35 values, which is far beyond any practical
 * need, while each internal node stays small enough to allocate cheaply and
 * keep cache behavior reasonable.
 *
 * "Persistent" here means immutable: any mutating operation returns a *new*
 * Vector that shares structure with the old one. We never clone entire trees;
 * we only copy the nodes on the path from the root to the affected leaf.
 */

const BRANCH_BITS = 5;
const BRANCHING = 1 << BRANCH_BITS; // 32
const MASK = BRANCHING - 1;          // 31, for indexing a level

/**
 * Returns the 5-bit chunk of the given index at the specified tree level.
 * Level 0 is the chunk nearest the leaves (least significant).
 */
function chunkFor(index, level) {
  return (index >>> (level * BRANCH_BITS)) & MASK;
}

/**
 * Determines the tree height needed to store `size` values.
 * size === 0 needs no nodes (we return -1 internally for the empty vector
 * and represent the root as null).
 * size in [1, 32] needs height 0 (a single leaf).
 * size in (32, 1024] needs height 1, and so on.
 */
function heightForSize(size) {
  if (size <= BRANCHING) return 0;
  let level = 0;
  let capacity = BRANCHING;
  while (capacity < size) {
    level += 1;
    capacity *= BRANCHING;
  }
  return level;
}

/**
 * Returns the maximum number of elements that can be stored in a tree of
 * the given height.
 */
function capacityForHeight(height) {
  if (height < 0) return 0;
  return Math.pow(BRANCHING, height + 1);
}

/**
 * Walks the tree to find the leaf node containing index `i`.
 * Returns null if the index is not currently stored.
 */
function findLeaf(root, height, i) {
  if (i < 0) return null;
  let node = root;
  for (let level = height; level > 0; level--) {
    if (node === null) return null;
    const childIndex = chunkFor(i, level);
    if (childIndex >= node.length) return null;
    node = node[childIndex];
  }
  return node;
}

/**
 * Inserts the value at index `i` into a copy of the subtree rooted at `node`,
 * creating new nodes as needed.  `level` is the depth of `node` (0 = leaf).
 * `height` is the overall tree height, used to preallocate slots for internal
 * nodes so that index alignment stays consistent across versions.
 */
function setRecursive(node, level, height, i, value) {
  let newNode;
  if (level === 0) {
    newNode = node === null ? new Array(BRANCHING) : node.slice();
    newNode[i & MASK] = value;
    return newNode;
  }
  const chunk = chunkFor(i, level);
  const child = node === null ? null : (chunk < node.length ? node[chunk] : null);
  const newChild = setRecursive(child, level - 1, height, i, value);
  if (node === null) {
    // Preallocate all 32 slots so a get() on a yet-unused index finds null
    // rather than going out of bounds.
    newNode = new Array(BRANCHING);
    newNode.fill(null);
  } else {
    newNode = node.slice();
  }
  newNode[chunk] = newChild;
  return newNode;
}

/**
 * Builds a left-packed leaf containing the first `count` values from `arr`
 * starting at `offset`.
 * Slots beyond `count` are left undefined, matching how get() treats unused
 * positions (returns undefined).
 */
function buildLeaf(arr, offset, count) {
  const leaf = new Array(BRANCHING);
  const n = Math.min(count, BRANCHING);
  for (let i = 0; i < n; i++) leaf[i] = arr[offset + i];
  for (let i = n; i < BRANCHING; i++) leaf[i] = undefined;
  return leaf;
}

/**
 * Recursively builds a left-packed tree of height `height` from `arr`.
 * `offset` is the index of `arr` at which this subtree's values begin.
 * Returns the root node.  Internal nodes are preallocated to full width so
 * that index lookups never overrun the node array.
 */
function buildSubtree(arr, offset, count, height) {
  if (height === 0) return buildLeaf(arr, offset, count);
  const chunkSize = Math.pow(BRANCHING, height);
  const node = new Array(BRANCHING);
  node.fill(null);
  for (let c = 0; c < BRANCHING; c++) {
    const childOffset = offset + c * chunkSize;
    if (childOffset >= count) break;
    const childCount = count - childOffset;
    node[c] = buildSubtree(arr, childOffset, childCount, height - 1);
  }
  return node;
}

/**
 * Computes the effective tree height after a pop, and returns it.  If the
 * remaining size would fit in a tree one level shorter, we shrink the height
 * so that future operations stay compact.  We never shrink below height 0
 * while any element remains.
 */
function shrunkHeight(size, currentHeight) {
  if (currentHeight <= 0) return 0;
  const smallerCapacity = Math.pow(BRANCHING, currentHeight);
  if (size <= smallerCapacity) return currentHeight - 1;
  return currentHeight;
}

/**
 * Returns a copy of `node` with the subtree at the given chunk removed (set to
 * undefined).  Only the path from root to the affected child is copied; siblings
 * are shared.
 */
function clearSubtree(node, level, i) {
  if (node === null) return null;
  const chunk = chunkFor(i, level);
  if (level === 0) {
    const newNode = node.slice();
    newNode[chunk] = undefined;
    return newNode;
  }
  const newNode = node.slice();
  newNode[chunk] = clearSubtree(node[chunk], level - 1, i);
  return newNode;
}

/**
 * Recursively checks whether a subtree contains no defined values.
 * Used by pop() to decide whether a removed child leaves its parent empty.
 */
function subtreeEmpty(node, level) {
  if (node === null) return true;
  if (level === 0) {
    for (let i = 0; i < node.length; i++) {
      if (node[i] !== undefined) return false;
    }
    return true;
  }
  for (let i = 0; i < node.length; i++) {
    if (node[i] !== null) return false;
  }
  return true;
}

export class Vector {
  /**
   * @param {number} size   Number of values currently stored.
   * @param {number} height Tree height: 0 for a single leaf, 1 for root + leaf, etc.
   * @param {Array|null} root The root node, or null for the empty vector.
   */
  constructor(size, height, root) {
    this.size = size;
    this.height = height;
    this.root = root;
  }

  static empty() {
    return new Vector(0, 0, null);
  }

  /**
   * Builds a Vector from an iterable.  Values are copied into the tree; the
   * input is not retained.
   */
  static from(iterable) {
    if (iterable === null || iterable === undefined) {
      return Vector.empty();
    }
    if (iterable instanceof Vector) return iterable;
    const arr = Array.from(iterable);
    if (arr.length === 0) return Vector.empty();
    const height = heightForSize(arr.length);
    const root = buildSubtree(arr, 0, arr.length, height);
    return new Vector(arr.length, height, root);
  }

  /**
   * Returns the value at index `i`, or `undefined` if `i` is out of range.
   * Mirrors the convention of indexing a native array.
   */
  get(i) {
    if (typeof i !== "number" || i < 0 || i >= this.size) return undefined;
    const leaf = findLeaf(this.root, this.height, i);
    if (leaf === null) return undefined;
    const value = leaf[i & MASK];
    return value;
  }

  /**
   * Returns a new Vector with `value` placed at index `i`.
   * `i` must be an existing index (0 <= i < size).  Use push() to grow.
   */
  set(i, value) {
    if (typeof i !== "number" || i < 0 || i >= this.size || !Number.isInteger(i)) {
      throw new RangeError(`set: index ${i} out of range [0, ${this.size})`);
    }
    const newRoot = setRecursive(this.root, this.height, this.height, i, value);
    return new Vector(this.size, this.height, newRoot);
  }

  /**
   * Returns a new Vector with `value` appended at the end.
   */
  push(value) {
    const newSize = this.size + 1;
    const requiredHeight = heightForSize(newSize);

    // The tree needs to grow.  We wrap the current root in a new root node,
    // placing the old root at index 0.  This preserves all existing paths and
    // keeps index-to-path mappings stable.
    if (requiredHeight > this.height) {
      if (this.root === null) {
        // From empty to a single leaf.
        const leaf = new Array(BRANCHING);
        leaf.fill(undefined);
        leaf[0] = value;
        return new Vector(1, 0, leaf);
      }
      const newRoot = new Array(BRANCHING);
      newRoot.fill(null);
      newRoot[0] = this.root;
      newRoot[1] = setRecursive(null, requiredHeight - 1, requiredHeight, this.size, value);
      return new Vector(newSize, requiredHeight, newRoot);
    }

    const newRoot = setRecursive(this.root, this.height, this.height, this.size, value);
    return new Vector(newSize, this.height, newRoot);
  }

  /**
   * Returns a new Vector with the last element removed.  Calling pop() on an
   * empty vector returns the same empty vector.
   */
  pop() {
    if (this.size === 0) return this;
    const newSize = this.size - 1;
    if (newSize === 0) return Vector.empty();

    const newHeight = shrunkHeight(newSize, this.height);

    // If we are shrinking the height, drop the old root level.  The new root
    // is the leftmost child of the old root.  Because the tree is left-packed,
    // the removed element lived in a child that is being discarded entirely,
    // so root[0] already contains exactly the values [0, newSize) and needs no
    // further clearing.
    if (newHeight < this.height) {
      const newRoot = this.root[0];
      return new Vector(newSize, newHeight, newRoot);
    }

    const newRoot = clearSubtree(this.root, this.height, newSize);
    return new Vector(newSize, this.height, newRoot);
  }

  /**
   * Returns a new plain JavaScript array containing all values in order.
   * This is a linear copy; it does not share structure with the tree.
   */
  toArray() {
    const out = new Array(this.size);
    this._fillArray(out, 0, this.root, this.height);
    return out;
  }

  /**
   * Internal helper: writes the values of subtree `node` into `out` starting
   * at `baseIndex`.  Walks the tree in left-to-right order.
   */
  _fillArray(out, baseIndex, node, level) {
    if (node === null) return;
    if (level === 0) {
      const max = Math.min(node.length, out.length - baseIndex);
      for (let i = 0; i < max; i++) {
        out[baseIndex + i] = node[i];
      }
      return;
    }
    const chunkSize = Math.pow(BRANCHING, level);
    for (let c = 0; c < node.length; c++) {
      const child = node[c];
      if (child === null) break;
      this._fillArray(out, baseIndex + c * chunkSize, child, level - 1);
    }
  }

  /**
   * Returns a new plain JavaScript array of values from index `start`
   * (inclusive) to `end` (exclusive).  Negative or omitted arguments follow
   * the same conventions as Array.prototype.slice.  This is a linear copy.
   */
  slice(start, end) {
    const arr = this.toArray();
    return arr.slice(start, end);
  }

  /**
   * Returns the string tag used by Object.prototype.toString.
   */
  get [Symbol.toStringTag]() {
    return "Vector";
  }
}
