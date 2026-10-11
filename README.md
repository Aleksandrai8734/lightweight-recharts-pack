# lightweight-recharts-pack

An immutable indexed sequence using structural sharing so that updates return a new collection in near-constant time instead of copying the entire thing.

## Usage

```javascript
import { Vector } from "lightweight-recharts-pack";

const v0 = Vector.empty();
const v1 = v0.push("a").push("b").push("c"); // v1: ["a", "b", "c"], v0 still []

const v2 = v1.set(1, "B"); // v2: ["a", "B", "c"], v1 unchanged
console.log(v1.get(1)); // "b"
console.log(v2.get(1)); // "B"
console.log(v1.size);   // 3
console.log(v2.size);   // 3

const v3 = v1.push("d").push("e"); // structural sharing reuses most of v1's tree
console.log(v3.size);   // 5
console.log(v3.get(3)); // "d"

// Sub-vector extraction (copies, returns a plain array)
console.log(v3.slice(1, 4)); // ["b", "c", "d"]
```

## Why this exists

A plain JavaScript array is fast for indexed reads but an immutable update at index `i` requires copying every element to avoid mutating the original. In a state-heavy program that builds new collections on every change, that copy dominates. This library stores values in a wide branching tree (branching factor 32) and shares unmodified nodes between old and new versions, so an update touches only `O(log32 n)` nodes instead of `O(n)`.

The trade-off: reads and writes pay one extra indirection per tree level. For small collections this is slower than a native array; the win appears as the collection grows or as you keep many derived versions alive simultaneously.

## The awkward edge

`slice(start, end)` returns a plain JavaScript array and copies the requested range. It does *not* return a new `Vector`, so the structural-sharing guarantee does not extend to slices. The same is true for `toArray()`. The tree nodes themselves are never deep-copied during `push`, `set`, or `pop`, but flattening forces a linear copy by design. If you need to keep the slice as a vector, reconstitute it: `Vector.from(v.slice(1, 4))`.

`get` on an out-of-range index returns `undefined` rather than throwing, which is the same convention as indexing a native array.
